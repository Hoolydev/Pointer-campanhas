import Link from "next/link";
import type { Route } from "next";
import { Badge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";

const columns = [
  { key: "new", label: "Novo" },
  { key: "ai_attending", label: "Em atendimento IA" },
  { key: "interested", label: "Interessado" },
  { key: "qualifying", label: "Qualificando" },
  { key: "qualified", label: "Qualificado" },
  { key: "sent_to_broker", label: "Enviado ao corretor" },
  { key: "broker_attending", label: "Em atendimento corretor" },
  { key: "no_response", label: "Sem resposta" },
  { key: "lost", label: "Perdido" },
  { key: "won", label: "Ganho" }
];

type LeadRow = {
  id: string;
  name: string | null;
  phone: string;
  interest: string | null;
  region: string | null;
  score: number;
  stage: string;
  summary: string | null;
};

export default async function CrmPage() {
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);
  const { data: leads } = profile
    ? await supabase
        .from("leads")
        .select("id, name, phone, interest, region, score, stage, summary")
        .eq("organization_id", profile.organization_id)
        .order("created_at", { ascending: false })
        .returns<LeadRow[]>()
    : { data: [] };

  return (
    <>
      <PageHeader title="CRM" description="Kanban interno para acompanhar o funil dos leads." />
      <section className="grid gap-4 overflow-x-auto pb-4 lg:grid-cols-5">
        {columns.map((column) => {
          const columnLeads = (leads ?? []).filter((lead) => lead.stage === column.key);

          return (
            <div key={column.key} className="min-h-[420px] rounded-lg border bg-slate-50">
              <div className="flex items-center justify-between border-b bg-white px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-950">{column.label}</h2>
                <Badge tone="muted">{columnLeads.length}</Badge>
              </div>
              <div className="space-y-3 p-3">
                {columnLeads.map((lead) => (
                  <Link
                    key={lead.id}
                    href={`/leads/${lead.id}` as Route}
                    className="block rounded-lg border bg-white p-4 shadow-sm transition hover:border-teal-300"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium text-slate-950">{lead.name || "Sem nome"}</p>
                      <Badge tone={lead.score >= 70 ? "success" : "muted"}>{lead.score}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{lead.phone}</p>
                    {lead.region ? (
                      <p className="mt-3 text-sm text-slate-700">{lead.region}</p>
                    ) : null}
                    {lead.summary ? (
                      <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">
                        {lead.summary}
                      </p>
                    ) : null}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}
