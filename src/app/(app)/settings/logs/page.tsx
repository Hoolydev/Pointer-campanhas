import { Badge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";

type WebhookLog = {
  id: string;
  provider: string;
  event_type: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
};

type IntegrationLog = {
  id: string;
  provider: string;
  target_type: string;
  status: string;
  error_message: string | null;
  created_at: string;
};

type JobLog = {
  id: string;
  job_type: string;
  status: string;
  run_at: string;
  executed_at: string | null;
};

export default async function LogsPage() {
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  const [{ data: webhooks }, { data: integrations }, { data: jobs }] = profile
    ? await Promise.all([
        supabase
          .from("webhook_logs")
          .select("id, provider, event_type, status, error_message, created_at")
          .eq("organization_id", profile.organization_id)
          .order("created_at", { ascending: false })
          .limit(20)
          .returns<WebhookLog[]>(),
        supabase
          .from("integration_logs")
          .select("id, provider, target_type, status, error_message, created_at")
          .eq("organization_id", profile.organization_id)
          .order("created_at", { ascending: false })
          .limit(20)
          .returns<IntegrationLog[]>(),
        supabase
          .from("scheduled_jobs")
          .select("id, job_type, status, run_at, executed_at")
          .eq("organization_id", profile.organization_id)
          .order("run_at", { ascending: false })
          .limit(20)
          .returns<JobLog[]>()
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  return (
    <>
      <PageHeader
        title="Logs"
        description="Ultimos eventos de webhooks, integracoes e jobs agendados."
      />
      <section className="grid gap-6 xl:grid-cols-3">
        <LogCard
          title="Webhooks"
          rows={(webhooks ?? []).map((log) => ({
            id: log.id,
            title: `${log.provider} / ${log.event_type ?? "evento"}`,
            status: log.status,
            detail: log.error_message,
            date: log.created_at
          }))}
        />
        <LogCard
          title="Integracoes"
          rows={(integrations ?? []).map((log) => ({
            id: log.id,
            title: `${log.provider} / ${log.target_type}`,
            status: log.status,
            detail: log.error_message,
            date: log.created_at
          }))}
        />
        <LogCard
          title="Jobs"
          rows={(jobs ?? []).map((job) => ({
            id: job.id,
            title: job.job_type,
            status: job.status,
            detail: job.executed_at ? "Executado" : "Aguardando",
            date: job.run_at
          }))}
        />
      </section>
    </>
  );
}

function LogCard({
  title,
  rows
}: {
  title: string;
  rows: Array<{ id: string; title: string; status: string; detail: string | null; date: string }>;
}) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="border-b px-5 py-4">
        <h2 className="font-semibold text-slate-950">{title}</h2>
      </div>
      <div className="divide-y">
        {rows.length ? (
          rows.map((row) => (
            <article key={row.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium text-slate-950">{row.title}</p>
                <Badge tone={row.status === "done" || row.status === "processed" ? "success" : "muted"}>
                  {row.status}
                </Badge>
              </div>
              {row.detail ? (
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{row.detail}</p>
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground">
                {new Intl.DateTimeFormat("pt-BR", {
                  dateStyle: "short",
                  timeStyle: "short"
                }).format(new Date(row.date))}
              </p>
            </article>
          ))
        ) : (
          <p className="p-4 text-sm text-muted-foreground">Sem registros ainda.</p>
        )}
      </div>
    </section>
  );
}
