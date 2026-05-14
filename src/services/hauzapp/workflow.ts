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
  const stageId = Number(process.env.HAUZAPP_QUALIFIED_STAGE_ID || 2);
  const leadName = lead.name && lead.name.length >= 3 ? lead.name : `Lead ${lead.phone}`;
  let negotiation =
    lead.hauzapp_cliente_id ? { clienteID: lead.hauzapp_cliente_id } : await findNegotiationByPhone(lead.phone);

  if (!negotiation?.clienteID) {
    await addNegocio({
      contatoNome: leadName,
      contatoPhone: lead.phone,
      negocioPrice: formatCurrencyForHauzapp(lead.budget),
      negocioApelido: buildDealNickname(lead),
      negocioTemperature: lead.score >= 80 ? 2 : lead.score >= 50 ? 1 : 0
    });

    negotiation = await findNegotiationByPhone(lead.phone);
  }

  if (!negotiation?.clienteID) {
    throw new Error("HauzApp negotiation was created but clienteID was not found.");
  }

  await changeNegociacaoEtapa(negotiation.clienteID, stageId);

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

  await imobEncaminharNegocio(negotiation.clienteID, broker.hauzapp_corretor_id);

  await Promise.all([
    supabase
      .from("leads")
      .update({
        hauzapp_cliente_id: negotiation.clienteID,
        hauzapp_stage_id: stageId,
        hauzapp_sent_at: new Date().toISOString(),
        stage: "sent_to_broker"
      })
      .eq("id", lead.id),
    supabase
      .from("brokers")
      .update({ last_assigned_at: new Date().toISOString() })
      .eq("id", broker.id),
    supabase.from("broker_assignments").insert({
      organization_id: lead.organization_id,
      lead_id: lead.id,
      broker_id: broker.id,
      status: "assigned"
    })
  ]);

  return {
    clienteID: negotiation.clienteID,
    stageId,
    broker
  };
}

export async function syncHauzappBrokers(supabase: SupabaseClient, organizationId: string) {
  const brokers = await getAllCorretoresImob();
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
