import Link from "next/link";
import type { Route } from "next";
import { Bot, FileText, Send } from "lucide-react";
import { Badge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import {
  qualifyManuallyAction,
  sendManualReplyAction,
  sendToBrokerAction,
  toggleAiAction
} from "./actions";

type ConversationRow = {
  id: string;
  status: string;
  current_stage: string;
  ai_enabled: boolean;
  last_message_at: string | null;
  contacts: {
    name: string | null;
    phone: string;
  } | null;
  campaigns: {
    name: string;
  } | null;
};

type MessageRow = {
  id: string;
  direction: "inbound" | "outbound";
  type: "text" | "image" | "audio" | "video" | "document" | "template";
  content: string | null;
  media_url: string | null;
  status: string;
  created_at: string;
};

export default async function InboxPage({
  searchParams
}: {
  searchParams: Promise<{ conversation?: string }>;
}) {
  const { conversation: selectedConversationId } = await searchParams;
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile) {
    return (
      <>
        <PageHeader title="Inbox" description="Conversas recebidas pelo WhatsApp e canais integrados." />
        <section className="rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-sm">
          Crie um perfil vinculado a uma organizacao para usar a Inbox.
        </section>
      </>
    );
  }

  const { data: conversations } = await supabase
    .from("conversations")
    .select("id, status, current_stage, ai_enabled, last_message_at, contacts(name, phone), campaigns(name)")
    .eq("organization_id", profile.organization_id)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(50)
    .returns<ConversationRow[]>();

  const selected = conversations?.find((conversation) => conversation.id === selectedConversationId);
  const activeConversation = selected ?? conversations?.[0] ?? null;

  const { data: messages } = activeConversation
    ? await supabase
        .from("messages")
        .select("id, direction, type, content, media_url, status, created_at")
        .eq("organization_id", profile.organization_id)
        .eq("conversation_id", activeConversation.id)
        .order("created_at", { ascending: true })
        .returns<MessageRow[]>()
    : { data: [] };

  return (
    <>
      <PageHeader title="Inbox" description="Conversas recebidas pelo WhatsApp e canais integrados." />
      <section className="grid min-h-[640px] gap-6 lg:grid-cols-[360px_1fr]">
        <aside className="overflow-hidden rounded-lg border bg-card shadow-sm">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-950">Conversas</h2>
          </div>
          <div className="divide-y">
            {conversations?.length ? (
              conversations.map((conversation) => (
                <Link
                  key={conversation.id}
                  href={`/inbox?conversation=${conversation.id}` as Route}
                  className="block px-4 py-4 transition hover:bg-muted/60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-950">
                        {conversation.contacts?.name || "Sem nome"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {conversation.contacts?.phone}
                      </p>
                    </div>
                    {conversation.ai_enabled ? <Bot className="h-4 w-4 text-teal-700" /> : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge tone="muted">{conversation.current_stage}</Badge>
                    <Badge>{conversation.campaigns?.name || "Sem campanha"}</Badge>
                  </div>
                </Link>
              ))
            ) : (
              <p className="p-4 text-sm text-muted-foreground">
                Nenhuma conversa recebida ainda.
              </p>
            )}
          </div>
        </aside>

        <div className="flex min-h-[640px] flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
          {activeConversation ? (
            <>
              <header className="flex items-start justify-between border-b px-5 py-4">
                <div>
                  <h2 className="font-semibold text-slate-950">
                    {activeConversation.contacts?.name || "Sem nome"}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {activeConversation.contacts?.phone}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Badge tone={activeConversation.ai_enabled ? "success" : "muted"}>
                    IA {activeConversation.ai_enabled ? "ativa" : "pausada"}
                  </Badge>
                  <Badge tone="muted">{activeConversation.status}</Badge>
                </div>
              </header>

              <div className="flex flex-wrap gap-2 border-b px-5 py-3">
                <form action={toggleAiAction}>
                  <input type="hidden" name="conversation_id" value={activeConversation.id} />
                  <input
                    type="hidden"
                    name="ai_enabled"
                    value={String(activeConversation.ai_enabled)}
                  />
                  <button className="rounded-md border bg-white px-3 py-1.5 text-xs font-medium">
                    {activeConversation.ai_enabled ? "Desativar IA" : "Ativar IA"}
                  </button>
                </form>
                <form action={qualifyManuallyAction}>
                  <input type="hidden" name="conversation_id" value={activeConversation.id} />
                  <button className="rounded-md border bg-white px-3 py-1.5 text-xs font-medium">
                    Qualificar manualmente
                  </button>
                </form>
                <form action={sendToBrokerAction}>
                  <input type="hidden" name="conversation_id" value={activeConversation.id} />
                  <button className="rounded-md border bg-white px-3 py-1.5 text-xs font-medium">
                    Enviar ao corretor
                  </button>
                </form>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-5">
                {messages?.length ? (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={
                        message.direction === "outbound"
                          ? "ml-auto max-w-[75%] rounded-lg bg-teal-700 px-4 py-3 text-sm text-white"
                          : "max-w-[75%] rounded-lg border bg-white px-4 py-3 text-sm text-slate-800"
                      }
                    >
                      <MessageBody message={message} />
                      <p className="mt-2 text-[11px] opacity-70">{message.status}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">Sem mensagens nesta conversa.</p>
                )}
              </div>

              <form action={sendManualReplyAction} className="flex gap-3 border-t p-4">
                <input type="hidden" name="conversation_id" value={activeConversation.id} />
                <input
                  name="content"
                  placeholder="Responder manualmente..."
                  className="h-11 flex-1 rounded-md border bg-white px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                />
                <button
                  type="submit"
                  className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
                >
                  <Send className="h-4 w-4" />
                  Enviar
                </button>
              </form>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
              Selecione uma conversa para visualizar as mensagens.
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function MessageBody({ message }: { message: MessageRow }) {
  const mediaSrc = message.media_url ? `/api/messages/${message.id}/media` : null;

  if (message.type === "image" && mediaSrc) {
    return (
      <div className="space-y-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mediaSrc} alt={message.content || "Imagem recebida"} className="max-h-80 rounded-md object-contain" />
        {message.content ? <p className="whitespace-pre-wrap">{message.content}</p> : null}
      </div>
    );
  }

  if (message.type === "video" && mediaSrc) {
    return (
      <div className="space-y-2">
        <video src={mediaSrc} controls className="max-h-80 w-full rounded-md" />
        {message.content ? <p className="whitespace-pre-wrap">{message.content}</p> : null}
      </div>
    );
  }

  if (message.type === "audio" && mediaSrc) {
    return (
      <div className="space-y-2">
        <audio src={mediaSrc} controls className="w-full" />
        {message.content ? <p className="whitespace-pre-wrap">{message.content}</p> : null}
      </div>
    );
  }

  if (message.type === "document" && mediaSrc) {
    return (
      <a href={mediaSrc} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 underline">
        <FileText className="h-4 w-4" />
        {message.content || "Abrir documento"}
      </a>
    );
  }

  return <p className="whitespace-pre-wrap">{message.content || "Midia recebida"}</p>;
}
