import { Badge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";

type Appointment = {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  google_event_id: string | null;
  contacts: {
    name: string | null;
    phone: string;
  } | null;
  leads: {
    name: string | null;
    stage: string;
  } | null;
};

export default async function AppointmentsPage() {
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);
  const { data: appointments } = profile
    ? await supabase
        .from("appointments")
        .select("id, title, description, starts_at, ends_at, status, google_event_id, contacts(name, phone), leads(name, stage)")
        .eq("organization_id", profile.organization_id)
        .order("starts_at", { ascending: true })
        .limit(100)
        .returns<Appointment[]>()
    : { data: [] };

  return (
    <>
      <PageHeader
        title="Agenda"
        description="Visitas ao decorado detectadas e preparadas pelo agente de IA."
      />
      <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Visita</th>
              <th className="px-4 py-3">Lead</th>
              <th className="px-4 py-3">Horario</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {appointments?.length ? (
              appointments.map((appointment) => (
                <tr key={appointment.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-950">{appointment.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {appointment.description || "Sem observacoes"}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-950">
                      {appointment.contacts?.name || appointment.leads?.name || "Lead"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {appointment.contacts?.phone}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {new Intl.DateTimeFormat("pt-BR", {
                      dateStyle: "short",
                      timeStyle: "short"
                    }).format(new Date(appointment.starts_at))}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={appointment.status === "confirmed" ? "success" : "muted"}>
                      {appointment.status}
                    </Badge>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  Nenhuma visita preparada ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
