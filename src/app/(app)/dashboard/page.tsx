import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  MessageCircle,
  Megaphone,
  RefreshCcw,
  Send,
  TrendingUp,
  UserCheck,
  Users
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import { getMetaPhoneStatus, getMetaTemplates } from "@/services/meta/account";

type MetricTable =
  | "contacts"
  | "messages"
  | "leads"
  | "broker_assignments"
  | "scheduled_jobs"
  | "campaigns"
  | "ai_agents"
  | "brokers";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { profile, error } = await getCurrentProfile(supabase);

  if (!profile) {
    return (
      <>
        <PageHeader
          title="Dashboard"
          description="Acompanhe importacoes, disparos, respostas e qualificacao dos leads em tempo real."
        />
        <section className="rounded-lg border bg-card p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Perfil nao configurado</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{error}</p>
        </section>
      </>
    );
  }

  const [
    contactsImported,
    messagesSent,
    failedMessages,
    inboundMessages,
    qualifiedLeads,
    brokerSentLeads,
    brokerNoResponse,
    redistributedLeads,
    activeCampaigns,
    pendingJobs,
    activeAgents,
    activeBrokers,
    metaPhone,
    metaTemplates
  ] = await Promise.all([
    countRows(supabase, "contacts", profile.organization_id),
    countRows(supabase, "messages", profile.organization_id, {
      column: "direction",
      value: "outbound"
    }),
    countRows(supabase, "messages", profile.organization_id, {
      column: "status",
      value: "failed"
    }),
    countRows(supabase, "messages", profile.organization_id, {
      column: "direction",
      value: "inbound"
    }),
    countRows(supabase, "leads", profile.organization_id, {
      column: "stage",
      value: "qualified"
    }),
    countRows(supabase, "broker_assignments", profile.organization_id),
    countRows(supabase, "broker_assignments", profile.organization_id, {
      column: "status",
      value: "no_response"
    }),
    countRows(supabase, "broker_assignments", profile.organization_id, {
      column: "status",
      value: "redistributed"
    }),
    countRows(supabase, "campaigns", profile.organization_id, {
      column: "status",
      value: "active"
    }),
    countRows(supabase, "scheduled_jobs", profile.organization_id, {
      column: "status",
      value: "pending"
    }),
    countRows(supabase, "ai_agents", profile.organization_id, {
      column: "active",
      value: true
    }),
    countRows(supabase, "brokers", profile.organization_id, {
      column: "active",
      value: true
    }),
    getMetaPhoneStatus(),
    getMetaTemplates()
  ]);

  const responseRate =
    messagesSent > 0 ? `${Math.round((inboundMessages / messagesSent) * 100)}%` : "0%";

  const stats = [
    { label: "Contatos importados", value: String(contactsImported), icon: Users },
    { label: "Mensagens enviadas", value: String(messagesSent), icon: Send },
    { label: "Falhas", value: String(failedMessages), icon: AlertTriangle, tone: "warning" as const },
    { label: "Respostas recebidas", value: String(inboundMessages), icon: MessageCircle },
    { label: "Taxa de resposta", value: responseRate, icon: TrendingUp },
    {
      label: "Leads qualificados",
      value: String(qualifiedLeads),
      icon: CheckCircle2,
      tone: "success" as const
    },
    { label: "Enviados ao corretor", value: String(brokerSentLeads), icon: UserCheck },
    { label: "Corretores sem resposta", value: String(brokerNoResponse), icon: AlertTriangle },
    { label: "Leads redistribuidos", value: String(redistributedLeads), icon: RefreshCcw },
    { label: "Campanhas ativas", value: String(activeCampaigns), icon: Megaphone },
    { label: "Jobs pendentes", value: String(pendingJobs), icon: Clock3 },
    { label: "Agentes ativos", value: String(activeAgents), icon: Bot },
    { label: "Corretores ativos", value: String(activeBrokers), icon: UserCheck }
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Acompanhe importacoes, disparos, respostas e qualificacao dos leads em tempo real."
      />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </section>
      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Meta WhatsApp</h2>
          <div className="mt-4 space-y-2 text-sm text-muted-foreground">
            {metaPhone.data ? (
              <>
                <p className="font-medium text-slate-800">
                  {metaPhone.data.displayPhoneNumber || "Numero conectado"}
                </p>
                <p>{metaPhone.data.verifiedName || "Nome verificado nao retornado"}</p>
                <p>Qualidade: {metaPhone.data.qualityRating || "nao informada"}</p>
              </>
            ) : (
              <p className="text-red-700">{metaPhone.error}</p>
            )}
            <p>
              Templates aprovados:{" "}
              {metaTemplates.data.filter((template) => template.status === "APPROVED").length}
            </p>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Operacao</h2>
          <div className="mt-4 grid gap-3 text-sm text-muted-foreground">
            <HealthRow label="Fila de disparos" ok={pendingJobs < 100} value={`${pendingJobs} pendente(s)`} />
            <HealthRow label="Agentes IA" ok={activeAgents > 0} value={`${activeAgents} ativo(s)`} />
            <HealthRow label="Corretores" ok={activeBrokers > 0} value={`${activeBrokers} ativo(s)`} />
            <HealthRow label="Templates Meta" ok={metaTemplates.data.some((template) => template.status === "APPROVED")} value={`${metaTemplates.data.length} retornado(s)`} />
          </div>
        </div>
      </section>
    </>
  );
}

async function countRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: MetricTable,
  organizationId: string,
  filter?: { column: string; value: string | boolean }
) {
  let query = supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("organization_id", organizationId);

  if (filter) {
    query = query.eq(filter.column, filter.value);
  }

  const { count } = await query;
  return count ?? 0;
}

function HealthRow({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-slate-50 px-3 py-2">
      <span>{label}</span>
      <span className={ok ? "font-medium text-emerald-700" : "font-medium text-amber-700"}>
        {value}
      </span>
    </div>
  );
}
