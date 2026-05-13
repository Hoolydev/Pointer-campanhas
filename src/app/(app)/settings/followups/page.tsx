import { Badge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import { createFollowupRuleAction } from "./actions";

type RuleRow = {
  id: string;
  type: string;
  name: string;
  delay_minutes: number;
  message_template: string;
  active: boolean;
};

export default async function FollowupsPage() {
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);
  const { data: rules } = profile
    ? await supabase
        .from("followup_rules")
        .select("id, type, name, delay_minutes, message_template, active")
        .eq("organization_id", profile.organization_id)
        .order("delay_minutes", { ascending: true })
        .returns<RuleRow[]>()
    : { data: [] };

  return (
    <>
      <PageHeader title="Follow-ups" description="Regras de retorno para leads e corretores." />
      <section className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <form action={createFollowupRuleAction} className="space-y-4 rounded-lg border bg-card p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Nova regra</h2>
          <select name="type" className="h-10 w-full rounded-md border bg-white px-3 text-sm">
            <option value="lead">Lead</option>
            <option value="broker">Corretor</option>
          </select>
          <input
            name="name"
            required
            placeholder="Follow-up 1"
            className="h-10 w-full rounded-md border bg-white px-3 text-sm"
          />
          <input
            name="delay_minutes"
            type="number"
            min="1"
            required
            placeholder="120"
            className="h-10 w-full rounded-md border bg-white px-3 text-sm"
          />
          <textarea
            name="message_template"
            rows={5}
            required
            placeholder="Ola, {{lead_name}}..."
            className="w-full rounded-md border bg-white px-3 py-2 text-sm"
          />
          <button className="h-10 w-full rounded-md bg-primary text-sm font-semibold text-primary-foreground">
            Criar regra
          </button>
        </form>

        <section className="space-y-3">
          {rules?.map((rule) => (
            <article key={rule.id} className="rounded-lg border bg-card p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-slate-950">{rule.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {rule.delay_minutes} minuto(s) • {rule.type}
                  </p>
                </div>
                <Badge tone={rule.active ? "success" : "muted"}>
                  {rule.active ? "Ativa" : "Inativa"}
                </Badge>
              </div>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">{rule.message_template}</p>
            </article>
          ))}
        </section>
      </section>
    </>
  );
}
