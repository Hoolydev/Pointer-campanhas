import { Badge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import { saveIntegrationAction } from "./actions";

type IntegrationRow = {
  id: string;
  provider: string;
  name: string;
  active: boolean;
  created_at: string;
};

export default async function IntegrationsPage() {
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);
  const { data: integrations } = profile
    ? await supabase
        .from("integrations")
        .select("id, provider, name, active, created_at")
        .eq("organization_id", profile.organization_id)
        .order("created_at", { ascending: false })
        .returns<IntegrationRow[]>()
    : { data: [] };

  return (
    <>
      <PageHeader title="Integracoes" description="Meta WhatsApp, OpenAI, Uazapi, HauzApp, HouseUp e Canal Pro." />
      <section className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <form action={saveIntegrationAction} className="space-y-4 rounded-lg border bg-card p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Nova integracao</h2>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Provider</span>
            <select name="provider" className="h-10 w-full rounded-md border bg-white px-3 text-sm">
              <option value="meta">Meta</option>
              <option value="uazapi">Uazapi</option>
              <option value="houseup">HouseUp</option>
              <option value="hauzapp">HauzApp</option>
              <option value="canal_pro">Canal Pro</option>
              <option value="openai">OpenAI</option>
            </select>
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Nome</span>
            <input name="name" required className="h-10 w-full rounded-md border bg-white px-3 text-sm" />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Config JSON</span>
            <textarea
              name="config"
              rows={6}
              defaultValue="{}"
              className="w-full rounded-md border bg-white px-3 py-2 font-mono text-xs"
            />
          </label>
          <button className="h-10 w-full rounded-md bg-primary text-sm font-semibold text-primary-foreground">
            Salvar
          </button>
        </form>

        <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {integrations?.map((integration) => (
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
      </section>
    </>
  );
}
