import { Badge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import {
  enqueueHauzappProspectionSyncAction,
  saveHauzappIntegrationAction,
  saveUazapiIntegrationAction
} from "./actions";

type IntegrationRow = {
  id: string;
  provider: string;
  name: string;
  config: Record<string, unknown> | null;
  active: boolean;
  created_at: string;
};

type AgentRow = {
  id: string;
  name: string;
  agent_type: string;
  active: boolean;
};

export default async function IntegrationsPage() {
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);
  const [{ data: integrations }, { data: agents }] = profile
    ? await Promise.all([
        supabase
          .from("integrations")
          .select("id, provider, name, config, active, created_at")
          .eq("organization_id", profile.organization_id)
          .order("created_at", { ascending: false })
          .returns<IntegrationRow[]>(),
        supabase
          .from("ai_agents")
          .select("id, name, agent_type, active")
          .eq("organization_id", profile.organization_id)
          .eq("active", true)
          .order("created_at", { ascending: false })
          .returns<AgentRow[]>()
      ])
    : [{ data: [] }, { data: [] }];
  const hauzapp = getLatestIntegration(integrations ?? [], "hauzapp");
  const uazapi = getLatestIntegration(integrations ?? [], "uazapi");
  const leadAgents = (agents ?? []).filter((agent) => agent.agent_type === "lead_meta");

  return (
    <>
      <PageHeader
        title="Integrações"
        description="Conecte HauzApp e Uazapi sem mexer em JSON ou variáveis técnicas."
      />

      <section className="grid gap-6 xl:grid-cols-2">
        <form action={saveHauzappIntegrationAction} className="space-y-5 rounded-lg border bg-card p-6 shadow-sm">
          <IntegrationTitle
            title="HauzApp CRM"
            description="Busca leads em Prospecção e envia qualificados para a etapa correta."
            active={Boolean(hauzapp?.active)}
          />

          <Field
            name="apiKey"
            label="Chave de integração HauzApp"
            type="password"
            placeholder={hauzapp?.config?.apiKey ? "Chave salva. Preencha apenas para trocar." : "Cole a chave HauzApp"}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              name="prospectionStageId"
              label="Etapa Lead Novo"
              type="number"
              defaultValue={String(configNumber(hauzapp?.config, "prospectionStageId", 0))}
            />
            <Field
              name="qualifiedStageId"
              label="Etapa corretor/qualificado"
              type="number"
              defaultValue={String(configNumber(hauzapp?.config, "qualifiedStageId", 3))}
            />
          </div>

          <AgentSelect
            agents={leadAgents}
            name="leadAgentId"
            label="Agente que atende leads HauzApp"
            selected={configString(hauzapp?.config, "leadAgentId")}
          />

          <label className="flex items-center gap-3 rounded-md border bg-white px-3 py-3 text-sm">
            <input
              name="autoGreetProspects"
              type="checkbox"
              defaultChecked={configBoolean(hauzapp?.config, "autoGreetProspects", false)}
              className="h-4 w-4"
            />
            Enviar primeira mensagem pela Uazapi ao sincronizar Prospecção
          </label>

          <button className="h-10 w-full rounded-md bg-primary text-sm font-semibold text-primary-foreground">
            Salvar HauzApp
          </button>
        </form>

        <form action={saveUazapiIntegrationAction} className="space-y-5 rounded-lg border bg-card p-6 shadow-sm">
          <IntegrationTitle
            title="Uazapi WhatsApp"
            description="Atende leads vindos do HauzApp e cobra corretores/admin pelo WhatsApp."
            active={Boolean(uazapi?.active)}
          />

          <Field
            name="baseUrl"
            label="URL da Uazapi"
            placeholder="https://sua-uazapi.com"
            defaultValue={configString(uazapi?.config, "baseUrl")}
          />
          <Field
            name="token"
            label="Token da Uazapi"
            type="password"
            placeholder={uazapi?.config?.token ? "Token salvo. Preencha apenas para trocar." : "Cole o token da Uazapi"}
          />

          <AgentSelect
            agents={leadAgents}
            name="leadAgentId"
            label="Agente que responde pela Uazapi"
            selected={configString(uazapi?.config, "leadAgentId")}
          />

          <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            Webhook para configurar na Uazapi:
            <div className="mt-2 rounded-md bg-white px-3 py-2 font-mono text-xs text-slate-700">
              https://pointer-campanhas.vercel.app/api/webhooks/uazapi
            </div>
          </div>

          <button className="h-10 w-full rounded-md bg-primary text-sm font-semibold text-primary-foreground">
            Salvar Uazapi
          </button>
        </form>
      </section>

      <section className="mt-6 rounded-lg border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Sincronização de Prospecção</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Importa negócios em Prospecção do HauzApp para o CRM e prepara atendimento por IA.
            </p>
          </div>
          <form action={enqueueHauzappProspectionSyncAction}>
            <button className="h-10 rounded-md border bg-white px-4 text-sm font-semibold">
              Sincronizar agora
            </button>
          </form>
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-lg border bg-card shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Integração</th>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(integrations ?? []).map((integration) => (
              <tr key={integration.id}>
                <td className="px-4 py-3 font-medium">{integration.name}</td>
                <td className="px-4 py-3">{integration.provider}</td>
                <td className="px-4 py-3">
                  <Badge tone={integration.active ? "success" : "muted"}>
                    {integration.active ? "Ativa" : "Inativa"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function IntegrationTitle({
  title,
  description,
  active
}: {
  title: string;
  description: string;
  active: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <Badge tone={active ? "success" : "muted"}>{active ? "Conectada" : "Pendente"}</Badge>
    </div>
  );
}

function Field({
  name,
  label,
  type = "text",
  placeholder,
  defaultValue
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string | null;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue ?? undefined}
        className="h-10 w-full rounded-md border bg-white px-3 text-sm"
      />
    </label>
  );
}

function AgentSelect({
  agents,
  name,
  label,
  selected
}: {
  agents: AgentRow[];
  name: string;
  label: string;
  selected?: string | null;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <select
        name={name}
        defaultValue={selected ?? ""}
        className="h-10 w-full rounded-md border bg-white px-3 text-sm"
      >
        <option value="">Usar agente ativo mais recente</option>
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function getLatestIntegration(integrations: IntegrationRow[], provider: string) {
  return integrations.find((integration) => integration.provider === provider && integration.active);
}

function configString(config: Record<string, unknown> | null | undefined, key: string) {
  const value = config?.[key];
  return typeof value === "string" ? value : "";
}

function configNumber(config: Record<string, unknown> | null | undefined, key: string, fallback: number) {
  const value = Number(config?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

function configBoolean(config: Record<string, unknown> | null | undefined, key: string, fallback: boolean) {
  const value = config?.[key];

  if (typeof value === "boolean") {
    return value;
  }

  return fallback;
}
