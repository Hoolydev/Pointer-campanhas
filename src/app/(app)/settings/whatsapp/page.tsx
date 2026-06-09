import { Badge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import { getMetaPhoneStatus } from "@/services/meta/account";
import {
  deleteWhatsappInstanceAction,
  registerMetaEnvInstanceAction,
  saveWhatsappInstanceAction,
  toggleWhatsappInstanceAction
} from "./actions";

type WhatsappInstance = {
  id: string;
  provider: "meta" | "uazapi";
  name: string;
  phone: string | null;
  status: string;
  active: boolean;
  send_order: number;
  min_delay_seconds: number;
  max_delay_seconds: number;
  daily_limit: number;
  sent_today: number;
  last_sent_at: string | null;
  base_url: string | null;
  token: string | null;
  instance_key: string | null;
  meta_phone_number_id: string | null;
  meta_business_account_id: string | null;
};

export default async function WhatsappSettingsPage() {
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);
  const [{ data: instances }, metaPhone] = profile
    ? await Promise.all([
        supabase
          .from("whatsapp_instances")
          .select("id, provider, name, phone, status, active, send_order, min_delay_seconds, max_delay_seconds, daily_limit, sent_today, last_sent_at, base_url, token, instance_key, meta_phone_number_id, meta_business_account_id")
          .eq("organization_id", profile.organization_id)
          .order("provider", { ascending: true })
          .order("send_order", { ascending: true })
          .returns<WhatsappInstance[]>(),
        getMetaPhoneStatus()
      ])
    : [{ data: [] }, { data: null, error: null }];
  const uazapiInstances = (instances ?? []).filter((instance) => instance.provider === "uazapi");
  const metaInstances = (instances ?? []).filter((instance) => instance.provider === "meta");
  const activeUazapiCount = uazapiInstances.filter((instance) => instance.active).length;

  return (
    <>
      <PageHeader
        title="WhatsApp"
        description="Configure os numeros oficiais da Meta e ate 5 instancias Uazapi para rodizio humanizado."
      />

      <section className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="space-y-6">
          <section className="rounded-lg border bg-card p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Meta Cloud API</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Usada para campanhas oficiais com template aprovado e webhooks da Meta.
                </p>
              </div>
              <form action={registerMetaEnvInstanceAction}>
                <button className="h-10 rounded-md border bg-white px-4 text-sm font-semibold">
                  Registrar Meta atual
                </button>
              </form>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <StatusTile label="Numero" value={metaPhone.data?.displayPhoneNumber || "Nao conectado"} />
              <StatusTile label="Nome verificado" value={metaPhone.data?.verifiedName || "Nao retornado"} />
              <StatusTile label="Qualidade" value={metaPhone.data?.qualityRating || "Nao informada"} />
            </div>

            {metaPhone.error ? (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {metaPhone.error}
              </p>
            ) : null}
          </section>

          <section className="rounded-lg border bg-card p-5 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Instancias Uazapi</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  O n8n alterna os disparos entre as instancias ativas respeitando delay e limite diario.
                </p>
              </div>
              <Badge tone={activeUazapiCount <= 5 ? "success" : "danger"}>
                {activeUazapiCount}/5 ativas
              </Badge>
            </div>

            <div className="mt-5 overflow-hidden rounded-md border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Nome</th>
                    <th className="px-4 py-3">Telefone</th>
                    <th className="px-4 py-3">Delay</th>
                    <th className="px-4 py-3">Limite</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {uazapiInstances.map((instance) => (
                    <tr key={instance.id}>
                      <td className="px-4 py-3 font-medium text-slate-950">{instance.name}</td>
                      <td className="px-4 py-3 text-slate-700">{instance.phone || "Nao informado"}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {instance.min_delay_seconds}s - {instance.max_delay_seconds}s
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {instance.sent_today}/{instance.daily_limit}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={instance.active ? "success" : "muted"}>
                          {instance.active ? "Ativa" : "Pausada"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <form action={toggleWhatsappInstanceAction}>
                            <input type="hidden" name="id" value={instance.id} />
                            <input type="hidden" name="active" value={String(instance.active)} />
                            <button className="rounded-md border px-3 py-1.5 text-xs font-semibold">
                              {instance.active ? "Pausar" : "Ativar"}
                            </button>
                          </form>
                          <form action={deleteWhatsappInstanceAction}>
                            <input type="hidden" name="id" value={instance.id} />
                            <button className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700">
                              Excluir
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {uazapiInstances.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        Nenhuma instancia Uazapi cadastrada.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border bg-card p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">Meta registrada no sistema</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {metaInstances.map((instance) => (
                <div key={instance.id} className="rounded-md border bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-950">{instance.name}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {instance.phone || "Telefone nao informado"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Phone Number ID: {instance.meta_phone_number_id || "pendente"}
                      </p>
                    </div>
                    <Badge tone={instance.active ? "success" : "muted"}>
                      {instance.active ? "Ativa" : "Pausada"}
                    </Badge>
                  </div>
                </div>
              ))}
              {metaInstances.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Clique em “Registrar Meta atual” para salvar a conexao carregada nas variaveis do servidor.
                </p>
              ) : null}
            </div>
          </section>
        </div>

        <section className="rounded-lg border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Nova instancia Uazapi</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cadastre cada numero que podera participar do rodizio.
          </p>
          <form action={saveWhatsappInstanceAction} className="mt-5 space-y-4">
            <input type="hidden" name="provider" value="uazapi" />
            <Field name="name" label="Nome interno" placeholder="Uazapi 01 - SDR" />
            <Field name="phone" label="Numero conectado" placeholder="5562999999999" />
            <Field name="baseUrl" label="URL da Uazapi" placeholder="https://sua-uazapi.com" />
            <Field name="token" label="Token" placeholder="Cole o token da instancia" type="password" />
            <Field name="instanceKey" label="Chave/ID da instancia" placeholder="Opcional" required={false} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field name="minDelaySeconds" label="Delay minimo" placeholder="90" type="number" defaultValue="90" />
              <Field name="maxDelaySeconds" label="Delay maximo" placeholder="240" type="number" defaultValue="240" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field name="dailyLimit" label="Limite diario" placeholder="500" type="number" defaultValue="500" />
              <Field name="sendOrder" label="Ordem no rodizio" placeholder="0" type="number" defaultValue="0" />
            </div>
            <label className="flex items-center gap-3 rounded-md border bg-white px-3 py-3 text-sm">
              <input name="active" type="checkbox" defaultChecked className="h-4 w-4" />
              Ativar no rodizio
            </label>
            <button
              disabled={activeUazapiCount >= 5}
              className="h-10 w-full rounded-md bg-primary text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              {activeUazapiCount >= 5 ? "Limite de 5 instancias atingido" : "Salvar instancia"}
            </button>
          </form>
        </section>
      </section>
    </>
  );
}

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-white p-3">
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function Field({
  name,
  label,
  placeholder,
  type = "text",
  defaultValue,
  required = true
}: {
  name: string;
  label: string;
  placeholder: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        className="h-10 w-full rounded-md border bg-white px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
      />
    </label>
  );
}
