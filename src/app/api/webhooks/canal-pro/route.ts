import { NextResponse } from "next/server";
import { normalizeBrazilianPhone } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";

type CanalProPayload = {
  organization_id?: string;
  name?: string;
  phone?: string;
  interest?: string;
  region?: string;
  budget?: number;
  message?: string;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as CanalProPayload;
  const phone = normalizeBrazilianPhone(payload.phone);

  if (!payload.organization_id || !phone) {
    return NextResponse.json(
      { error: "organization_id e phone sao obrigatorios neste placeholder." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .insert({
      organization_id: payload.organization_id,
      name: payload.name ?? null,
      phone,
      raw_data: payload,
      status: "responded"
    })
    .select("id")
    .single<{ id: string }>();

  if (contactError || !contact) {
    return NextResponse.json({ error: contactError?.message }, { status: 500 });
  }

  const { data: conversation } = await supabase
    .from("conversations")
    .insert({
      organization_id: payload.organization_id,
      contact_id: contact.id,
      status: "open",
      current_stage: "ai_attending",
      ai_enabled: true,
      last_message_at: new Date().toISOString(),
      window_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    })
    .select("id")
    .single<{ id: string }>();

  const { data: lead } = await supabase
    .from("leads")
    .insert({
      organization_id: payload.organization_id,
      contact_id: contact.id,
      conversation_id: conversation?.id ?? null,
      name: payload.name ?? null,
      phone,
      source: "canal_pro",
      interest: payload.interest ?? null,
      region: payload.region ?? null,
      budget: payload.budget ?? null,
      qualification_status: "new",
      score: 30,
      summary: payload.message ?? "Lead recebido pelo Canal Pro.",
      stage: "ai_attending"
    })
    .select("id")
    .single<{ id: string }>();

  await supabase.from("webhook_logs").insert({
    organization_id: payload.organization_id,
    provider: "canal_pro",
    event_type: "lead",
    payload,
    status: "processed"
  });

  return NextResponse.json({
    contactId: contact.id,
    conversationId: conversation?.id ?? null,
    leadId: lead?.id ?? null
  });
}
