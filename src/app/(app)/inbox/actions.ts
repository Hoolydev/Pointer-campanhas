"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/organization";
import { scheduleLeadFollowups } from "@/services/followups/lead-followups";
import { configString, getActiveIntegrationConfig } from "@/services/integrations/config";
import { enqueueHauzappQualifiedLead } from "@/services/leads/workflow";
import { sendMetaMessage } from "@/services/meta/send-message";
import { sendUazapiMessage } from "@/services/uazapi/send-message";
import { createClient } from "@/lib/supabase/server";

const replySchema = z.object({
  conversation_id: z.string().uuid(),
  content: z.string().min(1).max(4000)
});

type ConversationForReply = {
  id: string;
  organization_id: string;
  contact_id: string | null;
  channel: string | null;
  contacts: {
    id: string;
    phone: string;
  } | null;
};

export async function sendManualReplyAction(formData: FormData) {
  const parsed = replySchema.safeParse({
    conversation_id: formData.get("conversation_id"),
    content: formData.get("content")
  });

  if (!parsed.success) {
    return;
  }

  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile) {
    return;
  }

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, organization_id, contact_id, channel, contacts(id, phone)")
    .eq("id", parsed.data.conversation_id)
    .eq("organization_id", profile.organization_id)
    .single<ConversationForReply>();

  if (!conversation?.contacts) {
    return;
  }

  const isUazapi = conversation.channel === "uazapi";
  const result = isUazapi
    ? await sendUazapiManualReply({
        supabase,
        organizationId: profile.organization_id,
        phone: conversation.contacts.phone,
        text: parsed.data.content
      })
    : await sendMetaMessage({
        phone: conversation.contacts.phone,
        text: parsed.data.content
      });

  const now = new Date().toISOString();

  await Promise.all([
    supabase.from("messages").insert({
      organization_id: profile.organization_id,
      conversation_id: conversation.id,
      contact_id: conversation.contacts.id,
      direction: "outbound",
      channel: isUazapi ? "uazapi" : "meta",
      type: "text",
      content: parsed.data.content,
      status: "sent",
      external_message_id: result.externalMessageId,
      payload: result.payload
    }),
    supabase.from("conversations").update({ last_message_at: now }).eq("id", conversation.id)
  ]);

  await scheduleLeadFollowups({
    supabase,
    organizationId: profile.organization_id,
    conversationId: conversation.id,
    contactId: conversation.contacts.id,
    scheduledAfter: now
  });

  revalidatePath("/inbox");
}

async function sendUazapiManualReply({
  supabase,
  organizationId,
  phone,
  text
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  organizationId: string;
  phone: string;
  text: string;
}) {
  const config = await getActiveIntegrationConfig(supabase, organizationId, "uazapi");
  const payload = await sendUazapiMessage({
    phone,
    text,
    integrationConfig: {
      baseUrl: configString(config, ["baseUrl", "base_url", "url"], process.env.UAZAPI_BASE_URL) ?? undefined,
      token: configString(config, ["token", "apiKey", "api_key"], process.env.UAZAPI_TOKEN) ?? undefined
    }
  });

  const payloadRecord = payload as Record<string, unknown>;
  const externalMessageId =
    typeof payloadRecord.id === "string"
      ? payloadRecord.id
      : typeof payloadRecord.messageId === "string"
        ? payloadRecord.messageId
        : null;

  return {
    externalMessageId,
    payload
  };
}

export async function toggleAiAction(formData: FormData) {
  const conversationId = String(formData.get("conversation_id") ?? "");
  const aiEnabled = String(formData.get("ai_enabled") ?? "") === "true";
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile || !conversationId) {
    return;
  }

  await supabase
    .from("conversations")
    .update({ ai_enabled: !aiEnabled })
    .eq("id", conversationId)
    .eq("organization_id", profile.organization_id);

  revalidatePath("/inbox");
}

export async function qualifyManuallyAction(formData: FormData) {
  const conversationId = String(formData.get("conversation_id") ?? "");
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile || !conversationId) {
    return;
  }

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, contact_id, campaign_id, contacts(name, phone)")
    .eq("id", conversationId)
    .eq("organization_id", profile.organization_id)
    .single<{
      id: string;
      contact_id: string | null;
      campaign_id: string | null;
      contacts: { name: string | null; phone: string } | null;
    }>();

  if (!conversation?.contact_id || !conversation.contacts) {
    return;
  }

  await Promise.all([
    supabase.from("leads").insert({
      organization_id: profile.organization_id,
      contact_id: conversation.contact_id,
      campaign_id: conversation.campaign_id,
      conversation_id: conversation.id,
      name: conversation.contacts.name,
      phone: conversation.contacts.phone,
      source: "campaign",
      qualification_status: "qualified",
      score: 80,
      summary: "Lead qualificado manualmente pela Inbox.",
      stage: "qualified",
      last_stage_updated_at: new Date().toISOString()
    }),
    supabase
      .from("conversations")
      .update({ current_stage: "qualified" })
      .eq("id", conversation.id)
  ]);

  revalidatePath("/inbox");
  revalidatePath("/crm");
}

export async function sendToBrokerAction(formData: FormData) {
  const conversationId = String(formData.get("conversation_id") ?? "");
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile || !conversationId) {
    return;
  }

  const { data: lead } = await supabase
    .from("leads")
    .select("id, name, phone, interest, region, budget, payment_method, score, summary")
    .eq("organization_id", profile.organization_id)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string;
      name: string | null;
      phone: string;
      interest: string | null;
      region: string | null;
      budget: number | null;
      payment_method: string | null;
      score: number;
      summary: string | null;
    }>();

  if (!lead) {
    return;
  }

  await enqueueHauzappQualifiedLead({
    supabase,
    organizationId: profile.organization_id,
    leadId: lead.id,
    reason: "manual_inbox_send_to_hauzapp"
  });

  revalidatePath("/inbox");
  revalidatePath("/crm");
}
