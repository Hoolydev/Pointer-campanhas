import { CampaignForm } from "./campaign-form";
import { PageHeader } from "@/components/page-header";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import { getMetaPhoneStatus, getMetaTemplates } from "@/services/meta/account";

type AgentOption = {
  id: string;
  name: string;
  description: string | null;
};

export default async function NewCampaignPage() {
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);
  const { data: agents } = profile
    ? await supabase
        .from("ai_agents")
        .select("id, name, description")
        .eq("organization_id", profile.organization_id)
        .eq("agent_type", "lead_meta")
        .eq("active", true)
        .order("created_at", { ascending: false })
        .returns<AgentOption[]>()
    : { data: [] };
  const [metaPhone, metaTemplates] = await Promise.all([
    getMetaPhoneStatus(),
    getMetaTemplates()
  ]);

  return (
    <>
      <PageHeader
        title="Nova campanha"
        description="Crie a campanha, defina a abordagem da IA e importe contatos por CSV ou XLSX."
      />
      <CampaignForm
        agents={agents ?? []}
        metaPhone={metaPhone}
        metaTemplates={metaTemplates}
      />
    </>
  );
}
