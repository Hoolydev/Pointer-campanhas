import type { SupabaseClient } from "@supabase/supabase-js";

export type IntegrationConfig = Record<string, unknown>;

export async function getActiveIntegrationConfig(
  supabase: SupabaseClient,
  organizationId: string,
  provider: string
) {
  const { data } = await supabase
    .from("integrations")
    .select("config")
    .eq("organization_id", organizationId)
    .eq("provider", provider)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ config: IntegrationConfig | null }>();

  return data?.config ?? {};
}

export function configString(config: IntegrationConfig, keys: string[], fallback?: string | null) {
  for (const key of keys) {
    const value = config[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return fallback ?? null;
}

export function configNumber(config: IntegrationConfig, keys: string[], fallback: number) {
  for (const key of keys) {
    const value = config[key];
    const number = typeof value === "number" ? value : Number(value);

    if (Number.isFinite(number)) {
      return number;
    }
  }

  return fallback;
}

export function configBoolean(config: IntegrationConfig, keys: string[], fallback: boolean) {
  for (const key of keys) {
    const value = config[key];

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string" && value.trim()) {
      return ["1", "true", "yes", "sim"].includes(value.trim().toLowerCase());
    }
  }

  return fallback;
}
