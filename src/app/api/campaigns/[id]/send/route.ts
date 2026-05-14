import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/organization";
import { renderTemplate } from "@/lib/templates";
import { createClient } from "@/lib/supabase/server";
import { buildTemplateComponents } from "@/services/meta/template-components";
import { publishJobProcessor } from "@/services/qstash/jobs";

const sendSchema = z.object({
  intervalSeconds: z.number().int().min(10).max(3600).default(30),
  limit: z.number().int().min(1).max(500).default(100)
});

type ContactRow = {
  id: string;
  name: string | null;
  phone: string;
};

type CampaignRow = {
  id: string;
  organization_id: string;
  initial_message: string | null;
  meta_template_name: string | null;
  meta_template_language: string;
  meta_template_body_params: unknown;
  meta_header_media_type: string | null;
  meta_header_media_url: string | null;
  meta_header_media_id: string | null;
};

type QstashPublishResult =
  | Awaited<ReturnType<typeof publishJobProcessor>>
  | { published: false; reason: string };

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
    .select("id, organization_id, initial_message, meta_template_name, meta_template_language, meta_template_body_params, meta_header_media_type, meta_header_media_url, meta_header_media_id")
    .eq("id", id)
    .eq("organization_id", profile.organization_id)
    .single<CampaignRow>();

  if (!campaign) {
    return NextResponse.json({ error: "Campanha nao encontrada." }, { status: 404 });
  }

  if (!campaign.meta_template_name) {
    return NextResponse.json(
      { error: "Configure um template Meta aprovado antes de disparar a campanha." },
      { status: 400 }
    );
  }

  const { data: contacts, error: contactsError } = await supabase
    .from("contacts")
    .select("id, name, phone")
    .eq("campaign_id", id)
    .eq("organization_id", profile.organization_id)
    .in("status", ["pending", "failed"])
    .limit(parsed.data.limit)
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

    if ((pendingJobs ?? 0) > 0) {
      qstash = await publishJobProcessor({
        runAt: new Date(),
        reason: "campaign_send_retry"
      }).catch((error) => ({
        published: false,
        reason: error instanceof Error ? error.message : "qstash_publish_failed"
      }));
    }

    return NextResponse.json({
      queued: 0,
      pendingJobs: pendingJobs ?? 0,
      qstash
    });
  }

  const n8nDispatchWebhookUrl = process.env.N8N_CAMPAIGN_DISPATCH_WEBHOOK_URL;

  if (n8nDispatchWebhookUrl) {
    const response = await fetch(n8nDispatchWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        campaignId: campaign.id,
        organizationId: profile.organization_id,
        limit: parsed.data.limit,
        intervalSeconds: parsed.data.intervalSeconds,
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
        supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        metaAccessToken: process.env.META_ACCESS_TOKEN,
        metaPhoneNumberId: process.env.META_PHONE_NUMBER_ID
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

  const { error: jobsError } = await supabase.from("scheduled_jobs").insert(jobs);

  if (jobsError) {
    return NextResponse.json({ error: jobsError.message }, { status: 500 });
  }

  await supabase
    .from("contacts")
    .update({ status: "queued" })
    .in(
      "id",
      contacts.map((contact) => contact.id)
    );

  const qstash = await publishJobProcessor({
    runAt: jobs[0]?.run_at,
    reason: "campaign_send"
  }).catch((error) => ({
    published: false,
    reason: error instanceof Error ? error.message : "qstash_publish_failed"
  }));

  return NextResponse.json({
    queued: jobs.length,
    pendingJobs: jobs.length,
    qstash
  });
}
