import { NextResponse } from "next/server";
import { normalizeBrazilianPhone } from "@/lib/phone";
import { scheduleBrokerProgressChecks } from "@/services/broker-sla/workflow";
import { createAdminClient } from "@/lib/supabase/admin";

type UazapiPayload = {
  phone?: string;
  from?: string;
  text?: string;
  message?: string;
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
      await supabase.from("webhook_logs").insert({
        organization_id: adminProfile.organization_id,
        provider: "uazapi",
        event_type: "admin_message",
        payload,
        status: "processed_admin"
      });

      return NextResponse.json({ processed: true, role: "admin" });
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
    return NextResponse.json({ processed: false });
  }

  const { data: assignment } = await supabase
    .from("broker_assignments")
    .select("id, lead_id")
    .eq("organization_id", broker.organization_id)
    .eq("broker_id", broker.id)
    .eq("status", "assigned")
    .order("assigned_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; lead_id: string }>();

  if (!assignment) {
    return NextResponse.json({ processed: false });
  }

  const now = new Date().toISOString();

  await Promise.all([
    supabase
      .from("broker_assignments")
      .update({ status: "accepted", responded_at: now })
      .eq("id", assignment.id),
    supabase
      .from("leads")
      .update({
        stage: "broker_attending",
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

  await scheduleBrokerProgressChecks({
    supabase,
    organizationId: broker.organization_id,
    assignmentId: assignment.id,
    leadId: assignment.lead_id,
    brokerId: broker.id
  });

  return NextResponse.json({ processed: true });
}
