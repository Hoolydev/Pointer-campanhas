import type { SupabaseClient } from "@supabase/supabase-js";
import { splitMessageForWhatsApp, typingDelayMs } from "@/services/messaging/split-message";

export async function enqueueHumanizedMetaMessages({
  supabase,
  organizationId,
  conversationId,
  contactId,
  phone,
  text,
  splitEnabled = true,
  wordsPerMinute = 150
}: {
  supabase: SupabaseClient;
  organizationId: string;
  conversationId: string;
  contactId: string;
  phone: string;
  text: string;
  splitEnabled?: boolean;
  wordsPerMinute?: number;
}) {
  const parts = splitEnabled ? splitMessageForWhatsApp(text) : [text];
  let offset = 0;

  if (!parts.length) {
    return 0;
  }

  await supabase.from("scheduled_jobs").insert(
    parts.map((part, index) => {
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
          totalParts: parts.length
        }
      };
    })
  );

  return parts.length;
}
