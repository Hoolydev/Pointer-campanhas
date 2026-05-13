import type { SupabaseClient } from "@supabase/supabase-js";
import { renderTemplate } from "@/lib/templates";
import { sendMetaMessage } from "@/services/meta/send-message";

type ConversationForFollowup = {
  id: string;
  organization_id: string;
  contact_id: string | null;
  campaign_id: string | null;
  window_expires_at: string | null;
  contacts: {
    id: string;
    name: string | null;
    phone: string;
  } | null;
};

type FollowupRule = {
  id: string;
  delay_minutes: number;
  message_template: string;
};

type FollowupJobPayload = {
  conversationId: string;
  contactId: string;
  ruleId: string;
  scheduledAfter: string;
};

export async function scheduleLeadFollowups({
  supabase,
  organizationId,
  conversationId,
  contactId,
  scheduledAfter
}: {
  supabase: SupabaseClient;
  organizationId: string;
  conversationId: string;
  contactId: string;
  scheduledAfter: string;
}) {
  const { data: rules } = await supabase
    .from("followup_rules")
    .select("id, delay_minutes, message_template")
    .eq("organization_id", organizationId)
    .eq("type", "lead")
    .eq("active", true)
    .order("delay_minutes", { ascending: true })
    .returns<FollowupRule[]>();

  if (!rules?.length) {
    return;
  }

  const base = new Date(scheduledAfter).getTime();

  await supabase.from("scheduled_jobs").insert(
    rules.map((rule) => ({
      organization_id: organizationId,
      job_type: "lead_followup",
      target_id: conversationId,
      status: "pending",
      run_at: new Date(base + rule.delay_minutes * 60 * 1000).toISOString(),
      payload: {
        conversationId,
        contactId,
        ruleId: rule.id,
        scheduledAfter
      }
    }))
  );
}

export async function processLeadFollowup({
  supabase,
  organizationId,
  payload
}: {
  supabase: SupabaseClient;
  organizationId: string;
  payload: FollowupJobPayload;
}) {
  const [{ data: inboundAfter }, { data: conversation }, { data: rule }] = await Promise.all([
    supabase
      .from("messages")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("conversation_id", payload.conversationId)
      .eq("direction", "inbound")
      .gt("created_at", payload.scheduledAfter)
      .limit(1)
      .maybeSingle<{ id: string }>(),
    supabase
      .from("conversations")
      .select("id, organization_id, contact_id, campaign_id, window_expires_at, contacts(id, name, phone)")
      .eq("organization_id", organizationId)
      .eq("id", payload.conversationId)
      .single<ConversationForFollowup>(),
    supabase
      .from("followup_rules")
      .select("id, delay_minutes, message_template")
      .eq("organization_id", organizationId)
      .eq("id", payload.ruleId)
      .single<FollowupRule>()
  ]);

  if (inboundAfter) {
    return { status: "cancelled", reason: "lead_responded" };
  }

  if (!conversation?.contacts || !rule) {
    return { status: "cancelled", reason: "missing_context" };
  }

  if (conversation.window_expires_at && new Date(conversation.window_expires_at).getTime() < Date.now()) {
    await supabase
      .from("contacts")
      .update({ status: "requires_template" })
      .eq("id", conversation.contacts.id);
    await supabase.from("scheduled_jobs").insert({
      organization_id: organizationId,
      job_type: "lead_template_followup",
      target_id: conversation.id,
      status: "pending",
      run_at: new Date().toISOString(),
      payload: {
        conversationId: conversation.id,
        contactId: conversation.contacts.id,
        phone: conversation.contacts.phone,
        ruleId: rule.id,
        templateName: process.env.META_DEFAULT_FOLLOWUP_TEMPLATE || null,
        languageCode: process.env.META_DEFAULT_TEMPLATE_LANGUAGE || "pt_BR"
      }
    });
    return { status: "done", reason: "requires_template" };
  }

  const text = renderTemplate(rule.message_template, {
    lead_name: conversation.contacts.name,
    nome: conversation.contacts.name,
    phone: conversation.contacts.phone,
    telefone: conversation.contacts.phone
  });

  const result = await sendMetaMessage({
    phone: conversation.contacts.phone,
    text
  });

  await Promise.all([
    supabase.from("messages").insert({
      organization_id: organizationId,
      conversation_id: conversation.id,
      contact_id: conversation.contacts.id,
      direction: "outbound",
      channel: "meta",
      type: "text",
      content: text,
      status: "sent",
      external_message_id: result.externalMessageId,
      payload: result.payload
    }),
    supabase
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conversation.id)
  ]);

  return { status: "done", reason: "sent" };
}
