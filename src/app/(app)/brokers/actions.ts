"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/organization";
import { normalizeBrazilianPhone } from "@/lib/phone";
import { syncHauzappBrokers } from "@/services/hauzapp/workflow";
import { createClient } from "@/lib/supabase/server";

const brokerSchema = z.object({
  name: z.string().min(2),
  phone: z.string().min(10),
  priority: z.coerce.number().int().min(0).max(100).default(0),
  hauzapp_corretor_id: z.string().optional()
});

export async function createBrokerAction(formData: FormData) {
  const parsed = brokerSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    priority: formData.get("priority") || 0,
    hauzapp_corretor_id: formData.get("hauzapp_corretor_id") || undefined
  });

  if (!parsed.success) {
    return;
  }

  const phone = normalizeBrazilianPhone(parsed.data.phone);

  if (!phone) {
    return;
  }

  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile) {
    return;
  }

  await supabase.from("brokers").insert({
    organization_id: profile.organization_id,
    name: parsed.data.name,
    phone,
    priority: parsed.data.priority,
    hauzapp_corretor_id: parsed.data.hauzapp_corretor_id || null,
    active: true
  });

  revalidatePath("/brokers");
}

export async function syncHauzappBrokersAction() {
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile) {
    return;
  }

  await syncHauzappBrokers(supabase, profile.organization_id);
  revalidatePath("/brokers");
}

export async function toggleBrokerAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";

  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile || !id) {
    return;
  }

  await supabase
    .from("brokers")
    .update({ active: !active })
    .eq("id", id)
    .eq("organization_id", profile.organization_id);

  revalidatePath("/brokers");
}
