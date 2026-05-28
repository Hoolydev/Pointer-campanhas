"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import { publishJobProcessor } from "@/services/qstash/jobs";
import { syncHauzappProspectionLeads } from "@/services/hauzapp/prospection-sync";

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

export async function enqueueHauzappProspectionSyncAction() {
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile) {
    return;
  }

  const runAt = new Date().toISOString();
  const { data: job } = await supabase
    .from("scheduled_jobs")
    .insert({
      organization_id: profile.organization_id,
      job_type: "hauzapp_sync_prospection",
      target_id: null,
      status: "pending",
      run_at: runAt,
      payload: { reason: "manual_frontend_sync" }
    })
    .select("id")
    .single<{ id: string }>();

  try {
    const result = await syncHauzappProspectionLeads({
      supabase,
      organizationId: profile.organization_id
    });
    await supabase
      .from("scheduled_jobs")
      .update({
        status: "done",
        executed_at: new Date().toISOString(),
        payload: { reason: "manual_frontend_sync", result }
      })
      .eq("id", job?.id ?? "");
  } catch (error) {
    await supabase
      .from("scheduled_jobs")
      .update({
        status: "failed",
        executed_at: new Date().toISOString(),
        payload: {
          reason: "manual_frontend_sync",
          error: error instanceof Error ? error.message : "Erro desconhecido"
        }
      })
      .eq("id", job?.id ?? "");

    await publishJobProcessor({
      runAt,
      reason: "hauzapp_sync_prospection_retry"
    }).catch(() => null);
  }

  revalidatePath("/settings/integrations");
  revalidatePath("/crm");
  revalidatePath("/inbox");
}
