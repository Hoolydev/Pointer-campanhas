import { Client, Receiver } from "@upstash/qstash";
import type { SupabaseClient } from "@supabase/supabase-js";

type PublishJobProcessorInput = {
  runAt?: string | Date | null;
  reason?: string;
};

function getAppUrl() {
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;

  if (appUrl) {
    return appUrl.replace(/\/$/, "");
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`.replace(/\/$/, "");
  }

  return null;
}

function getProcessorUrl() {
  const appUrl = getAppUrl();

  if (!appUrl) {
    return null;
  }

  return new URL("/api/jobs/process", appUrl).toString();
}

export function isQstashConfigured() {
  const hasSigningKeys = Boolean(
    process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY
  );
  const hasProcessorSecret = Boolean(process.env.TRIGGER_SECRET_KEY || process.env.CRON_SECRET);

  return Boolean(process.env.QSTASH_TOKEN && getProcessorUrl() && (hasSigningKeys || hasProcessorSecret));
}

export async function publishJobProcessor({
  runAt,
  reason = "scheduled_job"
}: PublishJobProcessorInput = {}) {
  if (!process.env.QSTASH_TOKEN) {
    return { published: false, reason: "missing_qstash_token" };
  }

  const url = getProcessorUrl();

  if (!url) {
    return { published: false, reason: "missing_app_url" };
  }

  const secret = process.env.TRIGGER_SECRET_KEY || process.env.CRON_SECRET;
  const hasSigningKeys = Boolean(
    process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY
  );

  if (!secret && !hasSigningKeys) {
    return { published: false, reason: "missing_processor_auth" };
  }

  const date = runAt ? new Date(runAt) : new Date();
  const runAtMs = Number.isNaN(date.getTime()) ? Date.now() : date.getTime();
  const notBefore = Math.max(Math.ceil(runAtMs / 1000), Math.floor(Date.now() / 1000));
  const bucket = Math.floor(notBefore / 10) * 10;
  const client = new Client({ token: process.env.QSTASH_TOKEN });

  const message = await client.publishJSON({
    url,
    headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
    body: { reason },
    notBefore,
    retries: 3,
    deduplicationId: `jobs-process-${bucket}`,
    label: "process-scheduled-jobs"
  });

  return { published: true, message };
}

export async function publishNextPendingJobProcessor(supabase: SupabaseClient) {
  const { data: nextJob } = await supabase
    .from("scheduled_jobs")
    .select("run_at")
    .eq("status", "pending")
    .order("run_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ run_at: string }>();

  if (!nextJob?.run_at) {
    return { published: false, reason: "no_pending_jobs" };
  }

  return publishJobProcessor({
    runAt: nextJob.run_at,
    reason: "next_pending_job"
  });
}

export async function verifyQstashRequest(request: Request, body: string) {
  const signature =
    request.headers.get("upstash-signature") || request.headers.get("Upstash-Signature");

  if (!signature) {
    return false;
  }

  const receiver = new Receiver({
    currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY
  });

  return receiver.verify({
    signature,
    body,
    url: request.url,
    upstashRegion: request.headers.get("upstash-region") ?? undefined,
    clockTolerance: 60
  });
}
