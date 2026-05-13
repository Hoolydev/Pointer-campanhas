import { notFound } from "next/navigation";
import { Badge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import { DeleteCampaignButton } from "./delete-campaign-button";
import { SendCampaignButton } from "./send-campaign-button";

type Campaign = {
  id: string;
  name: string;
  agent_id: string | null;
  property_description: string | null;
  initial_message: string | null;
  meta_template_name: string | null;
  meta_template_language: string;
  meta_template_body_params: string[] | null;
  meta_header_media_type: string | null;
  meta_header_media_url: string | null;
  meta_header_media_id: string | null;
  agent_prompt: string | null;
  status: "draft" | "active" | "paused" | "finished";
};

type Agent = {
  name: string;
  description: string | null;
  qualification_criteria: string | null;
};

type Contact = {
  id: string;
  name: string | null;
  phone: string;
  status: string;
  created_at: string;
};

type Job = {
  id: string;
  job_type: string;
  status: string;
  run_at: string;
  executed_at: string | null;
  payload: Record<string, unknown>;
};

type Material = {
  id: string;
  title: string;
  media_type: string;
  media_url: string;
};

export default async function CampaignDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const { page: pageParam } = await searchParams;
  const currentPage = Math.max(1, Number(pageParam ?? "1") || 1);
  const pageSize = 200;
  const from = (currentPage - 1) * pageSize;
  const to = from + pageSize - 1;
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile) {
    notFound();
  }

  const [
    { data: campaign },
    { data: contacts, count: totalContacts },
    { data: jobs },
    { data: materials }
  ] = await Promise.all([
    supabase
      .from("campaigns")
      .select("id, name, agent_id, property_description, initial_message, meta_template_name, meta_template_language, meta_template_body_params, meta_header_media_type, meta_header_media_url, meta_header_media_id, agent_prompt, status")
      .eq("id", id)
      .eq("organization_id", profile.organization_id)
      .single<Campaign>(),
    supabase
      .from("contacts")
      .select("id, name, phone, status, created_at", { count: "exact" })
      .eq("campaign_id", id)
      .eq("organization_id", profile.organization_id)
      .order("created_at", { ascending: false })
      .range(from, to)
      .returns<Contact[]>(),
    supabase
      .from("scheduled_jobs")
      .select("id, job_type, status, run_at, executed_at, payload")
      .eq("organization_id", profile.organization_id)
      .order("run_at", { ascending: false })
      .limit(50)
      .returns<Job[]>(),
    supabase
      .from("campaign_materials")
      .select("id, title, media_type, media_url")
      .eq("campaign_id", id)
      .eq("organization_id", profile.organization_id)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .returns<Material[]>()
  ]);

  if (!campaign) {
    notFound();
  }

  const { data: agent } = campaign.agent_id
    ? await supabase
        .from("ai_agents")
        .select("name, description, qualification_criteria")
        .eq("id", campaign.agent_id)
        .eq("organization_id", profile.organization_id)
        .maybeSingle<Agent>()
    : { data: null };
  const totalPages = Math.max(1, Math.ceil((totalContacts ?? 0) / pageSize));

  return (
    <>
      <PageHeader
        title={campaign.name}
        description="Detalhes da campanha e contatos importados."
        action={
          <div className="flex flex-col items-end gap-2 sm:flex-row">
            <SendCampaignButton campaignId={campaign.id} />
            <DeleteCampaignButton campaignId={campaign.id} campaignName={campaign.name} />
          </div>
        }
      />
      <section className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Contatos</h2>
              <p className="text-sm text-muted-foreground">
                {totalContacts ?? 0} contato(s) importados. Exibindo {contacts?.length ?? 0} nesta pagina.
              </p>
            </div>
            <div className="flex gap-2">
              <Badge tone="muted">{campaign.status}</Badge>
            </div>
          </div>
          {contacts && contacts.length > 0 ? (
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-semibold">Nome</th>
                  <th className="px-4 py-3 font-semibold">Telefone</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {contacts.map((contact) => (
                  <tr key={contact.id}>
                    <td className="px-4 py-3 font-medium text-slate-950">
                      {contact.name || "Sem nome"}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{contact.phone}</td>
                    <td className="px-4 py-3">
                      <Badge tone="muted">{contact.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-6 text-sm text-muted-foreground">
              Nenhum contato foi importado para esta campanha.
            </p>
          )}
          {totalPages > 1 ? (
            <div className="flex items-center justify-between border-t px-5 py-4 text-sm">
              <span className="text-muted-foreground">
                Pagina {currentPage} de {totalPages}
              </span>
              <div className="flex gap-2">
                {currentPage > 1 ? (
                  <a
                    href={`/campaigns/${id}?page=${currentPage - 1}`}
                    className="rounded-md border bg-white px-3 py-1.5 font-medium"
                  >
                    Anterior
                  </a>
                ) : null}
                {currentPage < totalPages ? (
                  <a
                    href={`/campaigns/${id}?page=${currentPage + 1}`}
                    className="rounded-md border bg-white px-3 py-1.5 font-medium"
                  >
                    Proxima
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <aside className="space-y-5">
          <section className="rounded-lg border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-950">Agente IA</h2>
            <p className="mt-3 text-sm font-medium text-slate-950">
              {agent?.name || "Prompt manual da campanha"}
            </p>
            {agent?.description ? (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{agent.description}</p>
            ) : null}
            {agent?.qualification_criteria ? (
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                {agent.qualification_criteria}
              </p>
            ) : null}
          </section>
          <InfoCard title="Descricao do imovel" content={campaign.property_description} />
          <InfoCard
            title="Template Meta inicial"
            content={[
              campaign.meta_template_name ? `Nome: ${campaign.meta_template_name}` : null,
              campaign.meta_template_language ? `Idioma: ${campaign.meta_template_language}` : null,
              campaign.meta_template_body_params?.length
                ? `Variaveis:\n${campaign.meta_template_body_params.join("\n")}`
                : null,
              campaign.meta_header_media_type
                ? `Header: ${campaign.meta_header_media_type}\n${campaign.meta_header_media_id || campaign.meta_header_media_url || ""}`
                : null
            ]
              .filter(Boolean)
              .join("\n")}
          />
          <section className="rounded-lg border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-950">Materiais</h2>
            <div className="mt-3 space-y-2">
              {materials?.length ? (
                materials.map((material) => (
                  <a
                    key={material.id}
                    href={material.media_url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-md border bg-slate-50 p-3 text-sm"
                  >
                    <span className="font-medium text-slate-950">{material.title}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{material.media_type}</span>
                  </a>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum material anexado.</p>
              )}
            </div>
          </section>
          <InfoCard title="Preview/fallback" content={campaign.initial_message} />
          <InfoCard title="Prompt do agente" content={campaign.agent_prompt} />
          <section className="rounded-lg border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-950">Jobs recentes</h2>
            <div className="mt-3 space-y-2">
              {jobs?.filter((job) => job.payload?.campaignId === id).length ? (
                jobs
                  ?.filter((job) => job.payload?.campaignId === id)
                  .slice(0, 10)
                  .map((job) => (
                  <div key={job.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div>
                      <p className="text-sm font-medium text-slate-950">{job.job_type}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Intl.DateTimeFormat("pt-BR", {
                          dateStyle: "short",
                          timeStyle: "short"
                        }).format(new Date(job.run_at))}
                      </p>
                    </div>
                    <Badge tone={job.status === "done" ? "success" : "muted"}>{job.status}</Badge>
                  </div>
                  ))
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum job criado ainda.</p>
              )}
            </div>
          </section>
        </aside>
      </section>
    </>
  );
}

function InfoCard({ title, content }: { title: string; content: string | null }) {
  return (
    <section className="rounded-lg border bg-card p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
        {content || "Nao informado."}
      </p>
    </section>
  );
}
