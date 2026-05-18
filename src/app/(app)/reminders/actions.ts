"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/organization";
import { publishJobProcessor } from "@/services/qstash/jobs";
import { createClient } from "@/lib/supabase/server";

const reminderSchema = z.object({
  lead_id: z.string().uuid().optional().or(z.literal("")),
  title: z.string().min(3).max(160),
  message: z.string().min(3).max(1000),
  remind_at: z.string().min(1)
});

export async function createReminderAction(formData: FormData) {
  const parsed = reminderSchema.safeParse({
    lead_id: formData.get("lead_id") || "",
    title: formData.get("title"),
    message: formData.get("message"),
    remind_at: formData.get("remind_at")
  });

  if (!parsed.success) {
    return;
  }

  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile) {
    return;
  }

  const remindAt = new Date(parsed.data.remind_at);

  if (Number.isNaN(remindAt.getTime())) {
    return;
  }

  const { data: reminder } = await supabase
    .from("reminders")
    .insert({
      organization_id: profile.organization_id,
      lead_id: parsed.data.lead_id || null,
      created_by: profile.id,
      title: parsed.data.title,
      message: parsed.data.message,
      remind_at: remindAt.toISOString()
    })
    .select("id")
    .single<{ id: string }>();

  if (!reminder) {
    return;
  }

  await supabase.from("scheduled_jobs").insert({
    organization_id: profile.organization_id,
    job_type: "manual_reminder",
    target_id: reminder.id,
    status: "pending",
    run_at: remindAt.toISOString(),
    payload: { reminderId: reminder.id }
  });

  await publishJobProcessor({ runAt: remindAt.toISOString(), reason: "manual_reminder" }).catch(() => null);

  revalidatePath("/reminders");
}
