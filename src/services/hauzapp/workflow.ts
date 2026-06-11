import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addNegocio,
  changeNegociacaoEtapa,
  findNegotiationByPhone,
  formatCurrencyForHauzapp,
  getAllCorretoresImob,
  imobEncaminharNegocio,
  type HauzappBroker
} from "@/services/hauzapp/client";
import { configNumber, configString, getActiveIntegrationConfig } from "@/services/integrations/config";
import { renderTemplate } from "@/lib/templates";
import { scheduleBrokerAssignmentSla } from "@/services/broker-sla/workflow";
import { sendUazapiMessage } from "@/services/uazapi/send-message";

type LeadForHauzapp = {
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
  hauzapp_cliente_id?: string | null;
  hauzapp_sent_at?: string | null;
};

type LocalBroker = {
  id: string;
  name: string;
  phone: string;
  hauzapp_corretor_id: string | null;
};

export async function sendQualifiedLeadToHauzapp({
  supabase,
  lead
}: {
  supabase: SupabaseClient;
  lead: LeadForHauzapp;
}) {
  const config = await getActiveIntegrationConfig(supabase, lead.organization_id, "hauzapp");
  const hauzappConfig = {
    baseUrl: configString(config, ["baseUrl", "base_url"], process.env.HAUZAPP_BASE_URL),
    apiKey: configString(config, ["apiKey", "api_key", "chave"], process.env.HAUZAPP_API_KEY)
  };
  const stageId = configNumber(config, ["qualifiedStageId", "qualified_stage_id"], Number(process.env.HAUZAPP_QUALIFIED_STAGE_ID || 3));
  const leadName = lead.name && lead.name.length >= 3 ? lead.name : `Lead ${lead.phone}`;
  let negotiation =
    lead.hauzapp_cliente_id ? { clienteID: lead.hauzapp_cliente_id } : await findNegotiationByPhone(lead.phone, hauzappConfig);

  if (!negotiation?.clienteID) {
    await addNegocio(
      {
        contatoNome: leadName,
        contatoPhone: lead.phone,
        negocioPrice: formatCurrencyForHauzapp(lead.budget),
        negocioApelido: buildDealNickname(lead),
        negocioTemperature: lead.score >= 80 ? 2 : lead.score >= 50 ? 1 : 0
      },
      hauzappConfig
    );

    negotiation = await findNegotiationByPhone(lead.phone, hauzappConfig);
  }

  if (!negotiation?.clienteID) {
    throw new Error("HauzApp negotiation was created but clienteID was not found.");
  }

  await changeNegociacaoEtapa(negotiation.clienteID, stageId, hauzappConfig);

  const broker = await pickNextHauzappBroker(supabase, lead.organization_id);

  if (!broker?.hauzapp_corretor_id) {
    await supabase.from("leads").update({
      hauzapp_cliente_id: negotiation.clienteID,
      hauzapp_stage_id: stageId,
      hauzapp_sent_at: new Date().toISOString(),
      stage: "qualified"
    }).eq("id", lead.id);

    return {
      clienteID: negotiation.clienteID,
      stageId,
      broker: null
    };
  }

  await imobEncaminharNegocio(negotiation.clienteID, broker.hauzapp_corretor_id, hauzappConfig);

  await Promise.all([
    supabase
      .from("leads")
      .update({
        hauzapp_cliente_id: negotiation.clienteID,
        hauzapp_stage_id: stageId,
        hauzapp_sent_at: new Date().toISOString(),
        stage: "sent_to_broker",
        last_stage_updated_at: new Date().toISOString()
      })
      .eq("id", lead.id),
    supabase
      .from("brokers")
      .update({ last_assigned_at: new Date().toISOString() })
      .eq("id", broker.id)
  ]);

  const { data: assignment } = await supabase
    .from("broker_assignments")
    .insert({
      organization_id: lead.organization_id,
      lead_id: lead.id,
      broker_id: broker.id,
      status: "assigned"
    })
    .select("id")
    .single<{ id: string }>();

  if (assignment?.id) {
    await Promise.all([
      notifyBrokerAboutHauzappLead(supabase, lead, broker),
      scheduleBrokerAssignmentSla({
        supabase,
        organizationId: lead.organization_id,
        assignmentId: assignment.id,
        leadId: lead.id,
        brokerId: broker.id
      })
    ]);
  }

  return {
    clienteID: negotiation.clienteID,
    stageId,
    broker
  };
}

async function notifyBrokerAboutHauzappLead(
  supabase: SupabaseClient,
  lead: LeadForHauzapp,
  broker: LocalBroker
) {
  const [{ data: brokerAgent }, uazapiConfig] = await Promise.all([
    supabase
      .from("ai_agents")
      .select("broker_message_template")
      .eq("organization_id", lead.organization_id)
      .eq("agent_type", "broker_uazapi")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ broker_message_template: string | null }>(),
    getActiveIntegrationConfig(supabase, lead.organization_id, "uazapi")
  ]);
  const message = renderTemplate(
    brokerAgent?.broker_message_template ||
      `Ola, {{broker_name}}. Voce recebeu o lead {{lead_name}}.

Resumo:
{{summary}}

Responda aqui com o status do atendimento.`,
    {
      broker_name: broker.name,
      broker_phone: broker.phone,
      lead_name: lead.name ?? lead.phone,
      lead_phone: lead.phone,
      summary: lead.summary,
      interest: lead.interest,
      region: lead.region,
      budget: lead.budget ? String(lead.budget) : null,
      payment_method: lead.payment_method,
      score: String(lead.score)
    }
  );
  const payload = await sendUazapiMessage({
    phone: broker.phone,
    text: message,
    integrationConfig: {
      baseUrl: configString(uazapiConfig, ["baseUrl", "base_url"], process.env.UAZAPI_BASE_URL) ?? undefined,
      token: configString(uazapiConfig, ["token", "apiKey", "api_key"], process.env.UAZAPI_TOKEN) ?? undefined
    }
  });

  await supabase.from("messages").insert({
    organization_id: lead.organization_id,
    direction: "outbound",
    channel: "uazapi",
    type: "text",
    content: message,
    status: "sent",
    payload
  });
}

export async function syncHauzappBrokers(supabase: SupabaseClient, organizationId: string) {
  const config = await getActiveIntegrationConfig(supabase, organizationId, "hauzapp");
  const brokers = await getAllCorretoresImob({
    baseUrl: configString(config, ["baseUrl", "base_url"], process.env.HAUZAPP_BASE_URL),
    apiKey: configString(config, ["apiKey", "api_key", "chave"], process.env.HAUZAPP_API_KEY)
  });
  const activeBrokers = brokers.filter((broker) => isHauzappBrokerActive(broker));

  for (const broker of activeBrokers) {
    const phone = broker.corretorPhone?.replace(/\D/g, "") ?? "";
    const existingQuery = supabase
      .from("brokers")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("hauzapp_corretor_id", broker.corretorID)
      .maybeSingle<{ id: string }>();

    const { data: existing } = await existingQuery;

    if (existing) {
      await supabase
        .from("brokers")
        .update({
          name: broker.corretorNome,
          phone: phone || broker.corretorPhone || "",
          active: true
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("brokers").insert({
        organization_id: organizationId,
        name: broker.corretorNome,
        phone: phone || broker.corretorPhone || "",
        active: true,
        priority: 0,
        hauzapp_corretor_id: broker.corretorID
      });
    }
  }

  return activeBrokers.length;
}

async function pickNextHauzappBroker(supabase: SupabaseClient, organizationId: string) {
  const { data: broker } = await supabase
    .from("brokers")
    .select("id, name, phone, hauzapp_corretor_id")
    .eq("organization_id", organizationId)
    .eq("active", true)
    .not("hauzapp_corretor_id", "is", null)
    .order("last_assigned_at", { ascending: true, nullsFirst: true })
    .order("priority", { ascending: false })
    .limit(1)
    .maybeSingle<LocalBroker>();

  return broker ?? null;
}

function buildDealNickname(lead: LeadForHauzapp) {
  const parts = [lead.interest, lead.region, lead.payment_method].filter(Boolean);
  const nickname = parts.length ? parts.join(" - ") : lead.summary || "Lead qualificado pela campanha";
  return nickname.slice(0, 300);
}

function isHauzappBrokerActive(broker: HauzappBroker) {
  return broker.corretorBlocked !== "1" && broker.corretorRodizioBlocked !== "1";
}
