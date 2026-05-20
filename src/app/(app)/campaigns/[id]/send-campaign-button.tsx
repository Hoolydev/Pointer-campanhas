"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";

export function SendCampaignButton({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSend() {
    setPending(true);
    setMessage(null);

    const response = await fetch(`/api/campaigns/${campaignId}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        intervalSeconds: 30,
        limit: 10000,
        enqueueAll: true,
        processor: "qstash"
      })
    });

    const payload = (await response.json().catch(() => ({}))) as {
      queued?: number;
      pendingJobs?: number;
      processor?: string;
      qstash?: {
        published?: boolean;
        reason?: string;
      };
      kickstart?: {
        attempted?: boolean;
        ok?: boolean;
        status?: number;
        reason?: string;
        error?: string;
      };
      error?: string;
    };

    setPending(false);

    if (!response.ok) {
      setMessage(payload.error ?? "Nao foi possivel enfileirar os disparos.");
      return;
    }

    if ((payload.queued ?? 0) > 0) {
      const qstashMessage =
        payload.processor === "n8n"
          ? " O n8n assumiu o processamento."
          : payload.qstash?.published === false
          ? ` QStash nao confirmou o processador: ${payload.qstash.reason ?? "sem detalhe"}.`
          : " QStash assumiu o processamento.";
      const kickstartMessage =
        payload.processor === "n8n"
          ? ""
          : payload.kickstart?.ok
          ? " Primeiro lote iniciado."
          : payload.kickstart?.attempted
          ? ` O primeiro lote nao iniciou automaticamente: ${
              payload.kickstart.error ?? `status ${payload.kickstart.status ?? "desconhecido"}`
            }.`
          : ` Processador imediato nao acionado: ${payload.kickstart?.reason ?? "sem detalhe"}.`;
      setMessage(`${payload.queued} contato(s) enfileirado(s).${qstashMessage}${kickstartMessage}`);
      router.refresh();
      return;
    }

    if ((payload.pendingJobs ?? 0) > 0) {
      const kickstartMessage = payload.kickstart?.ok
        ? " Primeiro lote iniciado."
        : payload.kickstart?.attempted
        ? ` O primeiro lote nao iniciou automaticamente: ${
            payload.kickstart.error ?? `status ${payload.kickstart.status ?? "desconhecido"}`
          }.`
        : ` Processador imediato nao acionado: ${payload.kickstart?.reason ?? "sem detalhe"}.`;
      setMessage(
        `${payload.pendingJobs} disparo(s) ja estavam na fila. Reativei o processador QStash.${kickstartMessage}`
      );
      router.refresh();
      return;
    }

    setMessage("Nenhum contato pendente para enfileirar.");
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleSend}
        disabled={pending}
        className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-70"
      >
        <Send className="h-4 w-4" />
        {pending ? "Enfileirando..." : "Enfileirar disparos"}
      </button>
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
    </div>
  );
}
