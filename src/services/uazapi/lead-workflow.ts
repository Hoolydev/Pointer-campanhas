import type { SupabaseClient } from "@supabase/supabase-js";
import { runLeadAgent } from "@/agents/lead-agent";
import { normalizeBrazilianPhone } from "@/lib/phone";
import { configString, getActiveIntegrationConfig } from "@/services/integrations/config";
import { upsertLeadFromQualification } from "@/services/leads/workflow";
import { sendUazapiMessage } from "@/services/uazapi/send-message";

type AgentConfig = {
  id: string;
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
};

type LeadMessageInput = {
  supabase: SupabaseClient;
  organizationId: string;
  phone: string;
  text: string;
  payload: unknown;
  hauzappClienteId?: string | null;
};

export async function processUazapiLeadMessage({
  supabase,
  organizationId,
  phone,
  text,
  payload,
  hauzappClienteId
}: LeadMessageInput) {
  const normalizedPhone = normalizeBrazilianPhone(phone) ?? phone.replace(/\D/g, "");
  const { contact, conversation } = await findOrCreateUazapiConversation({
    supabase,
    organizationId,
    phone: normalizedPhone,
    payload,
    hauzappClienteId
  });

  await supabase.from("messages").insert({
    organization_id: organizationId,
    conversation_id: conversation.id,
    contact_id: contact.id,
    direction: "inbound",
    channel: "uazapi",
    type: "text",
    content: text,
    status: "received",
    payload
  });

  if (!conversation.ai_enabled) {
    return { processed: true, ai: false, conversationId: conversation.id };
  }

  const agent = await getUazapiLeadAgent(supabase, organizationId);
  const { data: messages } = await supabase
    .from("messages")
    .select("direction, content")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: true })
    .limit(30)
    .returns<Array<{ direction: "inbound" | "outbound"; content: string | null }>>();

  const qualification = await runLeadAgent({
    contact: {
      name: contact.name,
      phone: normalizedPhone
    },
    campaign: {
      property_description:
        "Lead vindo do HauzApp/Prospecção atendido pela Uazapi. Qualifique, entenda necessidade e tente conduzir para visita.",
      agent_prompt: agent?.system_prompt ?? null
    },
    agent,
    messages: messages ?? []
  });

  const lead = await upsertLeadFromQualification({
    supabase,
    organizationId,
    contactId: contact.id,
    campaignId: null,
    conversationId: conversation.id,
    qualification,
    source: "hauzapp"
  });
  const uazapiConfig = await getActiveIntegrationConfig(supabase, organizationId, "uazapi");
  const result = await sendUazapiMessage({
    phone: normalizedPhone,
    text: qualification.reply,
    integrationConfig: {
      baseUrl: configString(uazapiConfig, ["baseUrl", "base_url"], process.env.UAZAPI_BASE_URL) ?? undefined,
      token: configString(uazapiConfig, ["token", "apiKey", "api_key"], process.env.UAZAPI_TOKEN) ?? undefined
    }
  });
  const sentAt = new Date().toISOString();

  await Promise.all([
    supabase.from("messages").insert({
      organization_id: organizationId,
      conversation_id: conversation.id,
      contact_id: contact.id,
      direction: "outbound",
      channel: "uazapi",
      type: "text",
      content: qualification.reply,
      status: "sent",
      payload: result
    }),
    supabase
      .from("conversations")
      .update({
        current_stage: qualification.stage,
        last_message_at: sentAt
      })
      .eq("id", conversation.id)
  ]);

  return { processed: true, ai: true, leadId: lead.id, conversationId: conversation.id };
}

async function getUazapiLeadAgent(supabase: SupabaseClient, organizationId: string) {
  const hauzappConfig = await getActiveIntegrationConfig(supabase, organizationId, "hauzapp");
  const uazapiConfig = await getActiveIntegrationConfig(supabase, organizationId, "uazapi");
  const agentId =
    configString(hauzappConfig, ["leadAgentId", "lead_agent_id", "uazapiLeadAgentId"]) ||
    configString(uazapiConfig, ["leadAgentId", "lead_agent_id"]);

  let query = supabase
    .from("ai_agents")
    .select("id, name, description, openai_model, system_prompt, greeting_template, humanization_rules, forbidden_phrases, conversation_examples, agent_skills, qualification_criteria, handoff_instructions")
    .eq("organization_id", organizationId)
    .eq("agent_type", "lead_meta")
    .eq("active", true);

  if (agentId) {
    query = query.eq("id", agentId);
  }

  const { data } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<AgentConfig>();

  return data ?? null;
}

async function findOrCreateUazapiConversation({
  supabase,
  organizationId,
  phone,
  payload,
  hauzappClienteId
}: {
  supabase: SupabaseClient;
  organizationId: string;
  phone: string;
  payload: unknown;
  hauzappClienteId?: string | null;
}) {
  const { data: existingLead } = await supabase
    .from("leads")
    .select("id, contact_id, conversation_id, name, hauzapp_cliente_id")
    .eq("organization_id", organizationId)
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string;
      contact_id: string | null;
      conversation_id: string | null;
      name: string | null;
      hauzapp_cliente_id: string | null;
    }>();

  let contactId = existingLead?.contact_id ?? null;

  if (!contactId) {
    const { data: existingContact } = await supabase
      .from("contacts")
      .select("id, name")
      .eq("organization_id", organizationId)
      .eq("phone", phone)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; name: string | null }>();

    contactId = existingContact?.id ?? null;
  }

  if (!contactId) {
    const { data: insertedContact, error } = await supabase
      .from("contacts")
      .insert({
        organization_id: organizationId,
        campaign_id: null,
        name: existingLead?.name ?? null,
        phone,
        raw_data: { source: "uazapi", payload },
        status: "hauzapp_prospect",
        hauzapp_cliente_id: hauzappClienteId ?? existingLead?.hauzapp_cliente_id ?? null
      })
      .select("id")
      .single<{ id: string }>();

    if (error || !insertedContact) {
      throw new Error(error?.message || "Nao foi possivel criar contato Uazapi.");
    }

    contactId = insertedContact.id;
  }

  let conversationId = existingLead?.conversation_id ?? null;

  if (!conversationId) {
    const { data: existingConversation } = await supabase
      .from("conversations")
      .select("id, ai_enabled")
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .eq("channel", "uazapi")
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; ai_enabled: boolean }>();

    conversationId = existingConversation?.id ?? null;
  }

  if (!conversationId) {
    const { data: insertedConversation, error } = await supabase
      .from("conversations")
      .insert({
        organization_id: organizationId,
        contact_id: contactId,
        campaign_id: null,
        status: "open",
        current_stage: "hauzapp_prospection",
        ai_enabled: true,
        channel: "uazapi",
        hauzapp_cliente_id: hauzappClienteId ?? existingLead?.hauzapp_cliente_id ?? null,
        last_message_at: new Date().toISOString()
      })
      .select("id, ai_enabled")
      .single<{ id: string; ai_enabled: boolean }>();

    if (error || !insertedConversation) {
      throw new Error(error?.message || "Nao foi possivel criar conversa Uazapi.");
    }

    conversationId = insertedConversation.id;
  }

  const [{ data: contact }, { data: conversation }] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, name, phone")
      .eq("id", contactId)
      .single<{ id: string; name: string | null; phone: string }>(),
    supabase
      .from("conversations")
      .select("id, ai_enabled")
      .eq("id", conversationId)
      .single<{ id: string; ai_enabled: boolean }>()
  ]);

  if (!contact || !conversation) {
    throw new Error("Contato ou conversa Uazapi nao encontrado.");
  }

  return { contact, conversation };
}
