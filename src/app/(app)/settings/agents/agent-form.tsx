"use client";

import { useEffect } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Bot } from "lucide-react";
import { createAgentAction } from "./actions";

export function AgentForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createAgentAction, null);

  useEffect(() => {
    if (state?.agentId) {
      router.refresh();
    }
  }, [router, state?.agentId]);

  return (
    <form action={formAction} className="space-y-4 rounded-lg border bg-card p-6 shadow-sm">
      <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted text-slate-700">
        <Bot className="h-6 w-6" />
      </div>
      <h2 className="text-base font-semibold text-slate-950">Novo agente</h2>
      <Field name="name" label="Nome" placeholder="Agente Alto Padrao" />
      <label className="block space-y-2">
        <span className="text-sm font-medium text-slate-700">Tipo de agente</span>
        <select name="agent_type" defaultValue="lead_meta" className="h-10 w-full rounded-md border bg-white px-3 text-sm">
          <option value="lead_meta">Lead pela Meta oficial</option>
          <option value="broker_uazapi">Corretor pela Uazapi</option>
        </select>
      </label>
      <label className="block space-y-2">
        <span className="text-sm font-medium text-slate-700">Modelo</span>
        <select name="openai_model" defaultValue="gpt-5-mini" className="h-10 w-full rounded-md border bg-white px-3 text-sm">
          <option value="gpt-5-mini">GPT-5 mini</option>
          <option value="gpt-4.1-mini">GPT-4.1 mini</option>
        </select>
      </label>
      <TextArea name="description" label="Descricao" rows={3} required={false} placeholder="Atende leads de apartamentos de alto padrao em Goiania." />
      <TextArea name="system_prompt" label="Prompt de atendimento" rows={7} placeholder="Voce e um consultor imobiliario. Seja objetivo, cordial, pergunte regiao, orcamento, forma de pagamento e urgencia..." />
      <TextArea
        name="greeting_template"
        label="Saudacao para primeira resposta"
        rows={2}
        defaultValue="Olá, obrigado por responder. Como posso te ajudar?"
        placeholder="Olá, obrigado por responder. Como posso te ajudar?"
      />
      <TextArea
        name="humanization_rules"
        label="Regras de humanizacao"
        rows={5}
        required={false}
        placeholder={"Evitar 'Oi!'. Nao soar robotico. Usar frases curtas. Uma pergunta por mensagem. Nao empilhar qualificacao."}
      />
      <TextArea
        name="forbidden_phrases"
        label="Frases proibidas"
        rows={3}
        required={false}
        placeholder={"Como posso te ajudar hoje?\nTá mais olhando como investimento ou pra morar? logo no primeiro oi"}
      />
      <TextArea
        name="conversation_examples"
        label="Exemplos de conversa boa"
        rows={5}
        required={false}
        placeholder={"Lead: oi\nAgente: Olá, obrigado por responder. Como posso te ajudar?\n\nLead: queria saber valores\nAgente: Claro. Você pensou em studio ou apartamento maior?"}
      />
      <TextArea
        name="agent_skills"
        label="Skills do agente"
        rows={5}
        required={false}
        placeholder={"Quebrar objeções de preço\nExplicar fluxo de pagamento\nOferecer PDF ou imagem quando o lead pedir material\nConduzir para visita ao decorado"}
      />
      <TextArea name="qualification_criteria" label="Criterios de qualificacao" rows={4} required={false} placeholder="Qualificar quando tiver regiao, orcamento aproximado, forma de pagamento e intencao clara." />
      <TextArea name="handoff_instructions" label="Instrucao de encaminhamento" rows={3} required={false} placeholder="Ao qualificar, avise que vai encaminhar para um corretor especialista." />
      <TextArea
        name="broker_message_template"
        label="Mensagem Uazapi para corretor"
        rows={5}
        required={false}
        placeholder={"Ola, {{broker_name}}. Voce recebeu o lead {{lead_name}}.\n\nResumo:\n{{summary}}\n\nResponda aqui com o status do atendimento."}
      />
      <label className="block space-y-2">
        <span className="text-sm font-medium text-slate-700">Tempo para cobrar/redistribuir corretor</span>
        <input name="broker_followup_minutes" type="number" min="5" max="1440" defaultValue="30" className="h-10 w-full rounded-md border bg-white px-3 text-sm" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm">
          <input name="message_split_enabled" type="checkbox" defaultChecked />
          Quebrar mensagens
        </label>
        <label className="flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm">
          <input name="appointment_enabled" type="checkbox" defaultChecked />
          Agendar visita
        </label>
      </div>
      <section className="space-y-3 rounded-md border bg-slate-50 p-4">
        <div>
          <p className="text-sm font-semibold text-slate-950">Material do agente</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Anexe PDF ou imagem para o agente usar como referência quando o cliente pedir mais material.
          </p>
        </div>
        <Field name="material_title" label="Titulo do material" placeholder="Tabela de valores NATIV" required={false} />
        <TextArea name="material_description" label="Descricao do material" rows={2} required={false} placeholder="Use quando o lead pedir tabela, plantas ou mais imagens." />
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Tipo</span>
          <select name="material_type" defaultValue="document" className="h-10 w-full rounded-md border bg-white px-3 text-sm">
            <option value="document">PDF/documento</option>
            <option value="image">Imagem</option>
            <option value="link">Link</option>
          </select>
        </label>
        <input
          name="material_file"
          type="file"
          accept="image/*,.pdf"
          className="block w-full rounded-md border bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
        <Field name="material_url" label="Link externo" placeholder="https://..." required={false} />
      </section>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Palavras/min</span>
          <input name="typing_words_per_minute" type="number" min="80" max="260" defaultValue="150" className="h-10 w-full rounded-md border bg-white px-3 text-sm" />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Duracao visita</span>
          <input name="appointment_duration_minutes" type="number" min="15" max="180" defaultValue="30" className="h-10 w-full rounded-md border bg-white px-3 text-sm" />
        </label>
      </div>

      {state?.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      {state?.success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {state.success}
        </p>
      ) : null}

      <button
        disabled={pending}
        className="h-10 w-full rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? "Criando agente..." : "Criar agente"}
      </button>
    </form>
  );
}

function Field({
  name,
  label,
  placeholder,
  required = true
}: {
  name: string;
  label: string;
  placeholder: string;
  required?: boolean;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input name={name} required={required} placeholder={placeholder} className="h-10 w-full rounded-md border bg-white px-3 text-sm" />
    </label>
  );
}

function TextArea({
  name,
  label,
  placeholder,
  defaultValue,
  rows,
  required = true
}: {
  name: string;
  label: string;
  placeholder: string;
  defaultValue?: string;
  rows: number;
  required?: boolean;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <textarea
        name={name}
        rows={rows}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full rounded-md border bg-white px-3 py-2 text-sm"
      />
    </label>
  );
}
