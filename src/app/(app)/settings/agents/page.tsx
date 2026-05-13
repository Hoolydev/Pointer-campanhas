import Link from "next/link";
import type { Route } from "next";
import { Badge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import { toggleAgentAction } from "./actions";
import { AgentForm } from "./agent-form";

type AgentRow = {
  id: string;
  name: string;
  agent_type: "lead_meta" | "broker_uazapi";
  description: string | null;
  openai_model: string;
  system_prompt: string;
  greeting_template: string;
  humanization_rules: string | null;
  agent_skills: string | null;
  qualification_criteria: string | null;
  handoff_instructions: string | null;
  broker_message_template: string | null;
  broker_followup_minutes: number;
  message_split_enabled: boolean;
  typing_words_per_minute: number;
  appointment_enabled: boolean;
  appointment_duration_minutes: number;
  active: boolean;
  created_at: string;
};

export default async function AgentsPage() {
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);
  const { data: agents, error: agentsError } = profile
    ? await supabase
        .from("ai_agents")
        .select(
          "id, name, agent_type, description, openai_model, system_prompt, greeting_template, humanization_rules, agent_skills, qualification_criteria, handoff_instructions, broker_message_template, broker_followup_minutes, message_split_enabled, typing_words_per_minute, appointment_enabled, appointment_duration_minutes, active, created_at"
        )
        .eq("organization_id", profile.organization_id)
        .order("created_at", { ascending: false })
        .returns<AgentRow[]>()
    : { data: [] };

  return (
    <>
      <PageHeader
        title="Agentes IA"
        description="Configure agentes separados para atendimento de leads pela Meta oficial e cobranca de corretores pela Uazapi."
      />
      <section className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <AgentForm />

        <div className="space-y-4">
          {agentsError ? (
            <section className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              Nao foi possivel carregar agentes: {agentsError.message}. Rode as migrations mais recentes no Supabase.
            </section>
          ) : null}
          {agents?.length ? (
            agents.map((agent) => (
              <article key={agent.id} className="rounded-lg border bg-card p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-semibold text-slate-950">{agent.name}</h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {agent.description || "Sem descricao."}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {agent.agent_type === "lead_meta" ? "Lead/Meta" : "Corretor/Uazapi"} • Modelo: {agent.openai_model} • {agent.message_split_enabled ? "mensagens quebradas" : "mensagem única"} • visita {agent.appointment_enabled ? "ativa" : "inativa"} • corretor {agent.broker_followup_minutes} min
                    </p>
                  </div>
                  <Badge tone={agent.active ? "success" : "muted"}>
                    {agent.active ? "Ativo" : "Inativo"}
                  </Badge>
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <TextBlock title="Saudacao" value={agent.greeting_template} />
                  <TextBlock title="Humanizacao" value={agent.humanization_rules} />
                  <TextBlock title="Skills" value={agent.agent_skills} />
                  <TextBlock title="Prompt" value={agent.system_prompt} />
                  <TextBlock title="Qualificacao" value={agent.qualification_criteria} />
                  <TextBlock title="Encaminhamento" value={agent.handoff_instructions} />
                  <TextBlock title="Mensagem Uazapi" value={agent.broker_message_template} />
                </div>
                <div className="mt-4 flex gap-2">
                  <Link
                    href={`/settings/agents/${agent.id}/edit` as Route}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                  >
                    Editar
                  </Link>
                  <form action={toggleAgentAction}>
                    <input type="hidden" name="id" value={agent.id} />
                    <input type="hidden" name="active" value={String(agent.active)} />
                    <button className="rounded-md border bg-white px-3 py-1.5 text-xs font-medium">
                      {agent.active ? "Desativar" : "Ativar"}
                    </button>
                  </form>
                </div>
              </article>
            ))
          ) : (
            <section className="rounded-lg border bg-card p-10 text-center shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">Nenhum agente criado</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Crie um agente para usar nas campanhas e atender leads automaticamente.
              </p>
            </section>
          )}
        </div>
      </section>
    </>
  );
}

function TextBlock({ title, value }: { title: string; value: string | null }) {
  return (
    <div className="rounded-md border bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="mt-2 line-clamp-5 whitespace-pre-wrap text-sm leading-6 text-slate-700">
        {value || "Nao informado."}
      </p>
    </div>
  );
}
