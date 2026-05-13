"use client";

import { useEffect } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { updateAgentAction } from "../../actions";

type EditableAgent = {
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

export function AgentEditForm({ agent }: { agent: EditableAgent }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(updateAgentAction, null);

  useEffect(() => {
    if (state?.success) {
      router.refresh();
    }
  }, [router, state?.success]);

  return (
    <form action={formAction} className="space-y-5 rounded-lg border bg-card p-6 shadow-sm">
      <input type="hidden" name="id" value={agent.id} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field name="name" label="Nome" defaultValue={agent.name} />
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Tipo</span>
          <select name="agent_type" defaultValue={agent.agent_type} className="h-10 w-full rounded-md border bg-white px-3 text-sm">
            <option value="lead_meta">Lead pela Meta oficial</option>
            <option value="broker_uazapi">Corretor pela Uazapi</option>
          </select>
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Modelo</span>
          <select name="openai_model" defaultValue={agent.openai_model} className="h-10 w-full rounded-md border bg-white px-3 text-sm">
            <option value="gpt-5-mini">GPT-5 mini</option>
            <option value="gpt-4.1-mini">GPT-4.1 mini</option>
          </select>
        </label>
        <Field name="broker_followup_minutes" label="Minutos para cobrar corretor" type="number" defaultValue={String(agent.broker_followup_minutes)} />
      </div>

      <TextArea name="description" label="Descricao" rows={3} defaultValue={agent.description ?? ""} required={false} />
      <TextArea name="system_prompt" label="Prompt base" rows={9} defaultValue={agent.system_prompt} />
      <TextArea name="greeting_template" label="Saudacao para primeira resposta" rows={2} defaultValue={agent.greeting_template} />
      <TextArea name="humanization_rules" label="Regras de humanizacao" rows={6} defaultValue={agent.humanization_rules ?? ""} required={false} />
      <TextArea name="forbidden_phrases" label="Frases proibidas" rows={4} defaultValue={agent.forbidden_phrases ?? ""} required={false} />
      <TextArea name="conversation_examples" label="Exemplos de conversa boa" rows={7} defaultValue={agent.conversation_examples ?? ""} required={false} />
      <TextArea name="agent_skills" label="Skills do agente" rows={6} defaultValue={agent.agent_skills ?? ""} required={false} />
      <TextArea name="qualification_criteria" label="Criterios de qualificacao" rows={4} defaultValue={agent.qualification_criteria ?? ""} required={false} />
      <TextArea name="handoff_instructions" label="Instrucao de encaminhamento" rows={3} defaultValue={agent.handoff_instructions ?? ""} required={false} />
      <TextArea name="broker_message_template" label="Mensagem Uazapi para corretor" rows={5} defaultValue={agent.broker_message_template ?? ""} required={false} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm">
          <input name="message_split_enabled" type="checkbox" defaultChecked={agent.message_split_enabled} />
          Quebrar mensagens
        </label>
        <label className="flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm">
          <input name="appointment_enabled" type="checkbox" defaultChecked={agent.appointment_enabled} />
          Agendar visita
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="typing_words_per_minute" label="Palavras/min" type="number" defaultValue={String(agent.typing_words_per_minute)} />
        <Field name="appointment_duration_minutes" label="Duracao visita" type="number" defaultValue={String(agent.appointment_duration_minutes)} />
      </div>

      <section className="space-y-3 rounded-md border bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-950">Adicionar material</p>
        <Field name="material_title" label="Titulo" required={false} />
        <TextArea name="material_description" label="Descricao" rows={2} required={false} />
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Tipo</span>
          <select name="material_type" defaultValue="document" className="h-10 w-full rounded-md border bg-white px-3 text-sm">
            <option value="document">PDF/documento</option>
            <option value="image">Imagem</option>
            <option value="link">Link</option>
          </select>
        </label>
        <input name="material_file" type="file" accept="image/*,.pdf" className="block w-full rounded-md border bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium" />
        <Field name="material_url" label="Link externo" required={false} />
      </section>

      {state?.error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
      {state?.success ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{state.success}</p> : null}

      <button disabled={pending} className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-70">
        {pending ? "Salvando..." : "Salvar agente"}
      </button>
    </form>
  );
}

function Field({
  name,
  label,
  defaultValue,
  required = true,
  type = "text"
}: {
  name: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input name={name} type={type} defaultValue={defaultValue} required={required} className="h-10 w-full rounded-md border bg-white px-3 text-sm" />
    </label>
  );
}

function TextArea({
  name,
  label,
  defaultValue,
  rows,
  required = true
}: {
  name: string;
  label: string;
  defaultValue?: string;
  rows: number;
  required?: boolean;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <textarea name={name} rows={rows} defaultValue={defaultValue} required={required} className="w-full rounded-md border bg-white px-3 py-2 text-sm" />
    </label>
  );
}
