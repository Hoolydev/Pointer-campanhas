import { Bell } from "lucide-react";
import { Badge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import { createReminderAction } from "./actions";

type LeadOption = {
  id: string;
  name: string | null;
  phone: string;
};

type Reminder = {
  id: string;
  title: string;
  message: string;
  remind_at: string;
  status: string;
  leads: {
    name: string | null;
    phone: string;
  } | null;
};

export default async function RemindersPage() {
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile) {
    return (
      <>
        <PageHeader title="Lembretes" description="Cobrancas internas vinculadas a leads." />
        <section className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          Crie um perfil para usar lembretes.
        </section>
      </>
    );
  }

  const [{ data: leads }, { data: reminders }] = await Promise.all([
    supabase
      .from("leads")
      .select("id, name, phone")
      .eq("organization_id", profile.organization_id)
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<LeadOption[]>(),
    supabase
      .from("reminders")
      .select("id, title, message, remind_at, status, leads(name, phone)")
      .eq("organization_id", profile.organization_id)
      .order("remind_at", { ascending: false })
      .limit(50)
      .returns<Reminder[]>()
  ]);

  return (
    <>
      <PageHeader title="Lembretes" description="Crie cobrancas futuras para leads e atendimentos." />
      <section className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <form action={createReminderAction} className="rounded-lg border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-teal-700" />
            <h2 className="text-sm font-semibold text-slate-950">Novo lembrete</h2>
          </div>
          <div className="mt-5 space-y-4">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Lead</span>
              <select name="lead_id" className="mt-1 h-10 w-full rounded-md border bg-white px-3 text-sm">
                <option value="">Sem lead especifico</option>
                {leads?.map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {lead.name || lead.phone}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Titulo</span>
              <input name="title" placeholder="Cobrar Daivid" className="mt-1 h-10 w-full rounded-md border bg-white px-3 text-sm" />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Mensagem</span>
              <textarea name="message" rows={4} placeholder="Me lembre de cobrar o cliente Daivid sobre a proposta." className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Quando</span>
              <input name="remind_at" type="datetime-local" className="mt-1 h-10 w-full rounded-md border bg-white px-3 text-sm" />
            </label>
            <button className="h-10 w-full rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground">
              Criar lembrete
            </button>
          </div>
        </form>

        <section className="rounded-lg border bg-card shadow-sm">
          <div className="border-b px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-950">Lembretes recentes</h2>
          </div>
          <div className="divide-y">
            {reminders?.length ? (
              reminders.map((reminder) => (
                <div key={reminder.id} className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-slate-950">{reminder.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{reminder.message}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Lead: {reminder.leads?.name || reminder.leads?.phone || "sem lead"}
                      </p>
                    </div>
                    <Badge tone={reminder.status === "sent" ? "success" : "muted"}>{reminder.status}</Badge>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(reminder.remind_at))}
                  </p>
                </div>
              ))
            ) : (
              <p className="p-5 text-sm text-muted-foreground">Nenhum lembrete criado ainda.</p>
            )}
          </div>
        </section>
      </section>
    </>
  );
}
