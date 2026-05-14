import type { SupabaseClient } from "@supabase/supabase-js";
import { splitMessageForWhatsApp, typingDelayMs } from "@/services/messaging/split-message";
import { publishJobProcessor } from "@/services/qstash/jobs";

export async function enqueueHumanizedMetaMessages({
  supabase,
  organizationId,
  conversationId,
  contactId,
  phone,
  text,
  sourceMessageId,
  sourceCreatedAt,
  splitEnabled = true,
  wordsPerMinute = 150
}: {
  supabase: SupabaseClient;
  organizationId: string;
  conversationId: string;
  contactId: string;
  phone: string;
  text: string;
  sourceMessageId?: string | null;
  sourceCreatedAt?: string | null;
  splitEnabled?: boolean;
  wordsPerMinute?: number;
}) {
  const parts = splitEnabled ? splitMessageForWhatsApp(text) : [text];
  let offset = 0;

  if (!parts.length) {
    return 0;
  }

  await supabase
    .from("scheduled_jobs")
    .update({ status: "cancelled" })
    .eq("organization_id", organizationId)
    .eq("target_id", conversationId)
    .eq("job_type", "meta_send_message")
    .eq("status", "pending");

  const jobs = parts.map((part, index) => {
    offset += index === 0 ? 0 : typingDelayMs(parts[index - 1], wordsPerMinute);

    return {
      organization_id: organizationId,
      job_type: "meta_send_message",
      target_id: conversationId,
      status: "pending",
      run_at: new Date(Date.now() + offset).toISOString(),
      payload: {
        conversationId,
        contactId,
        phone,
        text: part,
        humanized: true,
        partIndex: index + 1,
        totalParts: parts.length,
        sourceMessageId,
        sourceCreatedAt
      }
    };
  });

  await supabase.from("scheduled_jobs").insert(jobs);

  await publishJobProcessor({
    runAt: jobs[0]?.run_at,
    reason: "humanized_meta_messages"
  }).catch(() => null);

  return parts.length;
}
