import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeBrazilianPhone } from "@/lib/phone";
import { getAllNegociacoes, type HauzappNegotiation } from "@/services/hauzapp/client";
import {
  configBoolean,
  configNumber,
  configString,
  getActiveIntegrationConfig
} from "@/services/integrations/config";
import { sendUazapiMessage } from "@/services/uazapi/send-message";

type SyncResult = {
  imported: number;
  skipped: number;
  greeted: number;
  errors: Array<{ clienteID?: string; error: string }>;
};

export async function syncHauzappProspectionLeads({
  supabase,
  organizationId
}: {
  supabase: SupabaseClient;
  organizationId: string;
}): Promise<SyncResult> {
  const hauzappConfig = await getActiveIntegrationConfig(supabase, organizationId, "hauzapp");
  const uazapiConfig = await getActiveIntegrationConfig(supabase, organizationId, "uazapi");
  const prospectionStageId = configNumber(
    hauzappConfig,
    ["prospectionStageId", "prospection_stage_id"],
    Number(process.env.HAUZAPP_PROSPECTION_STAGE_ID || 1)
  );
  const autoGreet = configBoolean(hauzappConfig, ["autoGreetProspects", "auto_greet_prospects"], false);
  const negotiations = await getAllNegociacoes(undefined, {
    baseUrl: configString(hauzappConfig, ["baseUrl", "base_url"], process.env.HAUZAPP_BASE_URL),
    apiKey: configString(hauzappConfig, ["apiKey", "api_key", "chave"], process.env.HAUZAPP_API_KEY)
  });
  const result: SyncResult = { imported: 0, skipped: 0, greeted: 0, errors: [] };

  for (const negotiation of negotiations.filter((item) => isProspectionStage(item, prospectionStageId))) {
    try {
      const phone = normalizeBrazilianPhone(negotiation.clienteTelefone);

      if (!phone) {
        result.skipped += 1;
        continue;
      }

      const { data: existingLead } = await supabase
        .from("leads")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("hauzapp_cliente_id", negotiation.clienteID)
        .limit(1)
        .maybeSingle<{ id: string }>();

      if (existingLead) {
        result.skipped += 1;
        continue;
      }

      const contactId = await upsertProspectionContact(supabase, organizationId, negotiation, phone);
      const conversationId = await upsertProspectionConversation(
        supabase,
        organizationId,
        contactId,
        negotiation
      );

      await supabase.from("leads").insert({
        organization_id: organizationId,
        contact_id: contactId,
        campaign_id: null,
        conversation_id: conversationId,
        name: negotiation.clienteNome || null,
        phone,
        source: "hauzapp",
        qualification_status: "new",
        score: temperatureToScore(negotiation.clienteTemperature),
        summary: `Lead importado da etapa ${negotiation.clienteFunilStage || negotiation.clienteFunilStageID || "Prospecção"} do HauzApp.`,
        stage: "hauzapp_prospection",
        hauzapp_cliente_id: negotiation.clienteID,
        hauzapp_stage_id: Number(negotiation.clienteFunilStageID || prospectionStageId),
        hauzapp_sent_at: null
      });

      result.imported += 1;

      if (autoGreet) {
        const sent = await greetProspect({
          supabase,
          organizationId,
          phone,
          name: negotiation.clienteNome,
          contactId,
          conversationId,
          uazapiConfig
        });
        result.greeted += sent ? 1 : 0;
      }
    } catch (error) {
      result.errors.push({
        clienteID: negotiation.clienteID,
        error: error instanceof Error ? error.message : "Erro desconhecido"
      });
    }
  }

  await supabase.from("integration_logs").insert({
    organization_id: organizationId,
    provider: "hauzapp",
    target_type: "prospection_sync",
    status: result.errors.length ? "partial" : "done",
    request_payload: { prospectionStageId },
    response_payload: result,
    error_message: result.errors[0]?.error ?? null
  });

  return result;
}

function isProspectionStage(negotiation: HauzappNegotiation, prospectionStageId: number) {
  const stageId = Number(negotiation.clienteFunilStageID);
  const stageName = String(negotiation.clienteFunilStage || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return stageId === prospectionStageId || stageName.includes("prospeccao") || stageName.includes("prospe");
}

async function upsertProspectionContact(
  supabase: SupabaseClient,
  organizationId: string,
  negotiation: HauzappNegotiation,
  phone: string
) {
  const { data: existing } = await supabase
    .from("contacts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (existing) {
    await supabase
      .from("contacts")
      .update({
        name: negotiation.clienteNome || null,
        hauzapp_cliente_id: negotiation.clienteID,
        status: "hauzapp_prospect",
        raw_data: negotiation
      })
      .eq("id", existing.id);
    return existing.id;
  }

  const { data, error } = await supabase
    .from("contacts")
    .insert({
      organization_id: organizationId,
      campaign_id: null,
      name: negotiation.clienteNome || null,
      phone,
      raw_data: negotiation,
      status: "hauzapp_prospect",
      hauzapp_cliente_id: negotiation.clienteID
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    throw new Error(error?.message || "Nao foi possivel criar contato HauzApp.");
  }

  return data.id;
}

async function upsertProspectionConversation(
  supabase: SupabaseClient,
  organizationId: string,
  contactId: string,
  negotiation: HauzappNegotiation
) {
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .eq("channel", "uazapi")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (existing) {
    await supabase
      .from("conversations")
      .update({ hauzapp_cliente_id: negotiation.clienteID, ai_enabled: true })
      .eq("id", existing.id);
    return existing.id;
  }

  const { data, error } = await supabase
    .from("conversations")
    .insert({
      organization_id: organizationId,
      contact_id: contactId,
      campaign_id: null,
      status: "open",
      current_stage: "hauzapp_prospection",
      ai_enabled: true,
      channel: "uazapi",
      hauzapp_cliente_id: negotiation.clienteID,
      last_message_at: new Date().toISOString()
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    throw new Error(error?.message || "Nao foi possivel criar conversa HauzApp.");
  }

  return data.id;
}

async function greetProspect({
  supabase,
  organizationId,
  phone,
  name,
  contactId,
  conversationId,
  uazapiConfig
}: {
  supabase: SupabaseClient;
  organizationId: string;
  phone: string;
  name: string;
  contactId: string;
  conversationId: string;
  uazapiConfig: Record<string, unknown>;
}) {
  const text = name
    ? `Olá, ${name}. Vi seu cadastro por aqui e queria entender melhor o que você procura. Posso te ajudar?`
    : "Olá, vi seu cadastro por aqui e queria entender melhor o que você procura. Posso te ajudar?";
  const payload = await sendUazapiMessage({
    phone,
    text,
    integrationConfig: {
      baseUrl: configString(uazapiConfig, ["baseUrl", "base_url"], process.env.UAZAPI_BASE_URL) ?? undefined,
      token: configString(uazapiConfig, ["token", "apiKey", "api_key"], process.env.UAZAPI_TOKEN) ?? undefined
    }
  });

  await supabase.from("messages").insert({
    organization_id: organizationId,
    conversation_id: conversationId,
    contact_id: contactId,
    direction: "outbound",
    channel: "uazapi",
    type: "text",
    content: text,
    status: "sent",
    payload
  });

  return true;
}

function temperatureToScore(value: unknown) {
  const temperature = Number(value);

  if (temperature === 2) return 70;
  if (temperature === 1) return 45;
  return 20;
}
