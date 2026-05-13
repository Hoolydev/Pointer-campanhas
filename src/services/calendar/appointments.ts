import type { SupabaseClient } from "@supabase/supabase-js";

type Availability = Record<string, Array<{ start: string; end: string }>>;

const weekdays = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
] as const;

export function getAvailableWindows({
  start,
  days = 7,
  durationMinutes = 30,
  granularityMinutes = 30,
  availability
}: {
  start?: Date;
  days?: number;
  durationMinutes?: number;
  granularityMinutes?: number;
  availability: Availability;
}) {
  const base = start ?? new Date();
  const windows: Array<{ startsAt: string; endsAt: string }> = [];

  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    const day = new Date(base);
    day.setDate(base.getDate() + dayOffset);
    const periods = availability[weekdays[day.getDay()]] ?? [];

    for (const period of periods) {
      const cursor = applyTime(day, period.start);
      const periodEnd = applyTime(day, period.end);

      while (cursor.getTime() + durationMinutes * 60_000 <= periodEnd.getTime()) {
        const end = new Date(cursor.getTime() + durationMinutes * 60_000);

        if (cursor.getTime() > Date.now()) {
          windows.push({
            startsAt: cursor.toISOString(),
            endsAt: end.toISOString()
          });
        }

        cursor.setMinutes(cursor.getMinutes() + granularityMinutes);
      }
    }
  }

  return windows.slice(0, 6);
}

export async function createVisitAppointment({
  supabase,
  organizationId,
  leadId,
  conversationId,
  contactId,
  agentId,
  title,
  description,
  startsAt,
  durationMinutes
}: {
  supabase: SupabaseClient;
  organizationId: string;
  leadId?: string | null;
  conversationId: string;
  contactId: string;
  agentId?: string | null;
  title: string;
  description?: string | null;
  startsAt: string;
  durationMinutes: number;
}) {
  const starts = new Date(startsAt);
  const ends = new Date(starts.getTime() + durationMinutes * 60_000);

  const { data: appointment, error } = await supabase
    .from("appointments")
    .insert({
      organization_id: organizationId,
      lead_id: leadId ?? null,
      conversation_id: conversationId,
      contact_id: contactId,
      agent_id: agentId ?? null,
      title,
      description,
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      status: process.env.GOOGLE_CALENDAR_CLIENT_EMAIL ? "pending_google" : "pending",
      payload: {
        googleCalendarId: process.env.GOOGLE_CALENDAR_ID ?? null
      }
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !appointment) {
    throw new Error(error?.message || "Nao foi possivel criar agendamento.");
  }

  return appointment;
}

function applyTime(day: Date, time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const date = new Date(day);
  date.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  return date;
}
