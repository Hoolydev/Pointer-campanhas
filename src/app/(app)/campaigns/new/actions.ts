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

type CreateInboundCampaignState = {
  error?: string;
};

const campaignSchema = z
  .object({
    name: z.string().min(2, "Informe o nome da campanha."),
    dispatch_channel: z.enum(["meta", "uazapi"]).default("meta"),
    send_interval_min_seconds: z.coerce.number().int().min(10).max(7200).default(90),
    send_interval_max_seconds: z.coerce.number().int().min(10).max(7200).default(240),
    uazapi_instance_strategy: z.enum(["round_robin", "least_recent"]).default("round_robin"),
    uazapi_instance_ids: z.array(z.string().uuid()).max(5).default([]),
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
    if (data.dispatch_channel === "uazapi" && data.uazapi_instance_ids.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["uazapi_instance_ids"],
        message: "Selecione ao menos uma instancia Uazapi para o rodizio da campanha."
      });
    }
  });

const inboundCampaignSchema = z.object({
  name: z.string().min(2, "Informe o nome da campanha inbound."),
  agent_id: z.string().uuid("Selecione o agente de IA que vai atender os leads."),
  prospection_stage_id: z.coerce.number().int().min(0).default(0),
  contact_stage_id: z.coerce.number().int().min(0).default(2),
  qualified_stage_id: z.coerce.number().int().min(0).default(3),
  broker_followup_minutes: z.coerce.number().int().min(5).max(240).default(15),
  broker_escalation_minutes: z.coerce.number().int().min(10).max(1440).default(30),
  auto_attend: z.coerce.boolean().default(true),
  auto_greet: z.coerce.boolean().default(false)
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
    uazapi_instance_ids: formData.getAll("uazapi_instance_ids"),
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

  if (parsed.data.dispatch_channel === "uazapi") {
    const { count: validInstances } = await supabase
      .from("whatsapp_instances")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", profile.organization_id)
      .eq("provider", "uazapi")
      .eq("active", true)
      .in("id", parsed.data.uazapi_instance_ids);

    if ((validInstances ?? 0) !== parsed.data.uazapi_instance_ids.length) {
      return { error: "Uma ou mais instancias Uazapi selecionadas nao estao ativas." };
    }
  }

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .insert({
      organization_id: profile.organization_id,
      created_by: profile.id,
      status: "draft",
      campaign_type: "outbound",
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

  if (parsed.data.dispatch_channel === "uazapi" && parsed.data.uazapi_instance_ids.length > 0) {
    const { error: instanceLinkError } = await supabase.from("campaign_whatsapp_instances").insert(
      parsed.data.uazapi_instance_ids.map((instanceId) => ({
        organization_id: profile.organization_id,
        campaign_id: campaign.id,
        whatsapp_instance_id: instanceId
      }))
    );

    if (instanceLinkError) {
      return { error: instanceLinkError.message };
    }
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

export async function createInboundCampaignAction(
  _: CreateInboundCampaignState | null,
  formData: FormData
): Promise<CreateInboundCampaignState> {
  const parsed = inboundCampaignSchema.safeParse({
    name: formData.get("name"),
    agent_id: formData.get("agent_id"),
    prospection_stage_id: formData.get("prospection_stage_id") || 0,
    contact_stage_id: formData.get("contact_stage_id") || 2,
    qualified_stage_id: formData.get("qualified_stage_id") || 3,
    broker_followup_minutes: formData.get("broker_followup_minutes") || 15,
    broker_escalation_minutes: formData.get("broker_escalation_minutes") || 30,
    auto_attend: formData.get("auto_attend") === "on",
    auto_greet: formData.get("auto_greet") === "on"
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revise a campanha inbound." };
  }

  const supabase = await createClient();
  const { profile, error: profileError } = await getCurrentProfile(supabase);

  if (!profile) {
    return { error: profileError };
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
    return { error: "Agente de IA Lead/Meta nao encontrado ou inativo." };
  }

  const { data: existingHauzapp } = await supabase
    .from("integrations")
    .select("id, config")
    .eq("organization_id", profile.organization_id)
    .eq("provider", "hauzapp")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; config: Record<string, unknown> | null }>();

  const hauzappConfig = {
    ...(existingHauzapp?.config ?? {}),
    prospectionStageId: parsed.data.prospection_stage_id,
    contactStageId: parsed.data.contact_stage_id,
    qualifiedStageId: parsed.data.qualified_stage_id,
    leadAgentId: parsed.data.agent_id,
    autoAttendLeadNovo: parsed.data.auto_attend,
    autoGreetProspects: parsed.data.auto_greet,
    brokerFollowupMinutes: parsed.data.broker_followup_minutes,
    brokerEscalationMinutes: parsed.data.broker_escalation_minutes
  };

  if (existingHauzapp) {
    await supabase
      .from("integrations")
      .update({ name: "Campanha inbound HauzApp", config: hauzappConfig, active: true })
      .eq("id", existingHauzapp.id)
      .eq("organization_id", profile.organization_id);
  } else {
    await supabase.from("integrations").insert({
      organization_id: profile.organization_id,
      provider: "hauzapp",
      name: "Campanha inbound HauzApp",
      config: hauzappConfig,
      active: true
    });
  }

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .insert({
      organization_id: profile.organization_id,
      created_by: profile.id,
      status: parsed.data.auto_attend ? "active" : "paused",
      campaign_type: "inbound",
      dispatch_channel: "uazapi",
      inbound_enabled: parsed.data.auto_attend,
      n8n_enabled: true,
      name: parsed.data.name,
      property_description: `Inbound HauzApp configurado pelo assistente.

Funil:
- Entrada: Lead Novo (${parsed.data.prospection_stage_id})
- Atendimento IA/Nay: ${parsed.data.contact_stage_id}
- Qualificado/corretor: ${parsed.data.qualified_stage_id}

Corretor:
- Primeiro follow-up: ${parsed.data.broker_followup_minutes} min
- Escalonamento: ${parsed.data.broker_escalation_minutes} min`,
      initial_message: parsed.data.auto_greet
        ? "Olá, {{nome}}. Obrigado por responder. Como posso te ajudar?"
        : null,
      meta_template_name: null,
      meta_template_language: "pt_BR",
      meta_template_body_params: ["{{nome}}"],
      agent_id: parsed.data.agent_id,
      agent_prompt: agent.system_prompt
    })
    .select("id")
    .single<{ id: string }>();

  if (campaignError || !campaign) {
    return { error: campaignError?.message ?? "Nao foi possivel criar a campanha inbound." };
  }

  revalidatePath("/campaigns");
  revalidatePath("/settings/integrations");
  revalidatePath("/crm");
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
