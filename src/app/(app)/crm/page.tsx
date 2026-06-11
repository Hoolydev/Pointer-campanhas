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
  source: string;
  hauzapp_stage_id: number | null;
  hauzapp_cliente_id: string | null;
};

const hauzappColumns = [
  { key: 0, label: "Lead Novo" },
  { key: 2, label: "Qualificando com a Nay" },
  { key: 3, label: "Aguardando atendimento / corretor" },
  { key: 6, label: "1 atendimento com corretor" },
  { key: 7, label: "Lead Qualificado / Em atendimento" },
  { key: 11, label: "Reaquecer 30 dias" },
  { key: 12, label: "Reaquecer 90 dias" }
];

export default async function CrmPage() {
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);
  const { data: leads } = profile
    ? await supabase
        .from("leads")
        .select("id, name, phone, interest, region, score, stage, summary, source, hauzapp_stage_id, hauzapp_cliente_id")
        .eq("organization_id", profile.organization_id)
        .order("created_at", { ascending: false })
        .returns<LeadRow[]>()
    : { data: [] };

  return (
    <>
      <PageHeader title="CRM" description="Kanban interno e espelho das negociações HauzApp." />
      <section className="mb-6 rounded-lg border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Espelho HauzApp</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Leads importados do HauzApp agrupados pelas mesmas etapas do funil externo.
            </p>
          </div>
          <Badge tone="muted">{(leads ?? []).filter((lead) => lead.hauzapp_cliente_id).length} negocio(s)</Badge>
        </div>
        <div className="mt-4 grid gap-3 overflow-x-auto lg:grid-cols-4 xl:grid-cols-7">
          {hauzappColumns.map((column) => {
            const columnLeads = (leads ?? []).filter((lead) => lead.hauzapp_stage_id === column.key);

            return (
              <div key={column.key} className="min-h-48 rounded-md border bg-slate-50">
                <div className="flex items-center justify-between border-b bg-white px-3 py-2">
                  <h3 className="text-xs font-semibold text-slate-950">{column.label}</h3>
                  <Badge tone="muted">{columnLeads.length}</Badge>
                </div>
                <div className="space-y-2 p-2">
                  {columnLeads.slice(0, 8).map((lead) => (
                    <Link
                      key={lead.id}
                      href={`/leads/${lead.id}` as Route}
                      className="block rounded-md border bg-white p-3 text-sm shadow-sm hover:border-teal-300"
                    >
                      <p className="font-medium text-slate-950">{lead.name || "Sem nome"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{lead.phone}</p>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>
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
