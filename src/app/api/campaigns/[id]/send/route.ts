import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/organization";
import { renderTemplate } from "@/lib/templates";
import { createClient } from "@/lib/supabase/server";
import { buildTemplateComponents } from "@/services/meta/template-components";
import { publishJobProcessor } from "@/services/qstash/jobs";

const sendSchema = z.object({
  intervalSeconds: z.number().int().min(10).max(3600).default(30),
  limit: z.number().int().min(1).max(10000).default(10000),
  enqueueAll: z.boolean().default(true),
  processor: z.enum(["qstash", "n8n"]).default("qstash")
});

type ContactRow = {
  id: string;
  name: string | null;
  phone: string;
};

type CampaignRow = {
  id: string;
  organization_id: string;
  dispatch_channel: "meta" | "uazapi";
  n8n_enabled: boolean;
  send_interval_min_seconds: number;
  send_interval_max_seconds: number;
  uazapi_instance_strategy: "round_robin" | "least_recent";
  initial_message: string | null;
  meta_template_name: string | null;
  meta_template_language: string;
  meta_template_body_params: unknown;
  meta_header_media_type: string | null;
  meta_header_media_url: string | null;
  meta_header_media_id: string | null;
};

type WhatsappInstanceRow = {
  id: string;
  name: string;
  phone: string | null;
  base_url: string | null;
  token: string | null;
  instance_key: string | null;
  min_delay_seconds: number;
  max_delay_seconds: number;
  hourly_limit: number;
  sent_current_hour: number;
  sent_current_hour_bucket: string;
  daily_limit: number;
  sent_today: number;
  last_sent_at: string | null;
};

type QstashPublishResult =
  | Awaited<ReturnType<typeof publishJobProcessor>>
  | { published: false; reason: string };

type ProcessorKickstartResult =
  | {
      attempted: true;
      ok: boolean;
      status: number;
      payload?: unknown;
      error?: string;
    }
  | {
      attempted: false;
      reason: string;
    };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = await request.json().catch(() => ({}));
  const parsed = sendSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Parametros invalidos." }, { status: 400 });
  }

  const { id } = await params;
  const supabase = await createClient();
  const { profile, error: profileError } = await getCurrentProfile(supabase);

  if (!profile) {
    return NextResponse.json({ error: profileError }, { status: 401 });
  }

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, organization_id, dispatch_channel, n8n_enabled, send_interval_min_seconds, send_interval_max_seconds, uazapi_instance_strategy, initial_message, meta_template_name, meta_template_language, meta_template_body_params, meta_header_media_type, meta_header_media_url, meta_header_media_id")
    .eq("id", id)
    .eq("organization_id", profile.organization_id)
    .single<CampaignRow>();

  if (!campaign) {
    return NextResponse.json({ error: "Campanha nao encontrada." }, { status: 404 });
  }

  if (campaign.dispatch_channel === "meta" && !campaign.meta_template_name) {
    return NextResponse.json(
      { error: "Configure um template Meta aprovado antes de disparar a campanha." },
      { status: 400 }
    );
  }

  const contactLimit = parsed.data.enqueueAll ? parsed.data.limit : Math.min(parsed.data.limit, 500);
  const { data: contacts, error: contactsError } = await supabase
    .from("contacts")
    .select("id, name, phone")
    .eq("campaign_id", id)
    .eq("organization_id", profile.organization_id)
    .in("status", ["pending", "failed"])
    .order("created_at", { ascending: true })
    .limit(contactLimit)
    .returns<ContactRow[]>();

  if (contactsError) {
    return NextResponse.json({ error: contactsError.message }, { status: 500 });
  }

  if (!contacts?.length) {
    const { count: pendingJobs } = await supabase
      .from("scheduled_jobs")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", profile.organization_id)
      .eq("job_type", "campaign_send_message")
      .eq("status", "pending")
      .contains("payload", { campaignId: campaign.id });

    let qstash: QstashPublishResult = { published: false, reason: "no_pending_contacts" };
    let kickstart: ProcessorKickstartResult = {
      attempted: false,
      reason: "no_pending_contacts"
    };

    if ((pendingJobs ?? 0) > 0) {
      qstash = await publishJobProcessor({
        runAt: new Date(),
        reason: "campaign_send_retry"
      }).catch((error) => ({
        published: false,
        reason: error instanceof Error ? error.message : "qstash_publish_failed"
      }));
      kickstart = await kickstartJobProcessor(request).catch((error) => ({
        attempted: true,
        ok: false,
        status: 0,
        error: error instanceof Error ? error.message : "processor_kickstart_failed"
      }));
    }

    return NextResponse.json({
      queued: 0,
      pendingJobs: pendingJobs ?? 0,
      qstash,
      kickstart,
      processor: "qstash"
    });
  }

  const n8nDispatchWebhookUrl = process.env.N8N_CAMPAIGN_DISPATCH_WEBHOOK_URL;

  if (campaign.dispatch_channel === "uazapi" && !n8nDispatchWebhookUrl) {
    return NextResponse.json(
      { error: "Configure N8N_CAMPAIGN_DISPATCH_WEBHOOK_URL para disparos Uazapi." },
      { status: 400 }
    );
  }

  if ((parsed.data.processor === "n8n" || campaign.n8n_enabled) && n8nDispatchWebhookUrl) {
    const { data: selectedInstances } =
      campaign.dispatch_channel === "uazapi"
        ? await supabase
            .from("campaign_whatsapp_instances")
            .select("whatsapp_instance_id")
            .eq("organization_id", profile.organization_id)
            .eq("campaign_id", campaign.id)
            .returns<Array<{ whatsapp_instance_id: string }>>()
        : { data: [] };
    const selectedInstanceIds = (selectedInstances ?? []).map((item) => item.whatsapp_instance_id);
    const { data: uazapiInstances, error: instancesError } =
      campaign.dispatch_channel === "uazapi"
        ? selectedInstanceIds.length > 0
          ? await supabase
              .from("whatsapp_instances")
              .select("id, name, phone, base_url, token, instance_key, min_delay_seconds, max_delay_seconds, hourly_limit, sent_current_hour, sent_current_hour_bucket, daily_limit, sent_today, last_sent_at")
              .eq("organization_id", profile.organization_id)
              .eq("provider", "uazapi")
              .eq("active", true)
              .in("id", selectedInstanceIds)
              .order("send_order", { ascending: true })
              .limit(5)
              .returns<WhatsappInstanceRow[]>()
          : await supabase
              .from("whatsapp_instances")
              .select("id, name, phone, base_url, token, instance_key, min_delay_seconds, max_delay_seconds, hourly_limit, sent_current_hour, sent_current_hour_bucket, daily_limit, sent_today, last_sent_at")
              .eq("organization_id", profile.organization_id)
              .eq("provider", "uazapi")
              .eq("active", true)
              .order("send_order", { ascending: true })
              .limit(5)
              .returns<WhatsappInstanceRow[]>()
        : { data: [], error: null };

    if (instancesError) {
      return NextResponse.json({ error: instancesError.message }, { status: 500 });
    }

    if (campaign.dispatch_channel === "uazapi" && !uazapiInstances?.length) {
      return NextResponse.json(
        { error: "Cadastre ao menos uma instancia Uazapi ativa em Configuracoes > WhatsApp." },
        { status: 400 }
      );
    }

    const headers: HeadersInit = {
      "Content-Type": "application/json"
    };

    const n8nSecret =
      process.env.N8N_WEBHOOK_SECRET || process.env.TRIGGER_SECRET_KEY || process.env.CRON_SECRET;

    if (n8nSecret) {
      headers.Authorization = `Bearer ${n8nSecret}`;
    }

    const response = await fetch(n8nDispatchWebhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        event: "campaign.dispatch.requested",
        organizationId: profile.organization_id,
        requestedBy: profile.id,
        limit: parsed.data.limit,
        intervalSeconds: parsed.data.intervalSeconds,
        minDelaySeconds: campaign.send_interval_min_seconds,
        maxDelaySeconds: campaign.send_interval_max_seconds,
        uazapiInstanceStrategy: campaign.uazapi_instance_strategy,
        hourlyLimitPerInstance: 20,
        campaign: {
          id: campaign.id,
          dispatchChannel: campaign.dispatch_channel,
          initialMessage: campaign.initial_message,
          metaTemplateName: campaign.meta_template_name,
          metaTemplateLanguage: campaign.meta_template_language,
          metaPhoneNumberId: process.env.META_PHONE_NUMBER_ID || null,
          minDelaySeconds: campaign.send_interval_min_seconds,
          maxDelaySeconds: campaign.send_interval_max_seconds
        },
        meta: {
          accessToken: process.env.META_ACCESS_TOKEN || null,
          phoneNumberId: process.env.META_PHONE_NUMBER_ID || null
        },
        uazapiInstances: (uazapiInstances ?? []).map((instance) => ({
          id: instance.id,
          name: instance.name,
          phone: instance.phone,
          baseUrl: instance.base_url,
          token: instance.token,
          instanceKey: instance.instance_key,
          minDelaySeconds: instance.min_delay_seconds,
          maxDelaySeconds: instance.max_delay_seconds,
          hourlyLimit: Math.min(20, instance.hourly_limit || 20),
          sentCurrentHour: instance.sent_current_hour,
          sentCurrentHourBucket: instance.sent_current_hour_bucket,
          dailyLimit: instance.daily_limit,
          sentToday: instance.sent_today,
          lastSentAt: instance.last_sent_at
        })),
        contacts: contacts.map((contact) => ({
          id: contact.id,
          name: contact.name,
          phone: contact.phone,
          components: buildTemplateComponents({
            params: campaign.meta_template_body_params,
            contact,
            header: {
              type: campaign.meta_header_media_type,
              url: campaign.meta_header_media_url,
              id: campaign.meta_header_media_id
            }
          })
        }))
      })
    });

    if (!response.ok) {
      const payload = await response.text().catch(() => "");

      return NextResponse.json(
        {
          error: `n8n nao aceitou o disparo: ${payload || response.statusText}`
        },
        { status: 502 }
      );
    }

    for (const chunk of chunkArray(contacts, 500)) {
      await supabase
        .from("contacts")
        .update({ status: "queued" })
        .in(
          "id",
          chunk.map((contact) => contact.id)
        );
    }

    return NextResponse.json({
      queued: contacts.length,
      pendingJobs: contacts.length,
      processor: "n8n"
    });
  }

  const now = Date.now();
  const jobs = contacts.map((contact, index) => ({
    organization_id: profile.organization_id,
    job_type: "campaign_send_message",
    target_id: contact.id,
    status: "pending",
    run_at: new Date(now + index * parsed.data.intervalSeconds * 1000).toISOString(),
      payload: {
        campaignId: campaign.id,
        contactId: contact.id,
        phone: contact.phone,
        templateName: campaign.meta_template_name,
        languageCode: campaign.meta_template_language || "pt_BR",
        components: buildTemplateComponents({
          params: campaign.meta_template_body_params,
          contact,
          header: {
            type: campaign.meta_header_media_type,
            url: campaign.meta_header_media_url,
            id: campaign.meta_header_media_id
          }
        }),
        text: renderTemplate(campaign.initial_message || "", {
          nome: contact.name,
        name: contact.name,
        telefone: contact.phone,
        phone: contact.phone
      })
    }
  }));

  for (const chunk of chunkArray(jobs, 500)) {
    const { error: jobsError } = await supabase.from("scheduled_jobs").insert(chunk);

    if (jobsError) {
      return NextResponse.json({ error: jobsError.message }, { status: 500 });
    }
  }

  for (const chunk of chunkArray(contacts, 500)) {
    await supabase
      .from("contacts")
      .update({ status: "queued" })
      .in(
        "id",
        chunk.map((contact) => contact.id)
      );
  }

  const qstash = await publishJobProcessor({
    runAt: jobs[0]?.run_at,
    reason: "campaign_send"
  }).catch((error) => ({
    published: false,
    reason: error instanceof Error ? error.message : "qstash_publish_failed"
  }));
  const kickstart = await kickstartJobProcessor(request).catch((error) => ({
    attempted: true as const,
    ok: false,
    status: 0,
    error: error instanceof Error ? error.message : "processor_kickstart_failed"
  }));

  return NextResponse.json({
    queued: jobs.length,
    pendingJobs: jobs.length,
    qstash,
    kickstart,
    processor: "qstash"
  });
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function kickstartJobProcessor(request: Request): Promise<ProcessorKickstartResult> {
  const secret = process.env.TRIGGER_SECRET_KEY || process.env.CRON_SECRET;

  if (!secret) {
    return { attempted: false, reason: "missing_trigger_secret" };
  }

  const response = await fetch(new URL("/api/jobs/process", request.url), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ reason: "campaign_send_kickstart" }),
    cache: "no-store"
  });
  const payload = (await response.json().catch(() => null)) as unknown;

  return {
    attempted: true,
    ok: response.ok,
    status: response.status,
    payload
  };
}
