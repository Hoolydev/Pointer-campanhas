"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

export function DeleteCampaignButton({
  campaignId,
  campaignName,
  compact = false
}: {
  campaignId: string;
  campaignName: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    const confirmed = window.confirm(
      `Excluir a campanha "${campaignName}"? Isso tambem remove contatos, conversas, leads e jobs ligados a ela.`
    );

    if (!confirmed) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: "DELETE"
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Nao foi possivel excluir a campanha.");
        return;
      }

      router.push("/campaigns");
      router.refresh();
    });
  }

  return (
    <div className={compact ? "" : "space-y-2"}>
      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md bg-red-100 px-2 py-1 text-xs font-medium text-red-700 transition hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-70"
      >
        <Trash2 className="h-3.5 w-3.5" />
        {pending ? "Excluindo..." : "Excluir"}
      </button>
      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
