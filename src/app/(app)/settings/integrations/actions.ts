"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  provider: z.enum(["meta", "uazapi", "houseup", "hauzapp", "canal_pro", "openai"]),
  name: z.string().min(2),
  config: z.string().default("{}")
});

export async function saveIntegrationAction(formData: FormData) {
  const parsed = schema.safeParse({
    provider: formData.get("provider"),
    name: formData.get("name"),
    config: formData.get("config") || "{}"
  });

  if (!parsed.success) {
    return;
  }

  let config: Record<string, unknown>;

  try {
    config = JSON.parse(parsed.data.config) as Record<string, unknown>;
  } catch {
    config = {};
  }

  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile) {
    return;
  }

  await supabase.from("integrations").insert({
    organization_id: profile.organization_id,
    provider: parsed.data.provider,
    name: parsed.data.name,
    config,
    active: true
  });

  revalidatePath("/settings/integrations");
}
