"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import { getMetaPhoneStatus } from "@/services/meta/account";

const whatsappInstanceSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  provider: z.enum(["meta", "uazapi"]),
  name: z.string().min(2, "Informe o nome da conexao."),
  phone: z.string().optional(),
  baseUrl: z.string().url("Informe a URL da Uazapi.").optional().or(z.literal("")),
  token: z.string().optional(),
  instanceKey: z.string().optional(),
  metaPhoneNumberId: z.string().optional(),
  metaBusinessAccountId: z.string().optional(),
  metaAccessToken: z.string().optional(),
  sendOrder: z.coerce.number().int().min(0).default(0),
  minDelaySeconds: z.coerce.number().int().min(10).max(7200).default(90),
  maxDelaySeconds: z.coerce.number().int().min(10).max(7200).default(240),
  hourlyLimit: z.coerce.number().int().min(1).max(20).default(20),
  dailyLimit: z.coerce.number().int().min(1).max(10000).default(500),
  active: z.coerce.boolean().default(true)
});

export async function saveWhatsappInstanceAction(formData: FormData) {
  const parsed = whatsappInstanceSchema.safeParse({
    id: formData.get("id") || "",
    provider: formData.get("provider"),
    name: formData.get("name"),
    phone: formData.get("phone") || "",
    baseUrl: formData.get("baseUrl") || "",
    token: formData.get("token") || "",
    instanceKey: formData.get("instanceKey") || "",
    metaPhoneNumberId: formData.get("metaPhoneNumberId") || "",
    metaBusinessAccountId: formData.get("metaBusinessAccountId") || "",
    metaAccessToken: formData.get("metaAccessToken") || "",
    sendOrder: formData.get("sendOrder") || 0,
    minDelaySeconds: formData.get("minDelaySeconds") || 90,
    maxDelaySeconds: formData.get("maxDelaySeconds") || 240,
    hourlyLimit: formData.get("hourlyLimit") || 20,
    dailyLimit: formData.get("dailyLimit") || 500,
    active: formData.get("active") === "on"
  });

  if (!parsed.success) {
    return;
  }

  if (parsed.data.maxDelaySeconds < parsed.data.minDelaySeconds) {
    return;
  }

  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile) {
    return;
  }

  if (parsed.data.provider === "uazapi" && parsed.data.active) {
    const query = supabase
      .from("whatsapp_instances")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", profile.organization_id)
      .eq("provider", "uazapi")
      .eq("active", true);

    if (parsed.data.id) {
      query.neq("id", parsed.data.id);
    }

    const { count } = await query;

    if ((count ?? 0) >= 20) {
      return;
    }
  }

  const existing = parsed.data.id
    ? await supabase
        .from("whatsapp_instances")
        .select("token, meta_access_token")
        .eq("id", parsed.data.id)
        .eq("organization_id", profile.organization_id)
        .maybeSingle<{ token: string | null; meta_access_token: string | null }>()
    : { data: null };

  const values = {
    organization_id: profile.organization_id,
    provider: parsed.data.provider,
    name: parsed.data.name,
    phone: parsed.data.phone?.replace(/\D/g, "") || null,
    base_url: parsed.data.baseUrl || null,
    token: parsed.data.token?.trim() || existing.data?.token || null,
    instance_key: parsed.data.instanceKey?.trim() || null,
    meta_phone_number_id: parsed.data.metaPhoneNumberId?.trim() || null,
    meta_business_account_id: parsed.data.metaBusinessAccountId?.trim() || null,
    meta_access_token: parsed.data.metaAccessToken?.trim() || existing.data?.meta_access_token || null,
    active: parsed.data.active,
    send_order: parsed.data.sendOrder,
    min_delay_seconds: parsed.data.minDelaySeconds,
    max_delay_seconds: parsed.data.maxDelaySeconds,
    hourly_limit: parsed.data.hourlyLimit,
    daily_limit: parsed.data.dailyLimit,
    status: parsed.data.active ? "connected" : "paused",
    updated_at: new Date().toISOString()
  };

  if (parsed.data.id) {
    await supabase
      .from("whatsapp_instances")
      .update(values)
      .eq("id", parsed.data.id)
      .eq("organization_id", profile.organization_id);
  } else {
    await supabase.from("whatsapp_instances").insert(values);
  }

  revalidatePath("/settings/whatsapp");
  revalidatePath("/settings/integrations");
}

export async function toggleWhatsappInstanceAction(formData: FormData) {
  const id = String(formData.get("id") || "");
  const active = String(formData.get("active") || "") === "true";

  if (!id) return;

  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile) return;

  await supabase
    .from("whatsapp_instances")
    .update({ active: !active, status: !active ? "connected" : "paused", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", profile.organization_id);

  revalidatePath("/settings/whatsapp");
}

export async function deleteWhatsappInstanceAction(formData: FormData) {
  const id = String(formData.get("id") || "");

  if (!id) return;

  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile) return;

  await supabase
    .from("whatsapp_instances")
    .delete()
    .eq("id", id)
    .eq("organization_id", profile.organization_id);

  revalidatePath("/settings/whatsapp");
}

export async function registerMetaEnvInstanceAction() {
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile) return;

  const metaPhone = await getMetaPhoneStatus();
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;

  if (!phoneNumberId) return;

  const { data: existing } = await supabase
    .from("whatsapp_instances")
    .select("id")
    .eq("organization_id", profile.organization_id)
    .eq("provider", "meta")
    .eq("meta_phone_number_id", phoneNumberId)
    .maybeSingle<{ id: string }>();

  const values = {
    organization_id: profile.organization_id,
    provider: "meta",
    name: metaPhone.data?.verifiedName || "Meta Cloud API",
    phone: metaPhone.data?.displayPhoneNumber?.replace(/\D/g, "") || null,
    status: metaPhone.data ? "connected" : "pending",
    active: true,
    meta_phone_number_id: phoneNumberId,
    meta_business_account_id: process.env.META_BUSINESS_ACCOUNT_ID || null,
    meta_access_token: process.env.META_ACCESS_TOKEN || null,
    min_delay_seconds: 90,
    max_delay_seconds: 240,
    hourly_limit: 20,
    daily_limit: 1000,
    updated_at: new Date().toISOString()
  };

  if (existing) {
    await supabase
      .from("whatsapp_instances")
      .update(values)
      .eq("id", existing.id)
      .eq("organization_id", profile.organization_id);
  } else {
    await supabase.from("whatsapp_instances").insert(values);
  }

  revalidatePath("/settings/whatsapp");
}
