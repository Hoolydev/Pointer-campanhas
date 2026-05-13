import { notFound } from "next/navigation";
import { Badge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import { resendLeadToBrokerAction, updateLeadStageAction } from "./actions";

type Lead = {
  id: string;
  name: string | null;
  phone: string;
  source: string;
  interest: string | null;
  region: string | null;
  budget: number | null;
  payment_method: string | null;
  qualification_status: string;
  score: number;
  summary: string | null;
  stage: string;
  houseup_external_id: string | null;
  hauzapp_cliente_id: string | null;
  hauzapp_stage_id: number | null;
  hauzapp_sent_at: string | null;
  conversation_id: string | null;
};

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  channel: string;
  content: string | null;
  created_at: string;
};

type Assignment = {
  id: string;
  status: string;
  assigned_at: string;
  brokers: {
    name: string;
    phone: string;
  } | null;
};

const stageOptions = [
  ["new", "Novo"],
  ["ai_attending", "Em atendimento IA"],
  ["interested", "Interessado"],
  ["qualifying", "Qualificando"],
  ["qualified", "Qualificado"],
  ["sent_to_broker", "Enviado ao corretor"],
  ["broker_attending", "Em atendimento corretor"],
  ["no_response", "Sem resposta"],
  ["lost", "Perdido"],
  ["won", "Ganho"]
] as const;

export default async function LeadDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile) {
    notFound();
  }

  const { data: lead } = await supabase
    .from("leads")
    .select(
      "id, name, phone, source, interest, region, budget, payment_method, qualification_status, score, summary, stage, houseup_external_id, hauzapp_cliente_id, hauzapp_stage_id, hauzapp_sent_at, conversation_id"
    )
    .eq("id", id)
    .eq("organization_id", profile.organization_id)
    .single<Lead>();

  if (!lead) {
    notFound();
  }

  const [{ data: messages }, { data: assignments }] = await Promise.all([
    lead.conversation_id
      ? supabase
          .from("messages")
          .select("id, direction, channel, content, created_at")
          .eq("organization_id", profile.organization_id)
          .eq("conversation_id", lead.conversation_id)
          .order("created_at", { ascending: true })
          .returns<Message[]>()
      : Promise.resolve({ data: [] }),
    supabase
      .from("broker_assignments")
      .select("id, status, assigned_at, brokers(name, phone)")
      .eq("organization_id", profile.organization_id)
      .eq("lead_id", lead.id)
      .order("assigned_at", { ascending: false })
      .returns<Assignment[]>()
  ]);

  return (
    <>
      <PageHeader title={lead.name || lead.phone} description="Dados, mensagens e status de qualificacao." />
      <section className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="rounded-lg border bg-card p-6 shadow-sm">
            <div className="flex flex-wrap gap-2">
              <Badge tone={lead.score >= 70 ? "success" : "muted"}>Score {lead.score}</Badge>
              <Badge>{lead.stage}</Badge>
              <Badge tone="muted">{lead.source}</Badge>
            </div>
            <h2 className="mt-5 text-base font-semibold text-slate-950">Resumo da IA</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {lead.summary || "Sem resumo gerado ainda."}
            </p>
          </section>

          <section className="rounded-lg border bg-card shadow-sm">
            <div className="border-b px-5 py-4">
              <h2 className="text-base font-semibold text-slate-950">Historico de mensagens</h2>
            </div>
            <div className="space-y-3 p-5">
              {messages?.length ? (
                messages.map((message) => (
                  <div key={message.id} className="rounded-md border bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <Badge tone={message.direction === "inbound" ? "default" : "success"}>
                        {message.direction}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{message.channel}</span>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm text-slate-800">
                      {message.content || "Midia/sem texto"}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Sem mensagens vinculadas.</p>
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-5">
          <Info title="Telefone" value={lead.phone} />
          <Info title="Interesse" value={lead.interest} />
          <Info title="Regiao" value={lead.region} />
          <Info title="Orcamento" value={lead.budget ? `R$ ${lead.budget}` : null} />
          <Info title="Pagamento" value={lead.payment_method} />
          <Info title="HauzApp Cliente ID" value={lead.hauzapp_cliente_id || "Pendente"} />
          <Info title="HauzApp Etapa" value={lead.hauzapp_stage_id ?? "Pendente"} />
          <Info
            title="Enviado ao HauzApp"
            value={
              lead.hauzapp_sent_at
                ? new Intl.DateTimeFormat("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short"
                  }).format(new Date(lead.hauzapp_sent_at))
                : "Pendente"
            }
          />
          <section className="rounded-lg border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-950">Acoes</h2>
            <form action={updateLeadStageAction} className="mt-4 space-y-3">
              <input type="hidden" name="lead_id" value={lead.id} />
              <select
                name="stage"
                defaultValue={lead.stage}
                className="h-10 w-full rounded-md border bg-white px-3 text-sm"
              >
                {stageOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button className="h-10 w-full rounded-md border bg-white px-3 text-sm font-medium">
                Atualizar etapa
              </button>
            </form>
            <form action={resendLeadToBrokerAction} className="mt-3">
              <input type="hidden" name="lead_id" value={lead.id} />
              <button className="h-10 w-full rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground">
                Enviar a outro corretor
              </button>
            </form>
          </section>
          <section className="rounded-lg border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-950">Corretor atribuido</h2>
            <div className="mt-3 space-y-3">
              {assignments?.length ? (
                assignments.map((assignment) => (
                  <div key={assignment.id} className="rounded-md border p-3">
                    <p className="text-sm font-medium text-slate-950">
                      {assignment.brokers?.name || "Corretor"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {assignment.brokers?.phone}
                    </p>
                    <div className="mt-2">
                      <Badge tone="muted">{assignment.status}</Badge>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum corretor atribuido.</p>
              )}
            </div>
          </section>
        </aside>
      </section>
    </>
  );
}

function Info({ title, value }: { title: string; value: string | number | null }) {
  return (
    <section className="rounded-lg border bg-card p-5 shadow-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      <p className="mt-2 text-sm font-medium text-slate-950">{value || "Nao informado"}</p>
    </section>
  );
}
