"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";

type CleanupState = {
  error?: string;
  message?: string;
};

type ConversationWithMessages = {
  id: string;
  messages: Array<{ id: string }> | null;
};

export async function cleanupUnsentOutboundQueueAction(
  previousState: CleanupState | null
): Promise<CleanupState> {
  void previousState;

  const supabase = await createClient();
  const { profile, error: profileError } = await getCurrentProfile(supabase);

  if (!profile) {
    return { error: profileError };
  }

  const organizationId = profile.organization_id;

  const { count: jobsToDelete } = await supabase
    .from("scheduled_jobs")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("job_type", "campaign_send_message")
    .in("status", ["pending", "running", "failed"]);

  const { error: jobsDeleteError } = await supabase
    .from("scheduled_jobs")
    .delete()
    .eq("organization_id", organizationId)
    .eq("job_type", "campaign_send_message")
    .in("status", ["pending", "running", "failed"]);

  if (jobsDeleteError) {
    return { error: jobsDeleteError.message };
  }

  const { data: conversations, error: conversationsError } = await supabase
    .from("conversations")
    .select("id, messages(id)")
    .eq("organization_id", organizationId)
    .limit(50000)
    .returns<ConversationWithMessages[]>();

  if (conversationsError) {
    return { error: conversationsError.message };
  }

  const emptyConversationIds = (conversations ?? [])
    .filter((conversation) => !conversation.messages || conversation.messages.length === 0)
    .map((conversation) => conversation.id);

  for (const chunk of chunkArray(emptyConversationIds, 500)) {
    const { error } = await supabase
      .from("conversations")
      .delete()
      .eq("organization_id", organizationId)
      .in("id", chunk);

    if (error) {
      return { error: error.message };
    }
  }

  const { data: sentMessages, error: sentMessagesError } = await supabase
    .from("messages")
    .select("contact_id")
    .eq("organization_id", organizationId)
    .eq("direction", "outbound")
    .eq("status", "sent")
    .not("contact_id", "is", null)
    .limit(100000)
    .returns<Array<{ contact_id: string | null }>>();

  if (sentMessagesError) {
    return { error: sentMessagesError.message };
  }

  const sentContactIds = new Set(
    (sentMessages ?? [])
      .map((message) => message.contact_id)
      .filter((contactId): contactId is string => Boolean(contactId))
  );

  const { data: queuedContacts, error: queuedContactsError } = await supabase
    .from("contacts")
    .select("id")
    .eq("organization_id", organizationId)
    .in("status", ["queued", "failed"])
    .limit(100000)
    .returns<Array<{ id: string }>>();

  if (queuedContactsError) {
    return { error: queuedContactsError.message };
  }

  const resetContactIds = (queuedContacts ?? [])
    .filter((contact) => !sentContactIds.has(contact.id))
    .map((contact) => contact.id);

  for (const chunk of chunkArray(resetContactIds, 500)) {
    const { error } = await supabase
      .from("contacts")
      .update({ status: "pending" })
      .eq("organization_id", organizationId)
      .in("id", chunk);

    if (error) {
      return { error: error.message };
    }
  }

  revalidatePath("/campaigns");
  revalidatePath("/dashboard");
  revalidatePath("/inbox");

  return {
    message: `Limpeza concluida: ${jobsToDelete ?? 0} job(s) removido(s), ${emptyConversationIds.length} conversa(s) vazia(s) apagada(s), ${resetContactIds.length} contato(s) resetado(s) para pending.`
  };
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
