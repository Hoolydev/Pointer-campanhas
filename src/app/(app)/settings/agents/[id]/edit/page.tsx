import Link from "next/link";
import { notFound } from "next/navigation";
import type { Route } from "next";
import { Badge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import { toggleAgentMaterialAction } from "../../actions";
import { AgentEditForm } from "./agent-edit-form";

type AgentRow = {
  id: string;
  name: string;
  agent_type: "lead_meta" | "broker_uazapi";
  description: string | null;
  openai_model: string;
  system_prompt: string;
  greeting_template: string;
  humanization_rules: string | null;
  forbidden_phrases: string | null;
  conversation_examples: string | null;
  agent_skills: string | null;
  qualification_criteria: string | null;
  handoff_instructions: string | null;
  broker_message_template: string | null;
  broker_followup_minutes: number;
  message_split_enabled: boolean;
  typing_words_per_minute: number;
  appointment_enabled: boolean;
  appointment_duration_minutes: number;
};

type MaterialRow = {
  id: string;
  title: string;
  description: string | null;
  media_type: string;
  public_url: string | null;
  active: boolean;
};

export default async function EditAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile) {
    notFound();
  }

  const [{ data: agent }, { data: materials }] = await Promise.all([
    supabase
      .from("ai_agents")
      .select("id, name, agent_type, description, openai_model, system_prompt, greeting_template, humanization_rules, forbidden_phrases, conversation_examples, agent_skills, qualification_criteria, handoff_instructions, broker_message_template, broker_followup_minutes, message_split_enabled, typing_words_per_minute, appointment_enabled, appointment_duration_minutes")
      .eq("id", id)
      .eq("organization_id", profile.organization_id)
      .maybeSingle<AgentRow>(),
    supabase
      .from("agent_materials")
      .select("id, title, description, media_type, public_url, active")
      .eq("agent_id", id)
      .eq("organization_id", profile.organization_id)
      .order("created_at", { ascending: false })
      .returns<MaterialRow[]>()
  ]);

  if (!agent) {
    notFound();
  }

  return (
    <>
      <PageHeader
        title={`Editar ${agent.name}`}
        description="Personalidade, cadencia, skills e materiais do agente."
        action={
          <Link href={"/settings/agents" as Route} className="rounded-md border bg-white px-3 py-2 text-sm font-medium">
            Voltar
          </Link>
        }
      />
      <section className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <AgentEditForm agent={agent} />
        <aside className="space-y-4">
          <section className="rounded-lg border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-950">Materiais anexados</h2>
            <div className="mt-4 space-y-3">
              {materials?.length ? (
                materials.map((material) => (
                  <div key={material.id} className="rounded-md border bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-950">{material.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{material.description || material.media_type}</p>
                      </div>
                      <Badge tone={material.active ? "success" : "muted"}>{material.active ? "Ativo" : "Inativo"}</Badge>
                    </div>
                    {material.public_url ? (
                      <a href={material.public_url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs font-medium text-teal-700 underline">
                        Abrir material
                      </a>
                    ) : null}
                    <form action={toggleAgentMaterialAction} className="mt-3">
                      <input type="hidden" name="id" value={material.id} />
                      <input type="hidden" name="agent_id" value={agent.id} />
                      <input type="hidden" name="active" value={String(material.active)} />
                      <button className="rounded-md border bg-white px-3 py-1.5 text-xs font-medium">
                        {material.active ? "Desativar" : "Ativar"}
                      </button>
                    </form>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum PDF, imagem ou link anexado.</p>
              )}
            </div>
          </section>
        </aside>
      </section>
    </>
  );
}
