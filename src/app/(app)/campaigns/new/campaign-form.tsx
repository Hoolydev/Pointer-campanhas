"use client";

import { useActionState } from "react";
import { UploadCloud } from "lucide-react";
import { createCampaignAction } from "./actions";

type AgentOption = {
  id: string;
  name: string;
  description: string | null;
};

type MetaPhoneResult = {
  data: {
    displayPhoneNumber: string | null;
    verifiedName: string | null;
    qualityRating: string | null;
  } | null;
  error: string | null;
};

type MetaTemplatesResult = {
  data: Array<{
    name: string;
    language: string;
    status: string;
    category: string | null;
  }>;
  error: string | null;
};

export function CampaignForm({
  agents,
  metaPhone,
  metaTemplates
}: {
  agents: AgentOption[];
  metaPhone: MetaPhoneResult;
  metaTemplates: MetaTemplatesResult;
}) {
  const [state, formAction, pending] = useActionState(createCampaignAction, null);
  const approvedTemplates = metaTemplates.data.filter((template) => template.status === "APPROVED");

  return (
    <form action={formAction} className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section className="space-y-5 rounded-lg border bg-card p-6 shadow-sm">
        <Field label="Nome interno da campanha" name="name" placeholder="Nativ - Lista Maio" />
        <section className="rounded-md border bg-slate-50 p-4">
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-950">
              Agente IA que dara continuidade
            </span>
            <select
              name="agent_id"
              required
              className="h-11 w-full rounded-md border bg-white px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
            >
              <option value="">Selecione um agente Lead/Meta</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
          {agents.length === 0 ? (
            <p className="mt-2 text-xs text-red-700">
              Nenhum agente Lead/Meta ativo encontrado. Crie um em Configuracoes &gt; Agentes IA.
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Esse agente assume a conversa quando o lead responder ao template da campanha.
            </p>
          )}
        </section>
        <section className="rounded-md border bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-950">Meta WhatsApp conectado</p>
          {metaPhone.data ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {metaPhone.data.displayPhoneNumber || "Numero sem display"} •{" "}
              {metaPhone.data.verifiedName || "Nome nao retornado"} • qualidade{" "}
              {metaPhone.data.qualityRating || "nao informada"}
            </p>
          ) : (
            <p className="mt-1 text-sm text-red-700">{metaPhone.error}</p>
          )}
        </section>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Template Meta aprovado</span>
          <select
            name="meta_template_name"
            required
            className="h-11 w-full rounded-md border bg-white px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
          >
            <option value="">Selecione um template</option>
            {approvedTemplates.map((template) => (
              <option key={`${template.name}-${template.language}`} value={template.name}>
                {template.name} • {template.language} • {template.category || "sem categoria"}
              </option>
            ))}
          </select>
          {metaTemplates.error ? (
            <span className="text-xs text-red-700">{metaTemplates.error}</span>
          ) : null}
          {!metaTemplates.error && approvedTemplates.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              Nenhum template aprovado retornado pela Meta para este WABA.
            </span>
          ) : null}
        </label>
        <Field label="Idioma do template" name="meta_template_language" placeholder="pt_BR" defaultValue={approvedTemplates[0]?.language ?? "pt_BR"} />
        <TextArea
          label="Variaveis do corpo do template"
          name="meta_template_body_params"
          placeholder="{{nome}}"
          defaultValue="{{nome}}"
          rows={4}
          required={false}
        />
        <section className="space-y-4 rounded-md border bg-slate-50 p-4">
          <div>
            <p className="text-sm font-semibold text-slate-950">Midia do header do template</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Use quando o template aprovado na Meta tiver header de imagem, video ou documento.
            </p>
          </div>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Tipo de midia</span>
            <select name="meta_header_media_type" className="h-10 w-full rounded-md border bg-white px-3 text-sm">
              <option value="">Detectar automaticamente</option>
              <option value="video">Video</option>
              <option value="image">Imagem</option>
              <option value="document">Documento</option>
            </select>
          </label>
          <input
            name="meta_header_media_file"
            type="file"
            accept="image/*,video/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
            className="block w-full rounded-md border bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
          <Field
            label="Media ID da Meta"
            name="meta_header_media_id"
            placeholder="Opcional, se a midia ja estiver enviada"
            required={false}
          />
        </section>
      </section>

      <aside className="space-y-5">
        <section className="rounded-lg border bg-card p-6 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted text-slate-700">
            <UploadCloud className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-base font-semibold text-slate-950">Planilha de contatos</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Envie CSV ou XLSX. O importador procura colunas como nome, telefone, celular ou
            WhatsApp e normaliza para o padrao 55DDDnumero. Numeros sem DDD sao ignorados.
          </p>
          <input
            name="contacts_file"
            type="file"
            accept=".csv,.xlsx,.xls"
            required
            className="mt-5 block w-full rounded-md border bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
        </section>

        {state?.error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {pending ? "Criando campanha..." : "Criar campanha e importar"}
        </button>
      </aside>
    </form>
  );
}

function Field({
  label,
  name,
  placeholder,
  defaultValue,
  required = true
}: {
  label: string;
  name: string;
  placeholder: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        name={name}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        className="h-11 w-full rounded-md border bg-white px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
      />
    </label>
  );
}

function TextArea({
  label,
  name,
  placeholder,
  defaultValue,
  rows,
  required = true
}: {
  label: string;
  name: string;
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
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        rows={rows}
        className="w-full resize-y rounded-md border bg-white px-3 py-2 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
      />
    </label>
  );
}
