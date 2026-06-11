"use client";

import { useActionState, useState } from "react";
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

type WhatsappInstanceOption = {
  id: string;
  name: string;
  phone: string | null;
  hourly_limit: number;
  sent_current_hour: number;
};

const MAX_ROUTE_UPLOAD_BYTES = 4 * 1024 * 1024;

export function CampaignForm({
  agents,
  uazapiInstances,
  metaPhone,
  metaTemplates
}: {
  agents: AgentOption[];
  uazapiInstances: WhatsappInstanceOption[];
  metaPhone: MetaPhoneResult;
  metaTemplates: MetaTemplatesResult;
}) {
  const [state, formAction, pending] = useActionState(createCampaignAction, null);
  const [clientError, setClientError] = useState<string | null>(null);
  const approvedTemplates = metaTemplates.data.filter((template) => template.status === "APPROVED");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("meta_header_media_file") as HTMLInputElement | null;
    const mediaIdInput = form.elements.namedItem("meta_header_media_id") as HTMLInputElement | null;
    const file = fileInput?.files?.[0];
    const mediaId = mediaIdInput?.value.trim();
    const channel = String((form.elements.namedItem("dispatch_channel") as HTMLSelectElement | null)?.value ?? "meta");
    const selectedInstances = Array.from(form.querySelectorAll<HTMLInputElement>("input[name='uazapi_instance_ids']:checked"));

    if (channel === "uazapi" && selectedInstances.length === 0) {
      event.preventDefault();
      setClientError("Selecione ao menos uma instancia Uazapi para essa campanha.");
      return;
    }

    if (selectedInstances.length > 5) {
      event.preventDefault();
      setClientError("Selecione no maximo 5 instancias Uazapi por campanha.");
      return;
    }

    if (file && file.size > MAX_ROUTE_UPLOAD_BYTES) {
      if (mediaId) {
        fileInput.value = "";
        setClientError(null);
        return;
      }

      event.preventDefault();
      setClientError(
        "Esse arquivo passa do limite de upload da Vercel. Envie a midia para a Meta primeiro e cole o Media ID, ou use um arquivo com ate 4 MB."
      );
      return;
    }

    setClientError(null);
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section className="space-y-5 rounded-lg border bg-card p-6 shadow-sm">
        <Field label="Nome interno da campanha" name="name" placeholder="Nativ - Lista Maio" />
        <section className="grid gap-4 rounded-md border bg-slate-50 p-4 sm:grid-cols-2">
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-950">Canal do disparo inicial</span>
            <select
              name="dispatch_channel"
              defaultValue="meta"
              className="h-11 w-full rounded-md border bg-white px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
            >
              <option value="meta">Meta Cloud API - Template oficial</option>
              <option value="uazapi">Uazapi - Rodizio humanizado</option>
            </select>
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-950">Rodizio Uazapi</span>
            <select
              name="uazapi_instance_strategy"
              defaultValue="round_robin"
              className="h-11 w-full rounded-md border bg-white px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
            >
              <option value="round_robin">Alternar pela ordem cadastrada</option>
              <option value="least_recent">Usar numero menos recente</option>
            </select>
          </label>
          <Field
            label="Intervalo minimo entre mensagens"
            name="send_interval_min_seconds"
            placeholder="90"
            defaultValue="90"
          />
          <Field
            label="Intervalo maximo entre mensagens"
            name="send_interval_max_seconds"
            placeholder="240"
            defaultValue="240"
          />
          <label className="block space-y-2 sm:col-span-2">
            <span className="text-sm font-medium text-slate-700">Mensagem inicial Uazapi</span>
            <textarea
              name="initial_message"
              rows={3}
              placeholder="Olá, {{nome}}. Obrigado por responder. Como posso te ajudar?"
              className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
            />
          </label>
          <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">
            O n8n usa uma pausa aleatoria e limita cada instancia a no maximo 20 mensagens por hora. Com 3 instancias selecionadas, a campanha chega a 60 mensagens/hora.
          </p>
          <div className="space-y-3 sm:col-span-2">
            <div>
              <span className="text-sm font-semibold text-slate-950">Numeros Uazapi desta campanha</span>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Selecione ate 5 instancias. O rodizio usa apenas os numeros marcados aqui.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {uazapiInstances.map((instance) => (
                <label key={instance.id} className="flex items-start gap-3 rounded-md border bg-white p-3 text-sm">
                  <input name="uazapi_instance_ids" type="checkbox" value={instance.id} className="mt-1 h-4 w-4" />
                  <span>
                    <span className="block font-semibold text-slate-950">{instance.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {instance.phone || "Numero sem telefone"} • {instance.sent_current_hour}/{Math.min(20, instance.hourly_limit)} nesta hora
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {uazapiInstances.length === 0 ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Nenhuma instancia Uazapi ativa. Cadastre em Configuracoes &gt; WhatsApp.
              </p>
            ) : null}
          </div>
        </section>
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
          <p className="text-xs leading-5 text-muted-foreground">
            Na Vercel, anexos acima de 4 MB precisam ser enviados pela Meta antes. Depois cole o Media ID abaixo.
          </p>
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

        {clientError || state?.error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {clientError || state?.error}
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
