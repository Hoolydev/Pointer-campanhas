import { CampaignForm } from "./campaign-form";
import { PageHeader } from "@/components/page-header";
import { getCurrentProfile } from "@/lib/auth/organization";
import { withTimeout } from "@/lib/async/with-timeout";
import { createClient } from "@/lib/supabase/server";
import { getMetaPhoneStatus, getMetaTemplates } from "@/services/meta/account";

type AgentOption = {
  id: string;
  name: string;
  description: string | null;
};

type WhatsappInstanceOption = {
  id: string;
  name: string;
  phone: string | null;
  hourly_limit: number;
  sent_current_hour: number;
};

export default async function NewCampaignPage() {
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);
  const [{ data: agents }, { data: uazapiInstances }, reusableContacts] = profile
    ? await Promise.all([
        supabase
          .from("ai_agents")
          .select("id, name, description")
          .eq("organization_id", profile.organization_id)
          .eq("agent_type", "lead_meta")
          .eq("active", true)
          .order("created_at", { ascending: false })
          .returns<AgentOption[]>(),
        supabase
          .from("whatsapp_instances")
          .select("id, name, phone, hourly_limit, sent_current_hour")
          .eq("organization_id", profile.organization_id)
          .eq("provider", "uazapi")
          .eq("active", true)
          .order("send_order", { ascending: true })
          .returns<WhatsappInstanceOption[]>(),
        supabase
          .from("contacts")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", profile.organization_id)
          .in("status", ["pending", "queued", "failed"])
      ])
    : [{ data: [] }, { data: [] }, { count: 0 }];
  const [metaPhone, metaTemplates] = await Promise.all([
    withTimeout(getMetaPhoneStatus(), 1500, {
      data: null,
      error: "Consulta Meta demorou demais. Tente atualizar a pagina."
    }),
    withTimeout(getMetaTemplates(), 1500, {
      data: [],
      error: "Consulta de templates demorou demais."
    })
  ]);

  return (
    <>
      <PageHeader
        title="Nova campanha"
        description="Crie a campanha, defina a abordagem da IA e importe contatos por CSV ou XLSX."
      />
      <CampaignForm
        agents={agents ?? []}
        uazapiInstances={uazapiInstances ?? []}
        reusableContactsCount={reusableContacts.count ?? 0}
        metaPhone={metaPhone}
        metaTemplates={metaTemplates}
      />
    </>
  );
}
