"use client";

import { useState } from "react";
import { Send } from "lucide-react";

export function SendCampaignButton({ campaignId }: { campaignId: string }) {
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
        limit: 100
      })
    });

    const payload = (await response.json().catch(() => ({}))) as {
      queued?: number;
      error?: string;
    };

    setPending(false);
    setMessage(
      response.ok
        ? `${payload.queued ?? 0} contato(s) enfileirado(s).`
        : payload.error ?? "Nao foi possivel enfileirar os disparos."
    );
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
