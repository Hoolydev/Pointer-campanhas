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

const hauzappSchema = z.object({
  apiKey: z.string().optional(),
  prospectionStageId: z.coerce.number().int().min(0).default(0),
  qualifiedStageId: z.coerce.number().int().min(0).default(3),
  leadAgentId: z.string().uuid().optional().or(z.literal("")),
  autoGreetProspects: z.coerce.boolean().default(false)
});

const uazapiSchema = z.object({
  baseUrl: z.string().url("Informe a URL da Uazapi."),
  token: z.string().optional(),
  leadAgentId: z.string().uuid().optional().or(z.literal(""))
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

export async function saveHauzappIntegrationAction(formData: FormData) {
  const parsed = hauzappSchema.safeParse({
    apiKey: formData.get("apiKey") || undefined,
    prospectionStageId: formData.get("prospectionStageId") || 0,
    qualifiedStageId: formData.get("qualifiedStageId") || 3,
    leadAgentId: formData.get("leadAgentId") || "",
    autoGreetProspects: formData.get("autoGreetProspects") === "on"
  });

  if (!parsed.success) {
    return;
  }

  await saveNativeIntegration({
    provider: "hauzapp",
    name: "HauzApp CRM",
    formConfig: {
      apiKey: parsed.data.apiKey,
      prospectionStageId: parsed.data.prospectionStageId,
      qualifiedStageId: parsed.data.qualifiedStageId,
      leadAgentId: parsed.data.leadAgentId || null,
      autoGreetProspects: parsed.data.autoGreetProspects
    },
    secretKeys: ["apiKey"]
  });
}

export async function saveUazapiIntegrationAction(formData: FormData) {
  const parsed = uazapiSchema.safeParse({
    baseUrl: formData.get("baseUrl"),
    token: formData.get("token") || undefined,
    leadAgentId: formData.get("leadAgentId") || ""
  });

  if (!parsed.success) {
    return;
  }

  await saveNativeIntegration({
    provider: "uazapi",
    name: "Uazapi WhatsApp",
    formConfig: {
      baseUrl: parsed.data.baseUrl,
      token: parsed.data.token,
      leadAgentId: parsed.data.leadAgentId || null
    },
    secretKeys: ["token"]
  });
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

async function saveNativeIntegration({
  provider,
  name,
  formConfig,
  secretKeys
}: {
  provider: "hauzapp" | "uazapi";
  name: string;
  formConfig: Record<string, unknown>;
  secretKeys: string[];
}) {
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile) {
    return;
  }

  const { data: existing } = await supabase
    .from("integrations")
    .select("id, config")
    .eq("organization_id", profile.organization_id)
    .eq("provider", provider)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; config: Record<string, unknown> | null }>();

  const config = {
    ...(existing?.config ?? {})
  };

  for (const [key, value] of Object.entries(formConfig)) {
    if (secretKeys.includes(key) && (!value || String(value).trim() === "")) {
      continue;
    }

    config[key] = value;
  }

  if (existing) {
    await supabase
      .from("integrations")
      .update({ name, config, active: true })
      .eq("id", existing.id)
      .eq("organization_id", profile.organization_id);
  } else {
    await supabase.from("integrations").insert({
      organization_id: profile.organization_id,
      provider,
      name,
      config,
      active: true
    });
  }

  revalidatePath("/settings/integrations");
}
