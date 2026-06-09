import { NextResponse } from "next/server";
import { normalizeBrazilianPhone } from "@/lib/phone";
import { scheduleBrokerProgressChecks } from "@/services/broker-sla/workflow";
import { createAdminClient } from "@/lib/supabase/admin";
import { processUazapiLeadMessage } from "@/services/uazapi/lead-workflow";

type UazapiPayload = {
  phone?: string;
  from?: string;
  text?: string;
  message?: string;
  clienteID?: string;
  clienteId?: string;
  hauzapp_cliente_id?: string;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as UazapiPayload;
  const phone = normalizeBrazilianPhone(payload.phone || payload.from);
  const text = payload.text || payload.message || "";

  if (!phone) {
    return NextResponse.json({ error: "Telefone nao identificado." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: broker } = await supabase
    .from("brokers")
    .select("id, organization_id")
    .eq("phone", phone)
    .maybeSingle<{ id: string; organization_id: string }>();

  if (!broker) {
    const { data: adminProfile } = await supabase
      .from("profiles")
      .select("id, organization_id")
      .eq("phone", phone)
      .in("role", ["admin", "manager"])
      .limit(1)
      .maybeSingle<{ id: string; organization_id: string }>();

    if (adminProfile) {
      const adminResult = await processAdminMessage({
        supabase,
        organizationId: adminProfile.organization_id,
        text,
        payload
      });
      await supabase.from("webhook_logs").insert({
        organization_id: adminProfile.organization_id,
        provider: "uazapi",
        event_type: "admin_message",
        payload,
        status: adminResult.updated ? "processed_admin_update" : "processed_admin"
      });

      return NextResponse.json({ processed: true, role: "admin", ...adminResult });
    }
  }

  await supabase.from("webhook_logs").insert({
    organization_id: broker?.organization_id ?? null,
    provider: "uazapi",
    event_type: "broker_message",
    payload,
    status: broker ? "processed" : "ignored_no_broker"
  });

  if (!broker) {
    const organizationId = await resolveLeadOrganization(supabase, phone);

    if (!organizationId) {
      return NextResponse.json({ processed: false, reason: "organization_not_found" });
    }

    const result = await processUazapiLeadMessage({
      supabase,
      organizationId,
      phone,
      text,
      payload,
      hauzappClienteId: getHauzappClienteId(payload)
    });

    return NextResponse.json(result);
  }

  const { data: assignment } = await supabase
    .from("broker_assignments")
    .select("id, lead_id, status, responded_at")
    .eq("organization_id", broker.organization_id)
    .eq("broker_id", broker.id)
    .in("status", ["assigned", "accepted", "no_response"])
    .order("assigned_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; lead_id: string; status: string; responded_at: string | null }>();

  if (!assignment) {
    return NextResponse.json({ processed: false });
  }

  const now = new Date().toISOString();
  const firstBrokerReply = assignment.status === "assigned" || !assignment.responded_at;
  const stage = inferBrokerStage(text);

  await Promise.all([
    supabase
      .from("broker_assignments")
      .update({ status: "accepted", responded_at: assignment.responded_at ?? now })
      .eq("id", assignment.id),
    supabase
      .from("leads")
      .update({
        stage,
        last_stage_updated_at: now,
        last_broker_response_at: now
      })
      .eq("id", assignment.lead_id),
    supabase.from("messages").insert({
      organization_id: broker.organization_id,
      direction: "inbound",
      channel: "uazapi",
      type: "text",
      content: text,
      status: "received",
      payload
    })
  ]);

  if (firstBrokerReply) {
    await scheduleBrokerProgressChecks({
      supabase,
      organizationId: broker.organization_id,
      assignmentId: assignment.id,
      leadId: assignment.lead_id,
      brokerId: broker.id
    });
  }

  return NextResponse.json({ processed: true, firstBrokerReply, stage });
}

async function resolveLeadOrganization(
  supabase: ReturnType<typeof createAdminClient>,
  phone: string
) {
  const { data: contact } = await supabase
    .from("contacts")
    .select("organization_id")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ organization_id: string }>();

  if (contact?.organization_id) {
    return contact.organization_id;
  }

  const { data: lead } = await supabase
    .from("leads")
    .select("organization_id")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ organization_id: string }>();

  if (lead?.organization_id) {
    return lead.organization_id;
  }

  const { data: integration } = await supabase
    .from("integrations")
    .select("organization_id")
    .eq("provider", "uazapi")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ organization_id: string }>();

  return integration?.organization_id ?? null;
}

function getHauzappClienteId(payload: UazapiPayload) {
  return payload.hauzapp_cliente_id || payload.clienteID || payload.clienteId || null;
}

async function processAdminMessage({
  supabase,
  organizationId,
  text,
  payload
}: {
  supabase: ReturnType<typeof createAdminClient>;
  organizationId: string;
  text: string;
  payload: unknown;
}) {
  const stage = inferAdminStage(text);

  if (!stage) {
    return { updated: false, reason: "no_stage_command" };
  }

  const { data: assignment } = await supabase
    .from("broker_assignments")
    .select("id, lead_id")
    .eq("organization_id", organizationId)
    .in("status", ["assigned", "accepted", "no_response"])
    .order("assigned_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; lead_id: string }>();

  if (!assignment) {
    return { updated: false, reason: "no_assignment_to_update" };
  }

  const now = new Date().toISOString();
  await Promise.all([
    supabase
      .from("leads")
      .update({
        stage,
        last_stage_updated_at: now,
        last_broker_response_at: now,
        summary: `Atualizacao da Cris/Admin via WhatsApp: ${text}`
      })
      .eq("id", assignment.lead_id),
    supabase.from("integration_logs").insert({
      organization_id: organizationId,
      provider: "uazapi",
      target_type: "admin_lead_update",
      target_id: assignment.lead_id,
      status: "done",
      request_payload: { text, payload },
      response_payload: { stage },
      error_message: null
    })
  ]);

  return { updated: true, leadId: assignment.lead_id, stage };
}

function inferAdminStage(text: string) {
  return inferStageFromText(text, false);
}

function inferBrokerStage(text: string) {
  return inferStageFromText(text, true) ?? "broker_attending";
}

function inferStageFromText(text: string, fallbackToAttending: boolean) {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (normalized.includes("ganhou") || normalized.includes("fechou")) return "won";
  if (normalized.includes("perdeu") || normalized.includes("sem interesse")) return "lost";
  if (normalized.includes("proposta")) return "proposal";
  if (normalized.includes("visita")) return "visit";
  if (normalized.includes("cliente quente") || normalized.includes("quente")) return "cliente_quente";
  if (normalized.includes("reaquecer")) return "reaquecer";
  if (normalized.includes("atendimento")) return "broker_attending";
  if (normalized.includes("iniciei") || normalized.includes("iniciado")) return "broker_attending";
  if (normalized.includes("contato") || normalized.includes("falei")) return "broker_attending";

  return fallbackToAttending ? "broker_attending" : null;
}
