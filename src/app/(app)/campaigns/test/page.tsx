import { PageHeader } from "@/components/page-header";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import { getMetaPhoneStatus, getMetaTemplates } from "@/services/meta/account";
import { TestCampaignForm } from "./test-campaign-form";

type AgentOption = {
  id: string;
  name: string;
};

export default async function TestCampaignPage() {
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);
  const { data: agents } = profile
    ? await supabase
        .from("ai_agents")
        .select("id, name")
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
        title="Campanha de teste"
        description="Dispare para poucos numeros selecionados e valide template, midia e continuidade do agente."
      />
      <TestCampaignForm
        agents={agents ?? []}
        metaPhone={metaPhone}
        metaTemplates={metaTemplates}
      />
    </>
  );
}
