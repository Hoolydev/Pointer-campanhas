"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import type { Route } from "next";
import type { LucideIcon } from "lucide-react";
import { Bot, Check, ChevronLeft, ChevronRight, ClipboardList, MessageSquare, Plug, UploadCloud } from "lucide-react";
import { createCampaignAction, createInboundCampaignAction } from "./actions";

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

type Mode = "outbound" | "inbound";
type ContactSource = "file" | "existing_unsent" | "manual";

const MAX_ROUTE_UPLOAD_BYTES = 4 * 1024 * 1024;

const stageOptions = [
  { label: "Lead Novo", value: "0" },
  { label: "Qualificando com a Nay", value: "2" },
  { label: "Aguardando atendimento / corretor", value: "3" },
  { label: "1 atendimento com corretor", value: "6" },
  { label: "Lead Qualificado / Em atendimento", value: "7" }
];

export function CampaignForm({
  agents,
  uazapiInstances,
  reusableContactsCount,
  metaPhone,
  metaTemplates
}: {
  agents: AgentOption[];
  uazapiInstances: WhatsappInstanceOption[];
  reusableContactsCount: number;
  metaPhone: MetaPhoneResult;
  metaTemplates: MetaTemplatesResult;
}) {
  const [mode, setMode] = useState<Mode>("outbound");
  const [step, setStep] = useState(0);
  const [channel, setChannel] = useState<"meta" | "uazapi">("meta");
  const [contactSource, setContactSource] = useState<ContactSource>("file");
  const [selectedInstances, setSelectedInstances] = useState<string[]>([]);
  const [clientError, setClientError] = useState<string | null>(null);
  const [outboundState, outboundAction, outboundPending] = useActionState(createCampaignAction, null);
  const [inboundState, inboundAction, inboundPending] = useActionState(createInboundCampaignAction, null);
  const approvedTemplates = metaTemplates.data.filter((template) => template.status === "APPROVED");
  const pending = outboundPending || inboundPending;
  const stateError = mode === "outbound" ? outboundState?.error : inboundState?.error;
  const steps = useMemo(
    () =>
      mode === "outbound"
        ? ["Tipo", "Conexoes", "Agente", "Lista", "Revisao"]
        : ["Tipo", "Funil", "Agente", "Follow-up", "Revisao"],
    [mode]
  );
  const selectedCapacity = selectedInstances.length * 20;

  function selectMode(nextMode: Mode) {
    setMode(nextMode);
    setStep(1);
    setClientError(null);
  }

  function toggleInstance(id: string) {
    setSelectedInstances((current) => {
      if (current.includes(id)) {
        return current.filter((item) => item !== id);
      }

      if (current.length >= 5) {
        setClientError("Escolha no maximo 5 numeros para esta campanha.");
        return current;
      }

      setClientError(null);
      return [...current, id];
    });
  }

  function nextStep() {
    if (mode === "outbound" && step === 1 && channel === "uazapi" && selectedInstances.length === 0) {
      setClientError("Selecione ao menos uma instancia Uazapi ou conecte um numero antes de continuar.");
      return;
    }

    setClientError(null);
    setStep((current) => Math.min(steps.length - 1, current + 1));
  }

  function previousStep() {
    setClientError(null);
    setStep((current) => Math.max(0, current - 1));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;

    if (mode === "outbound") {
      const fileInput = form.elements.namedItem("meta_header_media_file") as HTMLInputElement | null;
      const mediaIdInput = form.elements.namedItem("meta_header_media_id") as HTMLInputElement | null;
      const file = fileInput?.files?.[0];
      const mediaId = mediaIdInput?.value.trim();

      if (channel === "uazapi" && selectedInstances.length === 0) {
        event.preventDefault();
        setClientError("Selecione ao menos uma instancia Uazapi para essa campanha.");
        return;
      }

      if (file && file.size > MAX_ROUTE_UPLOAD_BYTES) {
        if (mediaId) {
          fileInput.value = "";
          setClientError(null);
          return;
        }

        event.preventDefault();
        setClientError("Arquivo acima de 4 MB: cole o Media ID da Meta ou use um arquivo menor.");
        return;
      }
    }

    setClientError(null);
  }

  return (
    <form
      action={mode === "outbound" ? outboundAction : inboundAction}
      onSubmit={handleSubmit}
      noValidate
      className="space-y-6"
    >
      <section className="rounded-lg border bg-card shadow-sm">
        <div className="border-b px-6 py-5">
          <StepHeader steps={steps} activeStep={step} />
        </div>

        <div className="p-6">
          {step === 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              <ModeCard
                active={mode === "outbound"}
                icon={UploadCloud}
                title="Outbound por lista"
                description="Subir planilha, escolher Meta ou Uazapi, disparar e deixar a IA continuar."
                onClick={() => selectMode("outbound")}
              />
              <ModeCard
                active={mode === "inbound"}
                icon={MessageSquare}
                title="Inbound HauzApp"
                description="Atender automaticamente leads que entrarem no funil Lead Novo do HauzApp."
                onClick={() => selectMode("inbound")}
              />
            </div>
          ) : mode === "outbound" ? (
            <div>
              {[1, 2, 3, 4].map((item) => (
                <div key={`outbound-${item}`} className={step === item ? "block" : "hidden"}>
                  <OutboundStep
                    step={item}
                    channel={channel}
                    setChannel={setChannel}
                    agents={agents}
                    metaPhone={metaPhone}
                    approvedTemplates={approvedTemplates}
                    metaTemplatesError={metaTemplates.error}
                    uazapiInstances={uazapiInstances}
                    selectedInstances={selectedInstances}
                    toggleInstance={toggleInstance}
                    selectedCapacity={selectedCapacity}
                    contactSource={contactSource}
                    setContactSource={setContactSource}
                    reusableContactsCount={reusableContactsCount}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div>
              {[1, 2, 3, 4].map((item) => (
                <div key={`inbound-${item}`} className={step === item ? "block" : "hidden"}>
                  <InboundStep step={item} agents={agents} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {clientError || stateError ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {clientError || stateError}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {mode === "outbound"
                  ? "Fluxo outbound: lista, disparo e continuidade pela IA."
                  : "Fluxo inbound: HauzApp, IA e repasse ao corretor."}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {step > 0 ? (
              <button
                type="button"
                onClick={previousStep}
                className="inline-flex h-10 items-center gap-2 rounded-md border bg-white px-4 text-sm font-semibold"
              >
                <ChevronLeft className="h-4 w-4" />
                Voltar
              </button>
            ) : null}
            {step < steps.length - 1 ? (
              <button
                type="button"
                onClick={nextStep}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
              >
                Avancar
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={pending}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-70"
              >
                <Check className="h-4 w-4" />
                {pending ? "Salvando..." : mode === "outbound" ? "Criar campanha outbound" : "Ativar campanha inbound"}
              </button>
            )}
          </div>
        </div>
      </section>
    </form>
  );
}

function OutboundStep({
  step,
  channel,
  setChannel,
  agents,
  metaPhone,
  approvedTemplates,
  metaTemplatesError,
  uazapiInstances,
  selectedInstances,
  toggleInstance,
  selectedCapacity,
  contactSource,
  setContactSource,
  reusableContactsCount
}: {
  step: number;
  channel: "meta" | "uazapi";
  setChannel: (channel: "meta" | "uazapi") => void;
  agents: AgentOption[];
  metaPhone: MetaPhoneResult;
  approvedTemplates: MetaTemplatesResult["data"];
  metaTemplatesError: string | null;
  uazapiInstances: WhatsappInstanceOption[];
  selectedInstances: string[];
  toggleInstance: (id: string) => void;
  selectedCapacity: number;
  contactSource: ContactSource;
  setContactSource: (source: ContactSource) => void;
  reusableContactsCount: number;
}) {
  if (step === 1) {
    return (
      <div className="space-y-5">
        <input type="hidden" name="dispatch_channel" value={channel} />
        <input type="hidden" name="uazapi_instance_strategy" value="round_robin" />
        <Field label="Nome da campanha" name="name" placeholder="Nativ - lista investidores" />

        <div className="grid gap-4 md:grid-cols-2">
          <ChoiceCard
            active={channel === "meta"}
            title="Meta oficial"
            description="Use template aprovado para abrir conversa com seguranca."
            onClick={() => setChannel("meta")}
          />
          <ChoiceCard
            active={channel === "uazapi"}
            title="Uazapi humanizado"
            description="Alterne chips conectados e respeite 20 mensagens por hora por numero."
            onClick={() => setChannel("uazapi")}
          />
        </div>

        {channel === "meta" ? (
          <section className="rounded-md border bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-950">Meta conectada</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {metaPhone.data
                ? `${metaPhone.data.displayPhoneNumber || "Numero sem display"} - ${metaPhone.data.verifiedName || "Nome nao retornado"} - qualidade ${metaPhone.data.qualityRating || "nao informada"}`
                : metaPhone.error || "Meta nao conectada"}
            </p>
          </section>
        ) : (
          <section className="space-y-3 rounded-md border bg-slate-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-950">Numeros que vao disparar</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedInstances.length} selecionado(s), capacidade estimada {selectedCapacity}/h.
                </p>
              </div>
              <Link href={"/settings/whatsapp" as Route} className="rounded-md border bg-white px-3 py-2 text-sm font-semibold">
                Conectar numero
              </Link>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {uazapiInstances.map((instance) => (
                <button
                  key={instance.id}
                  type="button"
                  onClick={() => toggleInstance(instance.id)}
                  className={`rounded-md border p-3 text-left text-sm transition ${
                    selectedInstances.includes(instance.id) ? "border-teal-500 bg-teal-50" : "bg-white hover:border-slate-300"
                  }`}
                >
                  <span className="block font-semibold text-slate-950">{instance.name}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {instance.phone || "Telefone nao informado"} - {instance.sent_current_hour}/{Math.min(20, instance.hourly_limit)} nesta hora
                  </span>
                  {selectedInstances.includes(instance.id) ? (
                    <input type="hidden" name="uazapi_instance_ids" value={instance.id} />
                  ) : null}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <section className="space-y-4">
          <AgentSelect agents={agents} />
          <PipelineSelects />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Follow-up corretor apos visita (min)" name="material_title_1" placeholder="15 min" required={false} />
            <Field label="Escalar sem resposta (min)" name="material_title_2" placeholder="30 min" required={false} />
          </div>
        </section>
        <SideNote
          icon={Bot}
          title="Continuidade da IA"
          lines={[
            "O agente escolhido responde quando o lead falar no WhatsApp.",
            "Ao qualificar, o lead entra na etapa configurada e pode seguir para corretor."
          ]}
        />
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <section className="space-y-5">
          {channel === "meta" ? (
            <MetaTemplateFields approvedTemplates={approvedTemplates} metaTemplatesError={metaTemplatesError} />
          ) : (
            <>
              <TextArea
                label="Primeira mensagem Uazapi"
                name="initial_message"
                placeholder="Ola, {{nome}}. Obrigado por responder. Como posso te ajudar?"
                defaultValue="Ola, {{nome}}. Obrigado por responder. Como posso te ajudar?"
                rows={4}
              />
              <input type="hidden" name="send_interval_min_seconds" value="90" />
              <input type="hidden" name="send_interval_max_seconds" value="240" />
            </>
          )}
          <section className="rounded-md border bg-slate-50 p-4">
            <div className="flex items-start gap-3">
              <UploadCloud className="mt-0.5 h-5 w-5 text-slate-600" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-slate-950">Origem dos contatos</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Escolha se vai subir uma nova lista ou reaproveitar contatos antigos que ainda nao receberam mensagem.
                </p>
              </div>
            </div>
            <input type="hidden" name="contact_source" value={contactSource} />

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <ChoiceCard
                active={contactSource === "file"}
                title="Nova planilha"
                description="CSV ou XLSX com nome e telefone."
                onClick={() => setContactSource("file")}
              />
              <ChoiceCard
                active={contactSource === "existing_unsent"}
                title="Base antiga"
                description={`${reusableContactsCount} contato(s) em pending/queued/failed.`}
                onClick={() => setContactSource("existing_unsent")}
              />
              <ChoiceCard
                active={contactSource === "manual"}
                title="Colar contatos"
                description="Bom para testes pequenos."
                onClick={() => setContactSource("manual")}
              />
            </div>

            {contactSource === "file" ? (
              <input
                name="contacts_file"
                type="file"
                accept=".csv,.xlsx,.xls"
                required
                className="mt-4 block w-full rounded-md border bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
              />
            ) : null}

            {contactSource === "existing_unsent" ? (
              <div className="mt-4 grid gap-3 md:grid-cols-[220px_1fr]">
                <Field
                  label="Quantidade maxima"
                  name="reuse_contact_limit"
                  placeholder="10000"
                  defaultValue={String(Math.min(Math.max(reusableContactsCount, 1), 20000))}
                />
                <div className="rounded-md border bg-white px-4 py-3 text-sm leading-6 text-muted-foreground">
                  O sistema vai copiar para esta campanha apenas contatos antigos sem mensagem outbound marcada como enviada.
                </div>
              </div>
            ) : null}

            {contactSource === "manual" ? (
              <TextArea
                label="Contatos"
                name="contacts_text"
                placeholder={"Silfarney, 62982540748\nMaria, 62999998888"}
                rows={6}
              />
            ) : null}
          </section>
        </section>
        <SideNote
          icon={ClipboardList}
          title="Regra de envio"
          lines={[
            channel === "meta" ? "Template aprovado abre a conversa pela API oficial." : "Cada chip selecionado envia ate 20 mensagens por hora.",
            "Quando o cliente responder, o webhook chama o agente automaticamente."
          ]}
        />
      </div>
    );
  }

  return (
    <ReviewPanel
      title="Revisao outbound"
      items={[
        `Canal inicial: ${channel === "meta" ? "Meta oficial" : "Uazapi com rodizio"}`,
        channel === "uazapi" ? `Numeros selecionados: ${selectedInstances.length}` : "Template Meta selecionado na etapa anterior",
        "Agente IA vai continuar as respostas",
        "CRM interno acompanha qualquer falha ou resposta"
      ]}
    />
  );
}

function InboundStep({ step, agents }: { step: number; agents: AgentOption[] }) {
  if (step === 1) {
    return (
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <section className="space-y-4">
          <Field label="Nome da campanha inbound" name="name" placeholder="Inbound HauzApp - Lead Novo" defaultValue="Inbound HauzApp - Lead Novo" />
          <div className="grid gap-4 md:grid-cols-3">
            <SelectField label="Quando o lead entra" name="prospection_stage_id" defaultValue="0" options={stageOptions} />
            <SelectField label="Enquanto a IA atende" name="contact_stage_id" defaultValue="2" options={stageOptions} />
            <SelectField label="Depois de qualificado" name="qualified_stage_id" defaultValue="3" options={stageOptions} />
          </div>
        </section>
        <SideNote
          icon={Plug}
          title="HauzApp"
          lines={[
            "O n8n busca negocios em Lead Novo.",
            "Quando a IA inicia, move para Qualificando com a Nay.",
            "Quando qualifica, move para a etapa de corretor."
          ]}
        />
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <section className="space-y-4">
          <AgentSelect agents={agents} />
          <label className="flex items-center gap-3 rounded-md border bg-white px-3 py-3 text-sm">
            <input name="auto_attend" type="checkbox" defaultChecked className="h-4 w-4" />
            Atender automaticamente novos leads
          </label>
          <label className="flex items-center gap-3 rounded-md border bg-white px-3 py-3 text-sm">
            <input name="auto_greet" type="checkbox" className="h-4 w-4" />
            Enviar saudacao proativa ao importar
          </label>
        </section>
        <SideNote
          icon={Bot}
          title="Prompt do agente"
          lines={[
            "Edite o prompt completo em Agentes IA.",
            "Esta campanha apenas escolhe qual agente assume os leads desse funil."
          ]}
          href="/settings/agents"
          hrefLabel="Abrir agentes"
        />
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <section className="grid gap-4 md:grid-cols-2">
          <Field label="Cobrar corretor apos visita" name="broker_followup_minutes" placeholder="15" defaultValue="15" />
          <Field label="Escalar sem resposta" name="broker_escalation_minutes" placeholder="30" defaultValue="30" />
          <div className="rounded-md border bg-slate-50 p-4 md:col-span-2">
            <p className="text-sm font-semibold text-slate-950">Webhook Uazapi para continuidade</p>
            <p className="mt-2 rounded-md bg-white px-3 py-2 font-mono text-xs text-slate-700">
              https://pointer-campanhas.vercel.app/api/webhooks/uazapi
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Marque envio de mensagem recebida, texto da mensagem, telefone/remetente, nome do contato e ID da mensagem.
            </p>
          </div>
        </section>
        <SideNote
          icon={MessageSquare}
          title="Cobranca do corretor"
          lines={[
            "Primeira cobranca em 15 minutos.",
            "Sem resposta, escala para administrador.",
            "O SLA continua pelo fluxo n8n."
          ]}
        />
      </div>
    );
  }

  return (
    <ReviewPanel
      title="Revisao inbound"
      items={[
        "Origem: HauzApp Lead Novo",
        "Atendimento: agente IA selecionado",
        "Qualificado: move para etapa de corretor",
        "Corretor: follow-up e escalonamento configurados"
      ]}
    />
  );
}

function StepHeader({ steps, activeStep }: { steps: string[]; activeStep: number }) {
  return (
    <div className="grid gap-2 md:grid-cols-5">
      {steps.map((label, index) => (
        <div key={label} className={`rounded-md border px-3 py-2 text-sm ${index === activeStep ? "border-teal-500 bg-teal-50 text-teal-900" : "bg-white text-muted-foreground"}`}>
          <span className="font-semibold">{index + 1}. </span>{label}
        </div>
      ))}
    </div>
  );
}

function ModeCard({
  active,
  icon: Icon,
  title,
  description,
  onClick
}: {
  active: boolean;
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-5 text-left transition ${active ? "border-teal-500 bg-teal-50" : "bg-white hover:border-slate-300"}`}
    >
      <Icon className="h-5 w-5 text-teal-700" />
      <p className="mt-4 text-base font-semibold text-slate-950">{title}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    </button>
  );
}

function ChoiceCard({
  active,
  title,
  description,
  onClick
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border p-4 text-left text-sm transition ${active ? "border-teal-500 bg-teal-50" : "bg-white hover:border-slate-300"}`}
    >
      <span className="block font-semibold text-slate-950">{title}</span>
      <span className="mt-1 block leading-5 text-muted-foreground">{description}</span>
    </button>
  );
}

function AgentSelect({ agents }: { agents: AgentOption[] }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-semibold text-slate-950">Agente IA</span>
      <select name="agent_id" required className="h-11 w-full rounded-md border bg-white px-3 text-sm">
        <option value="">Selecione um agente</option>
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
          </option>
        ))}
      </select>
      {agents.length === 0 ? (
        <span className="text-xs text-red-700">Crie um agente ativo antes de continuar.</span>
      ) : null}
    </label>
  );
}

function PipelineSelects() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <SelectField label="Lead qualificado vai para" name="material_type_1" defaultValue="document" options={[{ label: "Aguardando atendimento / corretor", value: "document" }]} />
      <SelectField label="CRM interno acompanha como" name="material_type_2" defaultValue="document" options={[{ label: "Qualificado", value: "document" }]} />
    </div>
  );
}

function MetaTemplateFields({
  approvedTemplates,
  metaTemplatesError
}: {
  approvedTemplates: MetaTemplatesResult["data"];
  metaTemplatesError: string | null;
}) {
  return (
    <section className="space-y-4">
      <label className="block space-y-2">
        <span className="text-sm font-semibold text-slate-950">Template aprovado da Meta</span>
        <select name="meta_template_name" required className="h-11 w-full rounded-md border bg-white px-3 text-sm">
          <option value="">Selecione um template</option>
          {approvedTemplates.map((template) => (
            <option key={`${template.name}-${template.language}`} value={template.name}>
              {template.name} - {template.language} - {template.category || "sem categoria"}
            </option>
          ))}
        </select>
        {metaTemplatesError ? <span className="text-xs text-red-700">{metaTemplatesError}</span> : null}
      </label>
      <input type="hidden" name="send_interval_min_seconds" value="90" />
      <input type="hidden" name="send_interval_max_seconds" value="240" />
      <Field label="Idioma do template" name="meta_template_language" placeholder="pt_BR" defaultValue={approvedTemplates[0]?.language ?? "pt_BR"} />
      <TextArea label="Variaveis do template" name="meta_template_body_params" placeholder="{{nome}}" defaultValue="{{nome}}" rows={3} required={false} />
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField
          label="Tipo de midia do header"
          name="meta_header_media_type"
          defaultValue=""
          options={[
            { label: "Sem midia / detectar", value: "" },
            { label: "Video", value: "video" },
            { label: "Imagem", value: "image" },
            { label: "Documento", value: "document" }
          ]}
        />
        <Field label="Media ID da Meta" name="meta_header_media_id" placeholder="Opcional" required={false} />
      </div>
      <input name="meta_header_media_file" type="file" accept="image/*,video/*,.pdf,.doc,.docx" className="block w-full rounded-md border bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium" />
    </section>
  );
}

function SideNote({
  icon: Icon,
  title,
  lines,
  href,
  hrefLabel
}: {
  icon: LucideIcon;
  title: string;
  lines: string[];
  href?: Route;
  hrefLabel?: string;
}) {
  return (
    <aside className="rounded-lg border bg-slate-50 p-5">
      <Icon className="h-5 w-5 text-teal-700" />
      <p className="mt-4 text-sm font-semibold text-slate-950">{title}</p>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {href && hrefLabel ? (
        <Link href={href} className="mt-4 inline-flex rounded-md border bg-white px-3 py-2 text-sm font-semibold">
          {hrefLabel}
        </Link>
      ) : null}
    </aside>
  );
}

function ReviewPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-lg border bg-slate-50 p-5">
      <p className="text-base font-semibold text-slate-950">{title}</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {items.map((item) => (
          <div key={item} className="rounded-md border bg-white px-4 py-3 text-sm text-slate-700">
            {item}
          </div>
        ))}
      </div>
    </section>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  options
}: {
  label: string;
  name: string;
  defaultValue: string;
  options: Array<{ label: string; value: string }>;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <select name={name} defaultValue={defaultValue} className="h-11 w-full rounded-md border bg-white px-3 text-sm">
        {options.map((option) => (
          <option key={`${name}-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
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
