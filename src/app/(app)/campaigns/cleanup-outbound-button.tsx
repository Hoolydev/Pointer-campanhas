"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { cleanupUnsentOutboundQueueAction } from "./actions";

export function CleanupOutboundButton() {
  const [state, action, pending] = useActionState(cleanupUnsentOutboundQueueAction, null);

  return (
    <form
      action={action}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          "Limpar jobs antigos e conversas vazias sem mensagem enviada? Contatos que nao receberam mensagem serao resetados para pending."
        );

        if (!confirmed) {
          event.preventDefault();
        }
      }}
      className="relative"
    >
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-10 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-700 disabled:opacity-70"
      >
        <Trash2 className="h-4 w-4" />
        {pending ? "Limpando..." : "Limpar fila antiga"}
      </button>
      {state?.message || state?.error ? (
        <p
          className={`absolute right-0 top-12 z-10 w-96 rounded-md border px-3 py-2 text-left text-xs shadow-sm ${
            state.error
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {state.error || state.message}
        </p>
      ) : null}
    </form>
  );
}
