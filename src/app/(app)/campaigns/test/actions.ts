"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/organization";
import { parseManualContactsText } from "@/lib/import/contacts";
import { createClient } from "@/lib/supabase/server";
import { inferMetaHeaderMediaType, uploadMetaMedia } from "@/services/meta/upload-media";

type CreateTestCampaignState = {
  error?: string;
};

const testCampaignSchema = z.object({
  name: z.string().min(2, "Informe o nome da campanha de teste."),
  agent_id: z.string().uuid("Selecione o agente de IA."),
  meta_template_name: z.string().min(2, "Selecione o template aprovado."),
  meta_template_language: z.string().min(2).default("pt_BR"),
  meta_template_body_params: z.string().optional(),
  meta_header_media_type: z.enum(["", "image", "video", "document"]).optional(),
  meta_header_media_id: z.string().optional(),
  contacts_text: z.string().min(8, "Informe pelo menos um telefone com DDD.")
});

export async function createTestCampaignAction(
  _: CreateTestCampaignState | null,
  formData: FormData
): Promise<CreateTestCampaignState> {
  const parsed = testCampaignSchema.safeParse({
    name: formData.get("name"),
    agent_id: formData.get("agent_id"),
    meta_template_name: formData.get("meta_template_name"),
    meta_template_language: formData.get("meta_template_language") || "pt_BR",
    meta_template_body_params: formData.get("meta_template_body_params") || undefined,
    meta_header_media_type: formData.get("meta_header_media_type") || "",
    meta_header_media_id: formData.get("meta_header_media_id") || undefined,
    contacts_text: formData.get("contacts_text")
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revise os campos da campanha." };
  }

  const importResult = parseManualContactsText(parsed.data.contacts_text);

  if (importResult.contacts.length === 0) {
    return { error: "Nenhum telefone valido com DDD foi encontrado." };
  }

  if (importResult.contacts.length > 50) {
    return { error: "Campanha de teste aceita ate 50 numeros por vez." };
  }

  const supabase = await createClient();
  const { profile, error: profileError } = await getCurrentProfile(supabase);

  if (!profile) {
    return { error: profileError };
  }

  const headerFile = formData.get("meta_header_media_file");
  let headerMediaId = parsed.data.meta_header_media_id || null;
  let headerMediaType = parsed.data.meta_header_media_type || null;

  if (headerFile instanceof File && headerFile.size > 0) {
    if (headerFile.size > 16 * 1024 * 1024) {
      return { error: "A midia do template deve ter no maximo 16 MB." };
    }

    const inferredType = inferMetaHeaderMediaType(headerFile);

    if (!inferredType) {
      return { error: "Nao foi possivel identificar o tipo da midia." };
    }

    try {
      const upload = await uploadMetaMedia({ file: headerFile });
      headerMediaId = upload.mediaId;
      headerMediaType = parsed.data.meta_header_media_type || inferredType;
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel enviar a midia para a Meta."
      };
    }
  }

  const { data: agent } = await supabase
    .from("ai_agents")
    .select("system_prompt")
    .eq("id", parsed.data.agent_id)
    .eq("organization_id", profile.organization_id)
    .eq("agent_type", "lead_meta")
    .eq("active", true)
    .maybeSingle<{ system_prompt: string }>();

  if (!agent) {
    return { error: "Agente Lead/Meta nao encontrado ou inativo." };
  }

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .insert({
      organization_id: profile.organization_id,
      created_by: profile.id,
      status: "draft",
      campaign_type: "test",
      dispatch_channel: "meta",
      name: parsed.data.name,
      property_description: `Campanha de teste.

Importacao manual:
- Linhas lidas: ${importResult.totalRows}
- Contatos validos: ${importResult.importedRows}
- Numeros invalidos/sem DDD: ${importResult.invalidRows}
- Duplicados ignorados: ${importResult.duplicateRows}`,
      initial_message: null,
      meta_template_name: parsed.data.meta_template_name,
      meta_template_language: parsed.data.meta_template_language,
      meta_template_body_params: parseTemplateParams(parsed.data.meta_template_body_params),
      meta_header_media_type: headerMediaType,
      meta_header_media_url: null,
      meta_header_media_id: headerMediaId,
      agent_id: parsed.data.agent_id,
      agent_prompt: agent.system_prompt
    })
    .select("id")
    .single<{ id: string }>();

  if (campaignError || !campaign) {
    return { error: campaignError?.message ?? "Nao foi possivel criar campanha de teste." };
  }

  const { error: contactsError } = await supabase.from("contacts").insert(
    importResult.contacts.map((contact) => ({
      organization_id: profile.organization_id,
      campaign_id: campaign.id,
      name: contact.name,
      phone: contact.phone,
      raw_data: contact.raw_data,
      status: "pending"
    }))
  );

  if (contactsError) {
    return { error: contactsError.message };
  }

  revalidatePath("/campaigns");
  redirect(`/campaigns/${campaign.id}` as Route);
}

function parseTemplateParams(value?: string) {
  if (!value) {
    return ["{{nome}}"];
  }

  const params = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return params.length > 0 ? params : ["{{nome}}"];
}
