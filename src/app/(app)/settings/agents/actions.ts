"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";

type AgentActionState = {
  error?: string;
  success?: string;
  agentId?: string;
};

const agentSchema = z.object({
  name: z.string().min(2),
  agent_type: z.enum(["lead_meta", "broker_uazapi"]),
  description: z.string().optional(),
  openai_model: z.enum(["gpt-5-mini", "gpt-4.1-mini"]),
  system_prompt: z.string().min(20),
  greeting_template: z.string().min(5).default("Olá, obrigado por responder. Como posso te ajudar?"),
  humanization_rules: z.string().optional(),
  forbidden_phrases: z.string().optional(),
  conversation_examples: z.string().optional(),
  agent_skills: z.string().optional(),
  qualification_criteria: z.string().optional(),
  handoff_instructions: z.string().optional(),
  broker_message_template: z.string().optional(),
  broker_followup_minutes: z.coerce.number().int().min(5).max(1440).default(30),
  message_split_enabled: z.coerce.boolean().default(true),
  appointment_enabled: z.coerce.boolean().default(true),
  typing_words_per_minute: z.coerce.number().int().min(80).max(260).default(150),
  appointment_duration_minutes: z.coerce.number().int().min(15).max(180).default(30)
});

export async function createAgentAction(
  _: AgentActionState | null,
  formData: FormData
): Promise<AgentActionState> {
  const parsed = agentSchema.safeParse({
    name: formData.get("name"),
    agent_type: formData.get("agent_type") || "lead_meta",
    description: formData.get("description") || undefined,
    openai_model: formData.get("openai_model") || "gpt-5-mini",
    system_prompt: formData.get("system_prompt"),
    greeting_template:
      formData.get("greeting_template") || "Olá, obrigado por responder. Como posso te ajudar?",
    humanization_rules: formData.get("humanization_rules") || undefined,
    forbidden_phrases: formData.get("forbidden_phrases") || undefined,
    conversation_examples: formData.get("conversation_examples") || undefined,
    agent_skills: formData.get("agent_skills") || undefined,
    qualification_criteria: formData.get("qualification_criteria") || undefined,
    handoff_instructions: formData.get("handoff_instructions") || undefined,
    broker_message_template: formData.get("broker_message_template") || undefined,
    broker_followup_minutes: formData.get("broker_followup_minutes") || 30,
    message_split_enabled: formData.get("message_split_enabled") === "on",
    appointment_enabled: formData.get("appointment_enabled") === "on",
    typing_words_per_minute: formData.get("typing_words_per_minute") || 150,
    appointment_duration_minutes: formData.get("appointment_duration_minutes") || 30
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Revise os campos do agente."
    };
  }

  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile) {
    return { error: "Perfil/organizacao nao encontrado. Faca login novamente." };
  }

  const { data: agent, error } = await supabase
    .from("ai_agents")
    .insert({
      organization_id: profile.organization_id,
      ...parsed.data,
      active: true
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !agent) {
    return { error: error?.message ?? "O Supabase nao retornou o agente criado." };
  }

  try {
    await uploadAgentMaterials({
      supabase,
      formData,
      organizationId: profile.organization_id,
      agentId: agent.id
    });
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? `Agente criado, mas o material nao foi anexado: ${error.message}`
          : "Agente criado, mas o material nao foi anexado."
    };
  }

  revalidatePath("/settings/agents");
  return { success: "Agente criado com sucesso.", agentId: agent.id };
}

export async function updateAgentAction(
  _: AgentActionState | null,
  formData: FormData
): Promise<AgentActionState> {
  const id = String(formData.get("id") ?? "");
  const parsed = agentSchema.safeParse({
    name: formData.get("name"),
    agent_type: formData.get("agent_type") || "lead_meta",
    description: formData.get("description") || undefined,
    openai_model: formData.get("openai_model") || "gpt-5-mini",
    system_prompt: formData.get("system_prompt"),
    greeting_template:
      formData.get("greeting_template") || "Olá, obrigado por responder. Como posso te ajudar?",
    humanization_rules: formData.get("humanization_rules") || undefined,
    forbidden_phrases: formData.get("forbidden_phrases") || undefined,
    conversation_examples: formData.get("conversation_examples") || undefined,
    agent_skills: formData.get("agent_skills") || undefined,
    qualification_criteria: formData.get("qualification_criteria") || undefined,
    handoff_instructions: formData.get("handoff_instructions") || undefined,
    broker_message_template: formData.get("broker_message_template") || undefined,
    broker_followup_minutes: formData.get("broker_followup_minutes") || 30,
    message_split_enabled: formData.get("message_split_enabled") === "on",
    appointment_enabled: formData.get("appointment_enabled") === "on",
    typing_words_per_minute: formData.get("typing_words_per_minute") || 150,
    appointment_duration_minutes: formData.get("appointment_duration_minutes") || 30
  });

  if (!id) {
    return { error: "Agente nao informado." };
  }

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Revise os campos do agente."
    };
  }

  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile) {
    return { error: "Perfil/organizacao nao encontrado. Faca login novamente." };
  }

  const { error } = await supabase
    .from("ai_agents")
    .update(parsed.data)
    .eq("id", id)
    .eq("organization_id", profile.organization_id);

  if (error) {
    return { error: error.message };
  }

  try {
    await uploadAgentMaterials({
      supabase,
      formData,
      organizationId: profile.organization_id,
      agentId: id
    });
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? `Agente atualizado, mas o material nao foi anexado: ${error.message}`
          : "Agente atualizado, mas o material nao foi anexado."
    };
  }

  revalidatePath("/settings/agents");
  revalidatePath(`/settings/agents/${id}/edit` as Route);
  return { success: "Agente atualizado com sucesso.", agentId: id };
}

export async function addAgentMaterialAction(formData: FormData) {
  const agentId = String(formData.get("agent_id") ?? "");
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile || !agentId) {
    return;
  }

  try {
    await uploadAgentMaterials({
      supabase,
      formData,
      organizationId: profile.organization_id,
      agentId
    });
  } catch {
    return;
  }

  revalidatePath(`/settings/agents/${agentId}/edit` as Route);
}

export async function toggleAgentMaterialAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const agentId = String(formData.get("agent_id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile || !id || !agentId) {
    return;
  }

  await supabase
    .from("agent_materials")
    .update({ active: !active })
    .eq("id", id)
    .eq("agent_id", agentId)
    .eq("organization_id", profile.organization_id);

  revalidatePath(`/settings/agents/${agentId}/edit` as Route);
}

export async function toggleAgentAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";

  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile || !id) {
    return;
  }

  await supabase
    .from("ai_agents")
    .update({ active: !active })
    .eq("id", id)
    .eq("organization_id", profile.organization_id);

  revalidatePath("/settings/agents");
}

async function uploadAgentMaterials({
  supabase,
  formData,
  organizationId,
  agentId
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  formData: FormData;
  organizationId: string;
  agentId: string;
}) {
  const title = String(formData.get("material_title") ?? "").trim();
  const description = String(formData.get("material_description") ?? "").trim();
  const mediaType = String(formData.get("material_type") ?? "document");
  const url = String(formData.get("material_url") ?? "").trim();
  const file = formData.get("material_file");

  if (url && title) {
    await supabase.from("agent_materials").insert({
      organization_id: organizationId,
      agent_id: agentId,
      title,
      description: description || null,
      media_type: "link",
      public_url: url,
      active: true
    });
  }

  if (!(file instanceof File) || file.size === 0 || !title) {
    return;
  }

  const fileType = file.type.startsWith("image/") ? "image" : "document";
  const safeName = sanitizeFileName(file.name);
  const storagePath = `${organizationId}/${agentId}/${Date.now()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from("agent-materials")
    .upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: true
    });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { data } = supabase.storage.from("agent-materials").getPublicUrl(storagePath);

  await supabase.from("agent_materials").insert({
    organization_id: organizationId,
    agent_id: agentId,
    title,
    description: description || null,
    media_type: mediaType === "image" || mediaType === "document" ? mediaType : fileType,
    storage_path: storagePath,
    public_url: data.publicUrl,
    active: true
  });
}

function sanitizeFileName(name: string) {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}
