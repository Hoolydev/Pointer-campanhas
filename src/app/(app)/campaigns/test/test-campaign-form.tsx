"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";

type AgentOption = {
  id: string;
  name: string;
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

export function TestCampaignForm({
  agents,
  metaPhone,
  metaTemplates
}: {
  agents: AgentOption[];
  metaPhone: MetaPhoneResult;
  metaTemplates: MetaTemplatesResult;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const approvedTemplates = metaTemplates.data.filter((template) => template.status === "APPROVED");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/campaigns/test", {
        method: "POST",
        body: formData
      });
      const payload = (await response.json().catch(() => ({}))) as {
        campaignId?: string;
        error?: string;
      };

      if (!response.ok || !payload.campaignId) {
        setError(payload.error ?? "Nao foi possivel criar a campanha de teste.");
        return;
      }

      router.push(`/campaigns/${payload.campaignId}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section className="space-y-5 rounded-lg border bg-card p-6 shadow-sm">
        <Field name="name" label="Nome do teste" placeholder="Teste Nay - meu numero" defaultValue="Campanha de teste" />
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Agente IA</span>
          <select name="agent_id" required className="h-11 w-full rounded-md border bg-white px-3 text-sm">
            <option value="">Selecione um agente Lead/Meta</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
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
          <span className="text-sm font-medium text-slate-700">Template aprovado</span>
          <select name="meta_template_name" required className="h-11 w-full rounded-md border bg-white px-3 text-sm">
            <option value="">Selecione um template</option>
            {approvedTemplates.map((template) => (
              <option key={`${template.name}-${template.language}`} value={template.name}>
                {template.name} • {template.language} • {template.category || "sem categoria"}
              </option>
            ))}
          </select>
        </label>
        <Field name="meta_template_language" label="Idioma" placeholder="pt_BR" defaultValue={approvedTemplates[0]?.language ?? "pt_BR"} />
        <TextArea name="meta_template_body_params" label="Variaveis do corpo" rows={3} defaultValue="{{nome}}" required={false} />
        <section className="space-y-3 rounded-md border bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-950">Midia do template</p>
          <select name="meta_header_media_type" className="h-10 w-full rounded-md border bg-white px-3 text-sm">
            <option value="">Detectar automaticamente</option>
            <option value="video">Video</option>
            <option value="image">Imagem</option>
            <option value="document">Documento</option>
          </select>
          <input
            name="meta_header_media_file"
            type="file"
            accept="image/*,video/*,.pdf"
            className="block w-full rounded-md border bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
          <Field name="meta_header_media_id" label="Media ID da Meta" placeholder="Opcional" required={false} />
        </section>
      </section>
      <aside className="space-y-5">
        <section className="rounded-lg border bg-card p-6 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted text-slate-700">
            <Send className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-base font-semibold text-slate-950">Numeros de teste</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Um por linha. Use DDD. Aceita nome com telefone ou apenas o numero.
          </p>
          <TextArea
            name="contacts_text"
            label="Telefones"
            rows={10}
            placeholder={"Silfarney, 62982540748\nMaria, (62) 99999-9999"}
          />
        </section>
        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <button
          disabled={pending}
          className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-70"
        >
          {pending ? "Criando teste..." : "Criar campanha de teste"}
        </button>
      </aside>
    </form>
  );
}

function Field({
  name,
  label,
  placeholder,
  defaultValue,
  required = true
}: {
  name: string;
  label: string;
  placeholder: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input name={name} placeholder={placeholder} defaultValue={defaultValue} required={required} className="h-11 w-full rounded-md border bg-white px-3 text-sm" />
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
  placeholder?: string;
  defaultValue?: string;
  rows: number;
  required?: boolean;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <textarea name={name} placeholder={placeholder} defaultValue={defaultValue} rows={rows} required={required} className="w-full rounded-md border bg-white px-3 py-2 text-sm" />
    </label>
  );
}
