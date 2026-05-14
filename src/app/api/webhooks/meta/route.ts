import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { runLeadAgent } from "@/agents/lead-agent";
import { createVisitAppointment, getAvailableWindows } from "@/services/calendar/appointments";
import { scheduleLeadFollowups } from "@/services/followups/lead-followups";
import { upsertLeadFromQualification } from "@/services/leads/workflow";
import { enqueueHumanizedMetaMessages } from "@/services/messaging/enqueue-humanized";
import { createAdminClient } from "@/lib/supabase/admin";

type MetaStatus = {
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: unknown[];
};

type MetaMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  audio?: { id?: string; mime_type?: string };
  video?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; filename?: string; caption?: string };
};

type MetaChangeValue = {
  messages?: MetaMessage[];
  statuses?: MetaStatus[];
};

type MetaWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: MetaChangeValue;
    }>;
  }>;
};

type ContactLookup = {
  id: string;
  organization_id: string;
  campaign_id: string | null;
  name: string | null;
  phone: string;
};

type ConversationLookup = {
  id: string;
  ai_enabled: boolean;
};

type AgentMessage = {
  direction: "inbound" | "outbound";
  content: string | null;
};

type AgentCampaign = {
  agent_id: string | null;
  property_description: string | null;
  agent_prompt: string | null;
};

type CampaignMaterial = {
  title: string;
  description: string | null;
  media_type: string;
  media_url: string;
};

type AgentConfig = {
  name: string;
  description: string | null;
  openai_model: string;
  system_prompt: string;
  greeting_template: string | null;
  humanization_rules: string | null;
  forbidden_phrases: string | null;
  conversation_examples: string | null;
  agent_skills: string | null;
  qualification_criteria: string | null;
  handoff_instructions: string | null;
  message_split_enabled: boolean;
  typing_words_per_minute: number;
  appointment_enabled: boolean;
  appointment_duration_minutes: number;
  weekly_availability: Record<string, Array<{ start: string; end: string }>>;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Invalid verify token." }, { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const n8nWebhookSecret = process.env.N8N_WEBHOOK_SECRET;
  const trustedN8nRequest =
    Boolean(n8nWebhookSecret) &&
    request.headers.get("authorization") === `Bearer ${n8nWebhookSecret}`;

  if (!trustedN8nRequest && !isValidMetaSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid Meta signature." }, { status: 401 });
  }

  const payload = JSON.parse(rawBody || "{}") as MetaWebhookPayload;
  const supabase = createAdminClient();
  const processed = { inbound: 0, statuses: 0 };

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;

      for (const status of value?.statuses ?? []) {
        if (!status.id) {
          continue;
        }

        await supabase
          .from("messages")
          .update({
            status: status.status ?? "unknown",
            payload: status
          })
          .eq("external_message_id", status.id);
        processed.statuses += 1;
      }

      for (const message of value?.messages ?? []) {
        if (!message.from) {
          continue;
        }

        const phoneCandidates = getBrazilianPhoneCandidates(message.from);
        const { data: contact } = await supabase
          .from("contacts")
          .select("id, organization_id, campaign_id, name, phone")
          .in("phone", phoneCandidates)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle<ContactLookup>();

        await supabase.from("webhook_logs").insert({
          organization_id: contact?.organization_id ?? null,
          provider: "meta",
          event_type: message.type ?? "message",
          payload,
          status: contact ? "processed" : "ignored_no_contact"
        });

        if (!contact) {
          continue;
        }

        const now = new Date();
        const { data: existingConversation } = await supabase
          .from("conversations")
          .select("id, ai_enabled")
          .eq("organization_id", contact.organization_id)
          .eq("contact_id", contact.id)
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle<ConversationLookup>();

        const conversation =
          existingConversation ??
          (
            await supabase
              .from("conversations")
              .insert({
                organization_id: contact.organization_id,
                contact_id: contact.id,
                campaign_id: contact.campaign_id,
                status: "open",
                current_stage: "new",
                ai_enabled: true,
                last_message_at: now.toISOString(),
                window_expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
              })
              .select("id, ai_enabled")
              .single<ConversationLookup>()
          ).data;

        const conversationId = conversation?.id;

        if (!conversationId) {
          continue;
        }

        await Promise.all([
          supabase.from("messages").insert({
            organization_id: contact.organization_id,
            conversation_id: conversationId,
            contact_id: contact.id,
            direction: "inbound",
            channel: "meta",
            type: normalizeMessageType(message.type),
            content: getMessageContent(message),
            media_url: getMediaId(message),
            status: "received",
            external_message_id: message.id,
            payload: message
          }),
          supabase
            .from("conversations")
            .update({
              last_message_at: now.toISOString(),
              window_expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
            })
            .eq("id", conversationId),
          supabase.from("contacts").update({ status: "responded" }).eq("id", contact.id)
        ]);

        if (conversation.ai_enabled) {
          await respondWithAgent({
            supabase,
            organizationId: contact.organization_id,
            contact,
            conversationId
          });
        }

        processed.inbound += 1;
      }
    }
  }

  return NextResponse.json(processed);
}

function isValidMetaSignature(rawBody: string, signatureHeader: string | null) {
  const appSecret = process.env.META_APP_SECRET;

  if (!appSecret) {
    return true;
  }

  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const received = Buffer.from(signatureHeader.replace("sha256=", ""), "hex");
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody).digest("hex"), "hex");

  if (received.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(received, expected);
}

function normalizeMessageType(type: string | undefined) {
  if (type === "image" || type === "audio" || type === "video" || type === "document") {
    return type;
  }

  return "text";
}

function getMessageContent(message: MetaMessage) {
  if (message.text?.body) {
    return message.text.body;
  }

  return (
    message.image?.caption ||
    message.video?.caption ||
    message.document?.caption ||
    message.document?.filename ||
    null
  );
}

function getMediaId(message: MetaMessage) {
  return message.image?.id || message.audio?.id || message.video?.id || message.document?.id || null;
}

function getBrazilianPhoneCandidates(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const candidates = new Set([digits]);

  if (digits.startsWith("55") && digits.length === 12) {
    const ddd = digits.slice(2, 4);
    const local = digits.slice(4);
    candidates.add(`55${ddd}9${local}`);
  }

  if (digits.startsWith("55") && digits.length === 13 && digits[4] === "9") {
    candidates.add(`55${digits.slice(2, 4)}${digits.slice(5)}`);
  }

  return Array.from(candidates);
}

async function respondWithAgent({
  supabase,
  organizationId,
  contact,
  conversationId
}: {
  supabase: ReturnType<typeof createAdminClient>;
  organizationId: string;
  contact: ContactLookup;
  conversationId: string;
}) {
  const [{ data: campaign }, { data: messages }, { data: materials }] = await Promise.all([
    contact.campaign_id
      ? supabase
          .from("campaigns")
          .select("agent_id, property_description, agent_prompt")
          .eq("id", contact.campaign_id)
          .maybeSingle<AgentCampaign>()
      : Promise.resolve({ data: null }),
    supabase
      .from("messages")
      .select("direction, content")
      .eq("organization_id", organizationId)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(30)
      .returns<AgentMessage[]>(),
    contact.campaign_id
      ? supabase
          .from("campaign_materials")
          .select("title, description, media_type, media_url")
          .eq("organization_id", organizationId)
          .eq("campaign_id", contact.campaign_id)
          .eq("active", true)
          .returns<CampaignMaterial[]>()
      : Promise.resolve({ data: [] })
  ]);
  const { data: agent } = campaign?.agent_id
    ? await supabase
        .from("ai_agents")
        .select("name, description, openai_model, system_prompt, greeting_template, humanization_rules, forbidden_phrases, conversation_examples, agent_skills, qualification_criteria, handoff_instructions, message_split_enabled, typing_words_per_minute, appointment_enabled, appointment_duration_minutes, weekly_availability")
        .eq("id", campaign.agent_id)
        .eq("organization_id", organizationId)
        .eq("active", true)
        .maybeSingle<AgentConfig>()
    : { data: null };

  const { data: agentMaterials } = campaign?.agent_id
    ? await supabase
        .from("agent_materials")
        .select("title, description, media_type, public_url")
        .eq("organization_id", organizationId)
        .eq("agent_id", campaign.agent_id)
        .eq("active", true)
        .returns<Array<{ title: string; description: string | null; media_type: string; public_url: string | null }>>()
    : { data: [] };

  const qualification = await runLeadAgent({
    contact: {
      name: contact.name,
      phone: contact.phone
    },
    campaign: campaign
      ? {
          ...campaign,
          property_description: [
            campaign.property_description,
            materials?.length
              ? `Materiais disponiveis para enviar quando fizer sentido:\n${materials
                  .map((material) => `- ${material.title} (${material.media_type}): ${material.media_url}`)
                  .join("\n")}`
              : null,
            agentMaterials?.length
              ? `Materiais do agente para usar quando o lead pedir PDF, imagem ou mais detalhes:\n${agentMaterials
                  .map((material) => `- ${material.title} (${material.media_type}): ${material.public_url || "arquivo interno"}${material.description ? ` - ${material.description}` : ""}`)
                  .join("\n")}`
              : null
          ]
            .filter(Boolean)
            .join("\n\n")
        }
      : campaign,
    agent,
    messages: messages ?? []
  });

  const lead = await upsertLeadFromQualification({
    supabase,
    organizationId,
    contactId: contact.id,
    campaignId: contact.campaign_id,
    conversationId,
    qualification
  });
  let reply = qualification.reply;

  if (qualification.wantsVisit && agent?.appointment_enabled) {
    const windows = getAvailableWindows({
      durationMinutes: agent.appointment_duration_minutes,
      availability: agent.weekly_availability
    });

    if (windows.length > 0) {
      const options = windows
        .slice(0, 3)
        .map((window) =>
          new Intl.DateTimeFormat("pt-BR", {
            weekday: "long",
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
          }).format(new Date(window.startsAt))
        )
        .join("\n");

      reply = `${reply}\n\nTenho esses horários para a visita ao decorado:\n${options}\n\nQual deles fica melhor pra você?`;

      await createVisitAppointment({
        supabase,
        organizationId,
        leadId: lead.id,
        conversationId,
        contactId: contact.id,
        agentId: campaign?.agent_id ?? null,
        title: `Visita decorado - ${contact.name ?? contact.phone}`,
        description: qualification.summary,
        startsAt: windows[0].startsAt,
        durationMinutes: agent.appointment_duration_minutes
      });
    }
  }

  const sentAt = new Date().toISOString();
  await supabase
    .from("conversations")
    .update({
      current_stage: qualification.stage,
      last_message_at: sentAt
    })
    .eq("id", conversationId);

  await enqueueHumanizedMetaMessages({
    supabase,
    organizationId,
    conversationId,
    contactId: contact.id,
    phone: contact.phone,
    text: reply,
    splitEnabled: agent?.message_split_enabled ?? true,
    wordsPerMinute: agent?.typing_words_per_minute ?? 150
  });

  await scheduleLeadFollowups({
    supabase,
    organizationId,
    conversationId,
    contactId: contact.id,
    scheduledAfter: sentAt
  });
}
