import type { SupabaseClient } from "@supabase/supabase-js";
import { renderTemplate } from "@/lib/templates";
import { sendMetaMessage } from "@/services/meta/send-message";
import { publishJobProcessor } from "@/services/qstash/jobs";
import { sendUazapiMessage } from "@/services/uazapi/send-message";

const PROTECTED_STAGES = new Set(["reaquecer", "cliente_quente", "visit", "visita", "proposal", "proposta", "lost", "perdeu", "won", "ganhou"]);

type AssignmentContext = {
  id: string;
  organization_id: string;
  lead_id: string;
  broker_id: string;
  status: string;
  assigned_at: string;
  responded_at: string | null;
  leads: {
    id: string;
    name: string | null;
    phone: string;
    stage: string;
    summary: string | null;
    last_stage_updated_at: string | null;
    last_broker_response_at: string | null;
  } | null;
  brokers: {
    id: string;
    name: string;
    phone: string;
  } | null;
};

export async function scheduleBrokerAssignmentSla({
  supabase,
  organizationId,
  assignmentId,
  leadId,
  brokerId
}: {
  supabase: SupabaseClient;
  organizationId: string;
  assignmentId: string;
  leadId: string;
  brokerId: string;
}) {
  const now = Date.now();
  const jobs = [
    job(organizationId, "broker_initial_check", assignmentId, 15, { leadId, brokerId }),
    job(organizationId, "broker_initial_escalation", assignmentId, 30, { leadId, brokerId }),
    job(organizationId, "broker_no_response_reclaim", assignmentId, 5 * 24 * 60, { leadId, brokerId }),
    job(organizationId, "lead_stale_reassignment", leadId, 15 * 24 * 60, { assignmentId, brokerId }),
    job(organizationId, "lead_funnel_stale_reclaim", leadId, 20 * 24 * 60, { assignmentId, brokerId })
  ].map((scheduledJob) => ({
    ...scheduledJob,
    run_at: new Date(now + scheduledJob.delayMinutes * 60_000).toISOString(),
    payload: scheduledJob.payload
  }));

  await supabase.from("scheduled_jobs").insert(
    jobs.map((scheduledJob) => ({
      organization_id: scheduledJob.organization_id,
      job_type: scheduledJob.job_type,
      target_id: scheduledJob.target_id,
      status: scheduledJob.status,
      run_at: scheduledJob.run_at,
      payload: scheduledJob.payload
    }))
  );

  await publishJobProcessor({
    runAt: jobs[0]?.run_at,
    reason: "broker_assignment_sla"
  }).catch(() => null);
}

export async function scheduleBrokerProgressChecks({
  supabase,
  organizationId,
  assignmentId,
  leadId,
  brokerId
}: {
  supabase: SupabaseClient;
  organizationId: string;
  assignmentId: string;
  leadId: string;
  brokerId: string;
}) {
  const now = Date.now();
  const checks = [
    { delayMinutes: 24 * 60, label: "24h" },
    { delayMinutes: 36 * 60, label: "36h" },
    { delayMinutes: 72 * 60, label: "72h" },
    { delayMinutes: 10 * 24 * 60, label: "10d", recurring: true }
  ];

  await supabase
    .from("scheduled_jobs")
    .update({ status: "cancelled" })
    .eq("organization_id", organizationId)
    .eq("target_id", assignmentId)
    .eq("job_type", "broker_progress_check")
    .eq("status", "pending");

  const jobs = checks.map((check) => ({
    organization_id: organizationId,
    job_type: "broker_progress_check",
    target_id: assignmentId,
    status: "pending",
    run_at: new Date(now + check.delayMinutes * 60_000).toISOString(),
    payload: { leadId, brokerId, label: check.label, recurring: check.recurring ?? false }
  }));

  await supabase.from("scheduled_jobs").insert(jobs);
  await publishJobProcessor({ runAt: jobs[0]?.run_at, reason: "broker_progress_checks" }).catch(() => null);
}

export async function processBrokerInitialCheck(supabase: SupabaseClient, job: JobLike) {
  const context = await getAssignmentContext(supabase, job);
  if (!context || context.responded_at || context.status !== "assigned") {
    return markDone(supabase, job.id, "cancelled", "broker_already_responded");
  }

  await notifyBroker(context, `Ola, {{broker_name}}. Voce conseguiu iniciar o atendimento do lead {{lead_name}}?\n\nResumo: {{summary}}\n\nMe responda aqui como foi o primeiro contato.`);
  await supabase.from("broker_assignments").update({ first_check_sent_at: new Date().toISOString() }).eq("id", context.id);
  return markDone(supabase, job.id, "done", "broker_checked");
}

export async function processBrokerInitialEscalation(supabase: SupabaseClient, job: JobLike) {
  const context = await getAssignmentContext(supabase, job);
  if (!context || context.responded_at || context.status !== "assigned") {
    return markDone(supabase, job.id, "cancelled", "broker_already_responded");
  }

  await notifyAdmin(
    supabase,
    context.organization_id,
    `Cris, o corretor ${context.brokers?.name ?? "sem nome"} ainda nao respondeu sobre o lead ${leadName(context)} apos 30 minutos.\n\nTelefone lead: ${context.leads?.phone ?? "-"}\nResumo: ${context.leads?.summary ?? "-"}\n\nResponda aqui ou redistribua pelo sistema.`
  );
  await Promise.all([
    supabase.from("broker_assignments").update({ admin_escalated_at: new Date().toISOString() }).eq("id", context.id),
    supabase.from("leads").update({ stage: "no_response", last_stage_updated_at: new Date().toISOString() }).eq("id", context.lead_id)
  ]);
  return markDone(supabase, job.id, "done", "admin_escalated");
}

export async function processBrokerProgressCheck(supabase: SupabaseClient, job: JobLike) {
  const context = await getAssignmentContext(supabase, job);
  if (!context || context.status !== "accepted") {
    return markDone(supabase, job.id, "cancelled", "assignment_not_accepted");
  }

  await notifyBroker(context, `Ola, {{broker_name}}. Como esta o atendimento do lead {{lead_name}}?\n\nTeve visita, proposta ou alguma atualizacao de funil? Me responda aqui para eu atualizar o sistema.`);
  await supabase.from("broker_assignments").update({ last_progress_check_at: new Date().toISOString() }).eq("id", context.id);

  if (job.payload.recurring) {
    const runAt = new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString();
    await supabase.from("scheduled_jobs").insert({
      organization_id: context.organization_id,
      job_type: "broker_progress_check",
      target_id: context.id,
      status: "pending",
      run_at: runAt,
      payload: { ...job.payload, recurring: true }
    });
    await publishJobProcessor({ runAt, reason: "broker_progress_check_recurring" }).catch(() => null);
  }

  return markDone(supabase, job.id, "done", "broker_progress_checked");
}

export async function processBrokerNoResponseReclaim(supabase: SupabaseClient, job: JobLike) {
  const context = await getAssignmentContext(supabase, job);
  if (!context || context.responded_at) {
    return markDone(supabase, job.id, "cancelled", "broker_responded");
  }

  await reclaimLeadToAdmin(supabase, context, "Corretor ficou mais de 5 dias sem responder a IA.");
  return markDone(supabase, job.id, "done", "lead_reclaimed_no_broker_response");
}

export async function processLeadStaleReassignment(supabase: SupabaseClient, job: JobLike) {
  const context = await getAssignmentContextByLead(supabase, job);
  if (!context) {
    return markDone(supabase, job.id, "cancelled", "missing_context");
  }

  const lastUpdate = new Date(context.leads?.last_broker_response_at || context.leads?.last_stage_updated_at || context.assigned_at).getTime();
  if (Date.now() - lastUpdate < 15 * 24 * 60 * 60_000) {
    return markDone(supabase, job.id, "cancelled", "lead_recently_updated");
  }

  await reclaimLeadToAdmin(supabase, context, "Lead ficou mais de 15 dias sem atualizacao no sistema.");
  return markDone(supabase, job.id, "done", "lead_stale_reassigned");
}

export async function processLeadFunnelStaleReclaim(supabase: SupabaseClient, job: JobLike) {
  const context = await getAssignmentContextByLead(supabase, job);
  if (!context?.leads) {
    return markDone(supabase, job.id, "cancelled", "missing_context");
  }

  if (PROTECTED_STAGES.has(normalizeStage(context.leads.stage))) {
    return markDone(supabase, job.id, "cancelled", "protected_stage");
  }

  const lastStage = new Date(context.leads.last_stage_updated_at || context.assigned_at).getTime();
  if (Date.now() - lastStage < 20 * 24 * 60 * 60_000) {
    return markDone(supabase, job.id, "cancelled", "stage_recently_updated");
  }

  await reclaimLeadToAdmin(supabase, context, "Lead ficou mais de 20 dias sem mover ou atualizar funil.");
  return markDone(supabase, job.id, "done", "funnel_stale_reclaimed");
}

export async function processAppointmentReminder(supabase: SupabaseClient, job: JobLike) {
  if (!job.target_id) return markDone(supabase, job.id, "cancelled", "missing_appointment");
  const { data: appointment } = await supabase
    .from("appointments")
    .select("id, organization_id, lead_id, contact_id, starts_at, reminder_sent_at, contacts(name, phone), leads(name, phone)")
    .eq("id", job.target_id)
    .maybeSingle<{
      id: string;
      organization_id: string;
      lead_id: string | null;
      contact_id: string | null;
      starts_at: string;
      reminder_sent_at: string | null;
      contacts: { name: string | null; phone: string } | null;
      leads: { name: string | null; phone: string } | null;
    }>();

  if (!appointment || appointment.reminder_sent_at) return markDone(supabase, job.id, "cancelled", "already_sent");
  const phone = appointment.contacts?.phone || appointment.leads?.phone;
  if (phone) {
    const when = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(appointment.starts_at));
    await sendMetaMessage({ phone, text: `Ola, passando para confirmar sua visita ao decorado em ${when}. Esta tudo certo para voce?` });
  }
  await supabase.from("appointments").update({ reminder_sent_at: new Date().toISOString() }).eq("id", appointment.id);
  return markDone(supabase, job.id, "done", "appointment_reminded");
}

export async function processAppointmentPostVisitCheck(supabase: SupabaseClient, job: JobLike) {
  if (!job.target_id) return markDone(supabase, job.id, "cancelled", "missing_appointment");
  const { data: appointment } = await supabase
    .from("appointments")
    .select("id, organization_id, lead_id, starts_at, broker_post_visit_checked_at")
    .eq("id", job.target_id)
    .maybeSingle<{
      id: string;
      organization_id: string;
      lead_id: string | null;
      starts_at: string;
      broker_post_visit_checked_at: string | null;
    }>();

  if (!appointment || appointment.broker_post_visit_checked_at) return markDone(supabase, job.id, "cancelled", "already_checked");

  const { data: assignment } = await supabase
    .from("broker_assignments")
    .select("id, brokers(name, phone), leads(name, phone, summary)")
    .eq("lead_id", appointment.lead_id ?? "")
    .order("assigned_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; brokers: { name: string; phone: string } | null; leads: { name: string | null; phone: string; summary: string | null } | null }>();

  if (assignment?.brokers?.phone) {
    await sendUazapiMessage({
      phone: assignment.brokers.phone,
      text: `Ola, ${assignment.brokers.name}. Como foi a visita do lead ${assignment.leads?.name ?? assignment.leads?.phone ?? ""}? Teve proposta ou proximo passo?`
    });
  }
  await supabase.from("appointments").update({ broker_post_visit_checked_at: new Date().toISOString() }).eq("id", job.target_id);
  return markDone(supabase, job.id, "done", "post_visit_checked");
}

export async function processManualReminder(supabase: SupabaseClient, job: JobLike) {
  if (!job.target_id) return markDone(supabase, job.id, "cancelled", "missing_reminder");
  const { data: reminder } = await supabase
    .from("reminders")
    .select("id, organization_id, lead_id, title, message, status, leads(name, phone)")
    .eq("id", job.target_id)
    .maybeSingle<{ id: string; organization_id: string; lead_id: string | null; title: string; message: string; status: string; leads: { name: string | null; phone: string } | null }>();

  if (!reminder || reminder.status !== "pending") return markDone(supabase, job.id, "cancelled", "reminder_not_pending");
  await notifyAdmin(supabase, reminder.organization_id, `Lembrete: ${reminder.title}\n\n${reminder.message}\nLead: ${reminder.leads?.name ?? reminder.leads?.phone ?? "sem lead"}`);
  await supabase.from("reminders").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", reminder.id);
  return markDone(supabase, job.id, "done", "manual_reminder_sent");
}

type JobLike = {
  id: string;
  organization_id: string;
  target_id: string | null;
  payload: Record<string, unknown>;
};

function job(organizationId: string, jobType: string, targetId: string, delayMinutes: number, payload: Record<string, unknown>) {
  return {
    organization_id: organizationId,
    job_type: jobType,
    target_id: targetId,
    status: "pending",
    delayMinutes,
    payload
  };
}

async function getAssignmentContext(supabase: SupabaseClient, job: JobLike) {
  if (!job.target_id) return null;
  const { data } = await supabase
    .from("broker_assignments")
    .select("id, organization_id, lead_id, broker_id, status, assigned_at, responded_at, leads(id, name, phone, stage, summary, last_stage_updated_at, last_broker_response_at), brokers(id, name, phone)")
    .eq("id", job.target_id)
    .maybeSingle<AssignmentContext>();
  return data ?? null;
}

async function getAssignmentContextByLead(supabase: SupabaseClient, job: JobLike) {
  if (!job.target_id) return null;
  const { data } = await supabase
    .from("broker_assignments")
    .select("id, organization_id, lead_id, broker_id, status, assigned_at, responded_at, leads(id, name, phone, stage, summary, last_stage_updated_at, last_broker_response_at), brokers(id, name, phone)")
    .eq("organization_id", job.organization_id)
    .eq("lead_id", job.target_id)
    .order("assigned_at", { ascending: false })
    .limit(1)
    .maybeSingle<AssignmentContext>();
  return data ?? null;
}

async function notifyBroker(context: AssignmentContext, template: string) {
  if (!context.brokers?.phone) return;
  await sendUazapiMessage({
    phone: context.brokers.phone,
    text: renderTemplate(template, {
      broker_name: context.brokers.name,
      lead_name: leadName(context),
      lead_phone: context.leads?.phone,
      summary: context.leads?.summary
    })
  });
}

async function notifyAdmin(supabase: SupabaseClient, organizationId: string, text: string) {
  const phone = await getAdminPhone(supabase, organizationId);
  if (!phone) {
    await supabase.from("integration_logs").insert({
      organization_id: organizationId,
      provider: "uazapi",
      target_type: "admin_notification",
      status: "failed",
      request_payload: { text },
      response_payload: {},
      error_message: "ADMIN_WHATSAPP_PHONE/CRIS_PHONE ausente e nenhum admin com telefone."
    });
    return;
  }

  await sendUazapiMessage({ phone, text });
}

async function getAdminPhone(supabase: SupabaseClient, organizationId: string) {
  const envPhone = process.env.CRIS_PHONE || process.env.ADMIN_WHATSAPP_PHONE;
  if (envPhone) return envPhone.replace(/\D/g, "");
  const { data: profile } = await supabase
    .from("profiles")
    .select("phone")
    .eq("organization_id", organizationId)
    .in("role", ["admin", "manager"])
    .not("phone", "is", null)
    .limit(1)
    .maybeSingle<{ phone: string | null }>();
  return profile?.phone?.replace(/\D/g, "") || null;
}

async function reclaimLeadToAdmin(supabase: SupabaseClient, context: AssignmentContext, reason: string) {
  const now = new Date().toISOString();
  await Promise.all([
    supabase.from("broker_assignments").update({ status: "no_response", reclaimed_at: now }).eq("id", context.id),
    supabase
      .from("leads")
      .update({
        stage: "no_response",
        last_stage_updated_at: now,
        reclaimed_at: now,
        lost_reason: reason
      })
      .eq("id", context.lead_id)
  ]);
  await notifyAdmin(
    supabase,
    context.organization_id,
    `Cris, o lead ${leadName(context)} precisa de redistribuicao.\nMotivo: ${reason}\nCorretor atual: ${context.brokers?.name ?? "-"}\nTelefone lead: ${context.leads?.phone ?? "-"}`
  );
}

async function markDone(supabase: SupabaseClient, jobId: string, status: "done" | "cancelled", reason: string) {
  await supabase
    .from("scheduled_jobs")
    .update({ status, executed_at: new Date().toISOString(), payload: { result: { reason } } })
    .eq("id", jobId);
  return { status, reason };
}

function leadName(context: AssignmentContext) {
  return context.leads?.name || context.leads?.phone || "lead";
}

function normalizeStage(stage: string) {
  return stage
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "_");
}
