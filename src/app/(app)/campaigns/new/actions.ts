"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/organization";
import { parseContactsFile } from "@/lib/import/contacts";
import { createClient } from "@/lib/supabase/server";
import { inferMetaHeaderMediaType, uploadMetaMedia } from "@/services/meta/upload-media";

type CreateCampaignState = {
  error?: string;
};

const campaignSchema = z
  .object({
    name: z.string().min(2, "Informe o nome da campanha."),
    dispatch_channel: z.enum(["meta", "uazapi"]).default("meta"),
    send_interval_min_seconds: z.coerce.number().int().min(10).max(7200).default(90),
    send_interval_max_seconds: z.coerce.number().int().min(10).max(7200).default(240),
    uazapi_instance_strategy: z.enum(["round_robin", "least_recent"]).default("round_robin"),
    initial_message: z.string().optional(),
    meta_template_name: z.string().optional(),
    meta_template_language: z.string().min(2).default("pt_BR"),
    meta_template_body_params: z.string().optional(),
    meta_header_media_type: z.enum(["", "image", "video", "document"]).optional(),
    meta_header_media_id: z.string().optional(),
    agent_id: z.string().uuid("Selecione o agente de IA que vai atender as respostas."),
    material_title_1: z.string().optional(),
    material_url_1: z.string().url().optional().or(z.literal("")),
    material_type_1: z.enum(["image", "video", "audio", "document", "link"]).optional(),
    material_title_2: z.string().optional(),
    material_url_2: z.string().url().optional().or(z.literal("")),
    material_type_2: z.enum(["image", "video", "audio", "document", "link"]).optional(),
    material_title_3: z.string().optional(),
    material_url_3: z.string().url().optional().or(z.literal("")),
    material_type_3: z.enum(["image", "video", "audio", "document", "link"]).optional()
  })
  .superRefine((data, context) => {
    if (data.dispatch_channel === "meta" && !data.meta_template_name?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["meta_template_name"],
        message: "Informe o template aprovado da Meta para campanhas oficiais."
      });
    }
  });

export async function createCampaignAction(
  _: CreateCampaignState | null,
  formData: FormData
): Promise<CreateCampaignState> {
  const parsed = campaignSchema.safeParse({
    name: formData.get("name"),
    dispatch_channel: formData.get("dispatch_channel") || "meta",
    send_interval_min_seconds: formData.get("send_interval_min_seconds") || 90,
    send_interval_max_seconds: formData.get("send_interval_max_seconds") || 240,
    uazapi_instance_strategy: formData.get("uazapi_instance_strategy") || "round_robin",
    initial_message: formData.get("initial_message") || undefined,
    meta_template_name: formData.get("meta_template_name") || undefined,
    meta_template_language: formData.get("meta_template_language") || "pt_BR",
    meta_template_body_params: formData.get("meta_template_body_params") || undefined,
    meta_header_media_type: formData.get("meta_header_media_type") || "",
    meta_header_media_id: formData.get("meta_header_media_id") || undefined,
    agent_id: formData.get("agent_id"),
    material_title_1: formData.get("material_title_1") || undefined,
    material_url_1: formData.get("material_url_1") || "",
    material_type_1: formData.get("material_type_1") || "document",
    material_title_2: formData.get("material_title_2") || undefined,
    material_url_2: formData.get("material_url_2") || "",
    material_type_2: formData.get("material_type_2") || "document",
    material_title_3: formData.get("material_title_3") || undefined,
    material_url_3: formData.get("material_url_3") || "",
    material_type_3: formData.get("material_type_3") || "document"
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revise os campos da campanha." };
  }

  if (parsed.data.send_interval_max_seconds < parsed.data.send_interval_min_seconds) {
    return { error: "O intervalo maximo precisa ser maior ou igual ao minimo." };
  }

  const file = formData.get("contacts_file");

  if (!(file instanceof File) || file.size === 0) {
    return { error: "Envie uma planilha CSV ou XLSX com os contatos." };
  }

  let importResult;

  try {
    importResult = await parseContactsFile(file);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Nao foi possivel ler a planilha." };
  }

  if (importResult.contacts.length === 0) {
    return { error: "Nenhum contato com telefone valido foi encontrado na planilha." };
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
      return { error: "O video/imagem do template deve ter no maximo 16 MB para envio pela Meta." };
    }

    const inferredType = inferMetaHeaderMediaType(headerFile);

    if (!inferredType) {
      return { error: "Nao foi possivel identificar o tipo da midia do template." };
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
            : "Nao foi possivel enviar a midia do template para a Meta."
      };
    }
  }

  const { data: agent, error: agentError } = await supabase
    .from("ai_agents")
    .select("system_prompt")
    .eq("id", parsed.data.agent_id)
    .eq("organization_id", profile.organization_id)
    .eq("agent_type", "lead_meta")
    .eq("active", true)
    .single<{ system_prompt: string }>();

  if (agentError || !agent) {
    return { error: "Agente de IA Lead/Meta nao encontrado ou inativo." };
  }

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .insert({
      organization_id: profile.organization_id,
      created_by: profile.id,
      status: "draft",
      name: parsed.data.name,
      dispatch_channel: parsed.data.dispatch_channel,
      n8n_enabled: true,
      send_interval_min_seconds: parsed.data.send_interval_min_seconds,
      send_interval_max_seconds: parsed.data.send_interval_max_seconds,
      uazapi_instance_strategy: parsed.data.uazapi_instance_strategy,
      property_description: `Campanha criada com o agente selecionado e canal ${parsed.data.dispatch_channel}.

Importacao:
- Linhas lidas: ${importResult.totalRows}
- Contatos validos importados: ${importResult.importedRows}
- Numeros invalidos/sem DDD: ${importResult.invalidRows}
- Duplicados ignorados: ${importResult.duplicateRows}`,
      initial_message: parsed.data.initial_message || null,
      meta_template_name: parsed.data.meta_template_name || null,
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
    return { error: campaignError?.message ?? "Nao foi possivel criar a campanha." };
  }

  const materials = buildMaterials(parsed.data, profile.organization_id, campaign.id);

  if (materials.length > 0) {
    const { error: materialsError } = await supabase.from("campaign_materials").insert(materials);

    if (materialsError) {
      return { error: materialsError.message };
    }
  }

  const storagePath = `${profile.organization_id}/${campaign.id}/${Date.now()}-${sanitizeFileName(file.name)}`;
  await supabase.storage.from("campaign-imports").upload(storagePath, file, {
    contentType: file.type || "application/octet-stream",
    upsert: true
  });

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

  revalidatePath("/dashboard");
  revalidatePath("/campaigns");
  redirect(`/campaigns/${campaign.id}` as Route);
}

function buildMaterials(
  data: z.infer<typeof campaignSchema>,
  organizationId: string,
  campaignId: string
) {
  return [1, 2, 3]
    .map((index) => {
      const title = data[`material_title_${index}` as keyof typeof data];
      const url = data[`material_url_${index}` as keyof typeof data];
      const mediaType = data[`material_type_${index}` as keyof typeof data];

      if (!title || !url || typeof title !== "string" || typeof url !== "string") {
        return null;
      }

      return {
        organization_id: organizationId,
        campaign_id: campaignId,
        title,
        media_url: url,
        media_type: typeof mediaType === "string" ? mediaType : "document",
        active: true
      };
    })
    .filter((material): material is NonNullable<typeof material> => Boolean(material));
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

function sanitizeFileName(name: string) {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}
