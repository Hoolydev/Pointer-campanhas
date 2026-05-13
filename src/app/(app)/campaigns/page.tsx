import Link from "next/link";
import { Plus, Megaphone, FlaskConical } from "lucide-react";
import type { Route } from "next";
import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";

type CampaignRow = {
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "finished";
  campaign_type: "standard" | "test" | null;
  created_at: string;
};

type CampaignWithCount = CampaignRow & {
  contacts_count: number;
};

const statusLabels = {
  draft: "Rascunho",
  active: "Ativa",
  paused: "Pausada",
  finished: "Finalizada"
};

export default async function CampaignsPage() {
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);
  const { data: campaignRows, error: campaignsError } = profile
    ? await supabase
        .from("campaigns")
        .select("id, name, status, campaign_type, created_at")
        .eq("organization_id", profile.organization_id)
        .order("created_at", { ascending: false })
        .returns<CampaignRow[]>()
    : { data: [] };
  const campaigns = profile ? await withContactCounts(supabase, campaignRows ?? []) : [];

  return (
    <>
      <PageHeader
        title="Campanhas"
        description="Lista de campanhas imobiliarias e status dos disparos."
        action={
          <div className="flex gap-2">
            <Link
              href="/campaigns/test"
              className="inline-flex h-10 items-center gap-2 rounded-md border bg-white px-4 text-sm font-semibold text-slate-800"
            >
              <FlaskConical className="h-4 w-4" />
              Teste
            </Link>
            <Link
              href="/campaigns/new"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              <Plus className="h-4 w-4" />
              Nova campanha
            </Link>
          </div>
        }
      />
      {campaignsError ? (
        <section className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Nao foi possivel carregar as campanhas: {campaignsError.message}
        </section>
      ) : null}
      {campaigns && campaigns.length > 0 ? (
        <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-semibold">Campanha</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Contatos</th>
                <th className="px-4 py-3 font-semibold">Criada em</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {campaigns.map((campaign) => (
                <tr key={campaign.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/campaigns/${campaign.id}` as Route}
                      className="font-medium text-slate-950 hover:text-teal-700"
                    >
                      {campaign.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Badge tone={campaign.status === "active" ? "success" : "muted"}>
                        {statusLabels[campaign.status]}
                      </Badge>
                      {campaign.campaign_type === "test" ? <Badge tone="muted">Teste</Badge> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {campaign.contacts_count}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Intl.DateTimeFormat("pt-BR").format(new Date(campaign.created_at))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <EmptyState
          icon={Megaphone}
          title="Nenhuma campanha criada"
          description="Crie a primeira campanha e importe uma planilha para popular os contatos."
        />
      )}
    </>
  );
}

async function withContactCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  campaigns: CampaignRow[]
): Promise<CampaignWithCount[]> {
  if (campaigns.length === 0) {
    return [];
  }

  const counts = await Promise.all(
    campaigns.map(async (campaign) => {
      const { count } = await supabase
        .from("contacts")
        .select("*", { count: "exact", head: true })
        .eq("campaign_id", campaign.id);

      return [campaign.id, count ?? 0] as const;
    })
  );
  const countMap = new Map(counts);

  return campaigns.map((campaign) => ({
    ...campaign,
    contacts_count: countMap.get(campaign.id) ?? 0
  }));
}
