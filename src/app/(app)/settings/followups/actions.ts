"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  type: z.enum(["lead", "broker"]),
  name: z.string().min(2),
  delay_minutes: z.coerce.number().int().min(1),
  message_template: z.string().min(3)
});

export async function createFollowupRuleAction(formData: FormData) {
  const parsed = schema.safeParse({
    type: formData.get("type"),
    name: formData.get("name"),
    delay_minutes: formData.get("delay_minutes"),
    message_template: formData.get("message_template")
  });

  if (!parsed.success) {
    return;
  }

  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile) {
    return;
  }

  await supabase.from("followup_rules").insert({
    organization_id: profile.organization_id,
    ...parsed.data,
    active: true
  });

  revalidatePath("/settings/followups");
}
