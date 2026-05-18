import { NextResponse } from "next/server";
import { createHouseupLead } from "@/services/houseup/create-lead";
import { sendQualifiedLeadToHauzapp } from "@/services/hauzapp/workflow";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  processAppointmentPostVisitCheck,
  processAppointmentReminder,
  processBrokerInitialCheck,
  processBrokerInitialEscalation,
  processBrokerNoResponseReclaim,
  processBrokerProgressCheck,
  processLeadFunnelStaleReclaim,
  processLeadStaleReassignment,
  processManualReminder
} from "@/services/broker-sla/workflow";
import { processLeadFollowup, scheduleLeadFollowups } from "@/services/followups/lead-followups";
import { sendMetaMessage } from "@/services/meta/send-message";
import { sendMetaTemplate } from "@/services/meta/send-template";
import { sendQualifiedLeadToBroker } from "@/services/leads/workflow";
import {
  publishNextPendingJobProcessor,
  verifyQstashRequest
} from "@/services/qstash/jobs";

type SendJobPayload = {
  campaignId: string;
  contactId: string;
  phone: string;
  text: string;
  templateName?: string;
  languageCode?: string;
  components?: unknown[];
};

type ScheduledJob = {
  id: string;
  organization_id: string;
  target_id: string | null;
  job_type: string;
  payload: SendJobPayload & Record<string, unknown>;
};

export async function POST(request: Request) {
  return processJobs(request);
}

export async function GET(request: Request) {
  return processJobs(request);
}

async function processJobs(request: Request) {
  const body = await request.text();
  const secret = process.env.TRIGGER_SECRET_KEY || process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  const hasQstashSignature = Boolean(request.headers.get("upstash-signature"));

  if (hasQstashSignature) {
    try {
      const verified = await verifyQstashRequest(request, body);

      if (!verified) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (secret && authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  } else if (!secret && (process.env.QSTASH_TOKEN || process.env.QSTASH_CURRENT_SIGNING_KEY)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let supabase: ReturnType<typeof createAdminClient>;

  try {
    supabase = createAdminClient();
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Supabase admin client unavailable."
      },
      { status: 500 }
    );
  }
  const { data: jobs, error } = await supabase
    .from("scheduled_jobs")
    .select("id, organization_id, target_id, job_type, payload")
    .eq("status", "pending")
    .lte("run_at", new Date().toISOString())
    .order("run_at", { ascending: true })
    .limit(10)
    .returns<ScheduledJob[]>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = [];

  for (const job of jobs ?? []) {
    const { data: claimedJob, error: claimError } = await supabase
      .from("scheduled_jobs")
      .update({ status: "running" })
      .eq("id", job.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle<{ id: string }>();

    if (claimError || !claimedJob) {
      results.push({
        id: job.id,
        status: "skipped",
        reason: claimError?.message ?? "already_claimed"
      });
      continue;
    }

    try {
      if (job.job_type === "check_broker_response") {
        await processBrokerResponseCheck(supabase, job);
        results.push({ id: job.id, status: "done" });
        continue;
      }

      if (job.job_type === "broker_initial_check") {
        const result = await processBrokerInitialCheck(supabase, job);
        results.push({ id: job.id, ...result });
        continue;
      }

      if (job.job_type === "broker_initial_escalation") {
        const result = await processBrokerInitialEscalation(supabase, job);
        results.push({ id: job.id, ...result });
        continue;
      }

      if (job.job_type === "broker_progress_check") {
        const result = await processBrokerProgressCheck(supabase, job);
        results.push({ id: job.id, ...result });
        continue;
      }

      if (job.job_type === "broker_no_response_reclaim") {
        const result = await processBrokerNoResponseReclaim(supabase, job);
        results.push({ id: job.id, ...result });
        continue;
      }

      if (job.job_type === "lead_stale_reassignment") {
        const result = await processLeadStaleReassignment(supabase, job);
        results.push({ id: job.id, ...result });
        continue;
      }

      if (job.job_type === "lead_funnel_stale_reclaim") {
        const result = await processLeadFunnelStaleReclaim(supabase, job);
        results.push({ id: job.id, ...result });
        continue;
      }

      if (job.job_type === "appointment_reminder") {
        const result = await processAppointmentReminder(supabase, job);
        results.push({ id: job.id, ...result });
        continue;
      }

      if (job.job_type === "appointment_post_visit_check") {
        const result = await processAppointmentPostVisitCheck(supabase, job);
        results.push({ id: job.id, ...result });
        continue;
      }

      if (job.job_type === "manual_reminder") {
        const result = await processManualReminder(supabase, job);
        results.push({ id: job.id, ...result });
        continue;
      }

      if (job.job_type === "houseup_create_lead") {
        await processHouseupLead(supabase, job);
        results.push({ id: job.id, status: "done" });
        continue;
      }

      if (job.job_type === "hauzapp_create_qualified_lead") {
        await processHauzappQualifiedLead(supabase, job);
        results.push({ id: job.id, status: "done" });
        continue;
      }

      if (job.job_type === "lead_followup") {
        const result = await processLeadFollowup({
          supabase,
          organizationId: job.organization_id,
          payload: {
            conversationId: String(job.payload.conversationId),
            contactId: String(job.payload.contactId),
            ruleId: String(job.payload.ruleId),
            scheduledAfter: String(job.payload.scheduledAfter)
          }
        });
        await supabase
          .from("scheduled_jobs")
          .update({
            status: result.status === "cancelled" ? "cancelled" : "done",
            executed_at: new Date().toISOString(),
            payload: { ...job.payload, result }
          })
          .eq("id", job.id);
        results.push({ id: job.id, status: result.status, reason: result.reason });
        continue;
      }

      if (job.job_type === "lead_template_followup") {
        const result = await processLeadTemplateFollowup(supabase, job);
        await supabase
          .from("scheduled_jobs")
          .update({
            status: result.status,
            executed_at: new Date().toISOString(),
            payload: { ...job.payload, result }
          })
          .eq("id", job.id);
        results.push({ id: job.id, status: result.status, reason: result.reason });
        continue;
      }

      if (job.job_type === "meta_send_message") {
        await processMetaSendMessage(supabase, job);
        results.push({ id: job.id, status: "done" });
        continue;
      }

      if (job.job_type !== "campaign_send_message") {
        await supabase
          .from("scheduled_jobs")
          .update({ status: "cancelled", executed_at: new Date().toISOString() })
          .eq("id", job.id);
        results.push({ id: job.id, status: "cancelled" });
        continue;
      }

      const { data: conversation } = await supabase
        .from("conversations")
        .select("id")
        .eq("organization_id", job.organization_id)
        .eq("contact_id", job.payload.contactId)
        .eq("campaign_id", job.payload.campaignId)
        .maybeSingle<{ id: string }>();

      const conversationId =
        conversation?.id ??
        (
          await supabase
            .from("conversations")
            .insert({
              organization_id: job.organization_id,
              contact_id: job.payload.contactId,
              campaign_id: job.payload.campaignId,
              status: "open",
              current_stage: "new",
              ai_enabled: true,
              last_message_at: new Date().toISOString()
            })
            .select("id")
            .single<{ id: string }>()
        ).data?.id;

      if (!conversationId) {
        throw new Error("Nao foi possivel criar conversa.");
      }

      const templateName =
        typeof job.payload.templateName === "string" ? job.payload.templateName : null;
      const metaResult = templateName
        ? await sendMetaTemplate({
            phone: job.payload.phone,
            templateName,
            languageCode:
              typeof job.payload.languageCode === "string" ? job.payload.languageCode : "pt_BR",
            components: Array.isArray(job.payload.components) ? job.payload.components : []
          })
        : await sendMetaMessage({
            phone: job.payload.phone,
            text: job.payload.text
          });

      await supabase.from("messages").insert({
        organization_id: job.organization_id,
        conversation_id: conversationId,
        contact_id: job.payload.contactId,
        direction: "outbound",
        channel: "meta",
        type: templateName ? "template" : "text",
        content: templateName ?? job.payload.text,
        status: "sent",
        external_message_id: metaResult.externalMessageId,
        payload: metaResult.payload
      });

      const sentAt = new Date().toISOString();

      await Promise.all([
        supabase.from("contacts").update({ status: "sent" }).eq("id", job.payload.contactId),
        supabase
          .from("conversations")
          .update({
            last_message_at: sentAt,
            window_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          })
          .eq("id", conversationId),
        supabase
          .from("scheduled_jobs")
          .update({ status: "done", executed_at: new Date().toISOString() })
          .eq("id", job.id)
      ]);

      await scheduleLeadFollowups({
        supabase,
        organizationId: job.organization_id,
        conversationId,
        contactId: job.payload.contactId,
        scheduledAfter: sentAt
      });

      results.push({ id: job.id, status: "done" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido.";
      const updates = [
        supabase
          .from("scheduled_jobs")
          .update({
            status: "failed",
            executed_at: new Date().toISOString(),
            payload: { ...job.payload, error: message }
          })
          .eq("id", job.id)
      ];

      if (job.payload.contactId) {
        updates.push(
          supabase
            .from("contacts")
            .update({ status: "failed" })
            .eq("id", job.payload.contactId)
        );
      }

      await Promise.all(updates);
      results.push({ id: job.id, status: "failed", error: message });
    }
  }

  const nextProcessor = await publishNextPendingJobProcessor(supabase).catch((error) => ({
    published: false,
    reason: error instanceof Error ? error.message : "qstash_publish_failed"
  }));

  return NextResponse.json({ processed: results.length, results, nextProcessor });
}

async function processMetaSendMessage(
  supabase: ReturnType<typeof createAdminClient>,
  job: ScheduledJob
) {
  const conversationId =
    typeof job.payload.conversationId === "string" ? job.payload.conversationId : null;
  const contactId = typeof job.payload.contactId === "string" ? job.payload.contactId : null;
  const phone = typeof job.payload.phone === "string" ? job.payload.phone : null;
  const text = typeof job.payload.text === "string" ? job.payload.text : null;

  if (!conversationId || !contactId || !phone || !text) {
    throw new Error("Payload invalido para meta_send_message.");
  }

  if (job.payload.humanized) {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("ai_enabled")
      .eq("id", conversationId)
      .maybeSingle<{ ai_enabled: boolean }>();

    if (conversation?.ai_enabled === false) {
      await supabase
        .from("scheduled_jobs")
        .update({ status: "cancelled", executed_at: new Date().toISOString() })
        .eq("id", job.id);
      return;
    }
  }

  const sourceCreatedAt =
    typeof job.payload.sourceCreatedAt === "string" ? job.payload.sourceCreatedAt : null;
  const sourceMessageId =
    typeof job.payload.sourceMessageId === "string" ? job.payload.sourceMessageId : null;

  if (job.payload.humanized && !sourceCreatedAt) {
    await supabase
      .from("scheduled_jobs")
      .update({
        status: "cancelled",
        executed_at: new Date().toISOString(),
        payload: { ...job.payload, cancel_reason: "legacy_humanized_job_without_source" }
      })
      .eq("id", job.id);
    return;
  }

  if (sourceCreatedAt) {
    const newerInboundQuery = supabase
      .from("messages")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("direction", "inbound")
      .gt("created_at", sourceCreatedAt)
      .limit(1);

    if (sourceMessageId) {
      newerInboundQuery.neq("external_message_id", sourceMessageId);
    }

    const { data: newerInbound } = await newerInboundQuery.maybeSingle<{ id: string }>();

    if (newerInbound) {
      await supabase
        .from("scheduled_jobs")
        .update({ status: "cancelled", executed_at: new Date().toISOString() })
        .eq("id", job.id);
      return;
    }
  }

  const duplicateSince = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: duplicateMessage } = await supabase
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .eq("content", text)
    .gte("created_at", duplicateSince)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (duplicateMessage) {
    await supabase
      .from("scheduled_jobs")
      .update({ status: "cancelled", executed_at: new Date().toISOString() })
      .eq("id", job.id);
    return;
  }

  const metaResult = await sendMetaMessage({ phone, text });
  const sentAt = new Date().toISOString();

  await Promise.all([
    supabase.from("messages").insert({
      organization_id: job.organization_id,
      conversation_id: conversationId,
      contact_id: contactId,
      direction: "outbound",
      channel: "meta",
      type: "text",
      content: text,
      status: "sent",
      external_message_id: metaResult.externalMessageId,
      payload: metaResult.payload
    }),
    supabase
      .from("conversations")
      .update({ last_message_at: sentAt })
      .eq("id", conversationId),
    supabase
      .from("scheduled_jobs")
      .update({ status: "done", executed_at: sentAt })
      .eq("id", job.id)
  ]);
}

async function processBrokerResponseCheck(
  supabase: ReturnType<typeof createAdminClient>,
  job: ScheduledJob
) {
  if (!job.target_id) {
    return;
  }

  const { data: assignment } = await supabase
    .from("broker_assignments")
    .select("id, organization_id, lead_id, broker_id, status, leads(name, phone, interest, region, budget, payment_method, summary, score)")
    .eq("id", job.target_id)
    .single<{
      id: string;
      organization_id: string;
      lead_id: string;
      broker_id: string;
      status: string;
      leads: {
        name: string | null;
        phone: string;
        interest: string | null;
        region: string | null;
        budget: number | null;
        payment_method: string | null;
        summary: string | null;
        score: number;
      } | null;
    }>();

  if (!assignment || assignment.status !== "assigned") {
    await supabase
      .from("scheduled_jobs")
      .update({ status: "done", executed_at: new Date().toISOString() })
      .eq("id", job.id);
    return;
  }

  await supabase
    .from("broker_assignments")
    .update({
      status: "no_response",
      redistributed_at: new Date().toISOString()
    })
    .eq("id", assignment.id);

  if (assignment.leads) {
    await sendQualifiedLeadToBroker({
      supabase,
      organizationId: assignment.organization_id,
      leadId: assignment.lead_id,
      excludeBrokerIds: [assignment.broker_id],
      qualification: {
        name: assignment.leads.name,
        phone: assignment.leads.phone,
        interest: assignment.leads.interest,
        region: assignment.leads.region,
        budget: assignment.leads.budget,
        paymentMethod: assignment.leads.payment_method,
        urgency: null,
        intention: "indefinido",
        qualificationStatus: "qualified",
        stage: "sent_to_broker",
        score: assignment.leads.score,
        summary: assignment.leads.summary ?? "Lead qualificado aguardando redistribuicao.",
        qualified: true,
        wantsVisit: false,
        visitDatePreference: null,
        reply: ""
      }
    });
    await supabase
      .from("broker_assignments")
      .update({ status: "redistributed" })
      .eq("id", assignment.id);
  }

  await supabase
    .from("scheduled_jobs")
    .update({ status: "done", executed_at: new Date().toISOString() })
    .eq("id", job.id);
}

async function processHouseupLead(
  supabase: ReturnType<typeof createAdminClient>,
  job: ScheduledJob
) {
  if (!job.target_id) {
    return;
  }

  const { data: lead } = await supabase
    .from("leads")
    .select("id, organization_id, name, phone, source, interest, region, budget, payment_method, summary")
    .eq("id", job.target_id)
    .single<{
      id: string;
      organization_id: string;
      name: string | null;
      phone: string;
      source: string;
      interest: string | null;
      region: string | null;
      budget: number | null;
      payment_method: string | null;
      summary: string | null;
    }>();

  if (!lead) {
    return;
  }

  const result = await createHouseupLead({
    name: lead.name,
    phone: lead.phone,
    source: lead.source,
    interest: lead.interest,
    region: lead.region,
    budget: lead.budget,
    paymentMethod: lead.payment_method,
    summary: lead.summary,
    brokerName: typeof job.payload.brokerName === "string" ? job.payload.brokerName : null,
    brokerPhone: typeof job.payload.brokerPhone === "string" ? job.payload.brokerPhone : null
  });

  await Promise.all([
    supabase.from("integration_logs").insert({
      organization_id: lead.organization_id,
      provider: "hauzapp",
      target_type: "lead",
      target_id: lead.id,
      status: result.ok ? "done" : "placeholder",
      request_payload: result.payload,
      response_payload: result,
      error_message: result.error
    }),
    supabase
      .from("scheduled_jobs")
      .update({ status: "done", executed_at: new Date().toISOString() })
      .eq("id", job.id)
  ]);
}

async function processHauzappQualifiedLead(
  supabase: ReturnType<typeof createAdminClient>,
  job: ScheduledJob
) {
  if (!job.target_id) {
    return;
  }

  const { data: lead } = await supabase
    .from("leads")
    .select("id, organization_id, name, phone, source, interest, region, budget, payment_method, summary, score, hauzapp_cliente_id, hauzapp_sent_at")
    .eq("id", job.target_id)
    .single<{
      id: string;
      organization_id: string;
      name: string | null;
      phone: string;
      source: string;
      interest: string | null;
      region: string | null;
      budget: number | null;
      payment_method: string | null;
      summary: string | null;
      score: number;
      hauzapp_cliente_id: string | null;
      hauzapp_sent_at: string | null;
    }>();

  if (!lead) {
    return;
  }

  if (lead.hauzapp_cliente_id) {
    await supabase
      .from("scheduled_jobs")
      .update({ status: "cancelled", executed_at: new Date().toISOString() })
      .eq("id", job.id);
    return;
  }

  const lockAt = new Date().toISOString();
  const { data: lockedLead } = await supabase
    .from("leads")
    .update({ hauzapp_sent_at: lockAt })
    .eq("id", lead.id)
    .is("hauzapp_cliente_id", null)
    .is("hauzapp_sent_at", null)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (!lockedLead && !lead.hauzapp_sent_at) {
    await supabase
      .from("scheduled_jobs")
      .update({ status: "cancelled", executed_at: new Date().toISOString() })
      .eq("id", job.id);
    return;
  }

  let result: Awaited<ReturnType<typeof sendQualifiedLeadToHauzapp>>;

  try {
    result = await sendQualifiedLeadToHauzapp({
      supabase,
      lead: {
        ...lead,
        hauzapp_sent_at: lead.hauzapp_sent_at ?? lockAt
      }
    });
  } catch (error) {
    await supabase
      .from("leads")
      .update({ hauzapp_sent_at: null })
      .eq("id", lead.id)
      .is("hauzapp_cliente_id", null)
      .eq("hauzapp_sent_at", lockAt);
    throw error;
  }

  await Promise.all([
    supabase.from("integration_logs").insert({
      organization_id: lead.organization_id,
      provider: "hauzapp",
      target_type: "hauzapp_lead",
      target_id: lead.id,
      status: "done",
      request_payload: { leadId: lead.id },
      response_payload: result,
      error_message: null
    }),
    supabase
      .from("scheduled_jobs")
      .update({ status: "done", executed_at: new Date().toISOString() })
      .eq("id", job.id)
  ]);
}

async function processLeadTemplateFollowup(
  supabase: ReturnType<typeof createAdminClient>,
  job: ScheduledJob
) {
  const templateName =
    typeof job.payload.templateName === "string" && job.payload.templateName
      ? job.payload.templateName
      : process.env.META_DEFAULT_FOLLOWUP_TEMPLATE;
  const phone = typeof job.payload.phone === "string" ? job.payload.phone : null;
  const conversationId =
    typeof job.payload.conversationId === "string" ? job.payload.conversationId : null;
  const contactId = typeof job.payload.contactId === "string" ? job.payload.contactId : null;

  if (!templateName || !phone || !conversationId || !contactId) {
    return { status: "cancelled", reason: "missing_template_configuration" };
  }

  const result = await sendMetaTemplate({
    phone,
    templateName,
    languageCode:
      typeof job.payload.languageCode === "string" ? job.payload.languageCode : "pt_BR"
  });

  await supabase.from("messages").insert({
    organization_id: job.organization_id,
    conversation_id: conversationId,
    contact_id: contactId,
    direction: "outbound",
    channel: "meta",
    type: "template",
    content: templateName,
    status: "sent",
    external_message_id: result.externalMessageId,
    payload: result.payload
  });

  return { status: "done", reason: "template_sent" };
}
