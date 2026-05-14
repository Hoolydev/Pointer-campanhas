import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadQualification } from "@/agents/lead-agent";
import { renderTemplate } from "@/lib/templates";
import { sendUazapiMessage } from "@/services/uazapi/send-message";
import { publishJobProcessor } from "@/services/qstash/jobs";

type WorkflowInput = {
  supabase: SupabaseClient;
  organizationId: string;
  contactId: string;
  campaignId: string | null;
  conversationId: string;
  qualification: LeadQualification;
};

type Broker = {
  id: string;
  name: string;
  phone: string;
};

type BrokerAgent = {
  broker_message_template: string | null;
  broker_followup_minutes: number;
};

export async function upsertLeadFromQualification({
  supabase,
  organizationId,
  contactId,
  campaignId,
  conversationId,
  qualification
}: WorkflowInput) {
  const leadPayload = {
    organization_id: organizationId,
    contact_id: contactId,
    campaign_id: campaignId,
    conversation_id: conversationId,
    name: qualification.name,
    phone: qualification.phone,
    source: "campaign",
    interest: qualification.interest,
    region: qualification.region,
    budget: qualification.budget,
    payment_method: qualification.paymentMethod,
    qualification_status: qualification.qualificationStatus,
    score: qualification.score,
    summary: qualification.summary,
    stage: qualification.stage
  };

  const { data: existing } = await supabase
    .from("leads")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .maybeSingle<{ id: string }>();

  const { data: lead, error } = existing
    ? await supabase
        .from("leads")
        .update(leadPayload)
        .eq("id", existing.id)
        .select("id")
        .single<{ id: string }>()
    : await supabase.from("leads").insert(leadPayload).select("id").single<{ id: string }>();

  if (error || !lead) {
    throw new Error(error?.message || "Nao foi possivel salvar o lead.");
  }

  if (qualification.qualified) {
    await enqueueHauzappQualifiedLead({
      supabase,
      organizationId,
      leadId: lead.id,
      reason: "ai_qualified"
    });
  }

  return lead;
}

export async function enqueueHauzappQualifiedLead({
  supabase,
  organizationId,
  leadId,
  reason
}: {
  supabase: SupabaseClient;
  organizationId: string;
  leadId: string;
  reason: string;
}) {
  const { data: lead } = await supabase
    .from("leads")
    .select("id, hauzapp_cliente_id, hauzapp_sent_at")
    .eq("id", leadId)
    .eq("organization_id", organizationId)
    .maybeSingle<{ id: string; hauzapp_cliente_id: string | null; hauzapp_sent_at: string | null }>();

  if (!lead || lead.hauzapp_cliente_id || lead.hauzapp_sent_at) {
    return { queued: false, reason: "already_sent_or_missing_lead" };
  }

  const { data: existingJob } = await supabase
    .from("scheduled_jobs")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("job_type", "hauzapp_create_qualified_lead")
    .eq("target_id", leadId)
    .in("status", ["pending", "running"])
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (existingJob) {
    return { queued: false, reason: "active_job_exists", jobId: existingJob.id };
  }

  const runAt = new Date().toISOString();

  const { data: job, error } = await supabase
    .from("scheduled_jobs")
    .insert({
      organization_id: organizationId,
      job_type: "hauzapp_create_qualified_lead",
      target_id: leadId,
      status: "pending",
      run_at: runAt,
      payload: { reason }
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !job) {
    return { queued: false, reason: error?.message ?? "job_insert_failed" };
  }

  await publishJobProcessor({
    runAt,
    reason: "hauzapp_create_qualified_lead"
  }).catch(() => null);

  return { queued: true, jobId: job.id };
}

export async function sendQualifiedLeadToBroker({
  supabase,
  organizationId,
  leadId,
  qualification,
  excludeBrokerIds = []
}: {
  supabase: SupabaseClient;
  organizationId: string;
  leadId: string;
  qualification: LeadQualification;
  excludeBrokerIds?: string[];
}) {
  let brokerQuery = supabase
    .from("brokers")
    .select("id, name, phone")
    .eq("organization_id", organizationId)
    .eq("active", true)
    .order("last_assigned_at", { ascending: true, nullsFirst: true })
    .order("priority", { ascending: false })
    .limit(1);

  if (excludeBrokerIds.length > 0) {
    brokerQuery = brokerQuery.not("id", "in", `(${excludeBrokerIds.join(",")})`);
  }

  const { data: broker } = await brokerQuery.maybeSingle<Broker>();

  if (!broker) {
    await enqueueHauzappQualifiedLead({
      supabase,
      organizationId,
      leadId,
      reason: "qualified_without_active_broker"
    });
    await supabase
      .from("leads")
      .update({ stage: "qualified" })
      .eq("id", leadId)
      .eq("organization_id", organizationId);
    return null;
  }

  const { data: assignment } = await supabase
    .from("broker_assignments")
    .insert({
      organization_id: organizationId,
      lead_id: leadId,
      broker_id: broker.id,
      status: "assigned"
    })
    .select("id")
    .single<{ id: string }>();

  await supabase
    .from("leads")
    .update({ stage: "sent_to_broker" })
    .eq("id", leadId)
    .eq("organization_id", organizationId);

  await supabase
    .from("brokers")
    .update({ last_assigned_at: new Date().toISOString() })
    .eq("id", broker.id)
    .eq("organization_id", organizationId);

  const { data: brokerAgent } = await supabase
    .from("ai_agents")
    .select("broker_message_template, broker_followup_minutes")
    .eq("organization_id", organizationId)
    .eq("agent_type", "broker_uazapi")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<BrokerAgent>();

  const message = renderTemplate(
    brokerAgent?.broker_message_template ||
      `Ola, {{broker_name}}. Voce recebeu o lead {{lead_name}}.

Resumo:
{{summary}}

Responda aqui com o status do atendimento.`,
    {
      broker_name: broker.name,
      broker_phone: broker.phone,
      lead_name: qualification.name ?? qualification.phone,
      lead_phone: qualification.phone,
      summary: qualification.summary,
      interest: qualification.interest,
      region: qualification.region,
      budget: qualification.budget ? String(qualification.budget) : null,
      payment_method: qualification.paymentMethod,
      score: String(qualification.score)
    }
  );

  try {
    const payload = await sendUazapiMessage({
      phone: broker.phone,
      text: message
    });

    await supabase.from("messages").insert({
      organization_id: organizationId,
      direction: "outbound",
      channel: "uazapi",
      type: "text",
      content: message,
      status: "sent",
      payload
    });
  } catch (error) {
    await supabase.from("integration_logs").insert({
      organization_id: organizationId,
      provider: "uazapi",
      target_type: "broker_assignment",
      target_id: assignment?.id ?? null,
      status: "failed",
      request_payload: { brokerPhone: broker.phone, message },
      response_payload: {},
      error_message: error instanceof Error ? error.message : "Erro desconhecido."
    });
  }

  const brokerCheckRunAt = new Date(
    Date.now() + (brokerAgent?.broker_followup_minutes ?? 30) * 60 * 1000
  ).toISOString();

  await supabase.from("scheduled_jobs").insert({
    organization_id: organizationId,
    job_type: "check_broker_response",
    target_id: assignment?.id ?? null,
    status: "pending",
    run_at: brokerCheckRunAt,
    payload: { leadId, brokerId: broker.id }
  });

  await enqueueHauzappQualifiedLead({
    supabase,
    organizationId,
    leadId,
    reason: "qualified_lead_to_broker"
  });

  return assignment;
}
