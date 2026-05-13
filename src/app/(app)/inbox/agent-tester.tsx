"use client";

import { useState } from "react";
import { Bot, Send } from "lucide-react";

type AgentOption = {
  id: string;
  name: string;
  agent_type: string;
};

type TestMessage = {
  direction: "inbound" | "outbound";
  content: string;
};

export function AgentTester({ agents }: { agents: AgentOption[] }) {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [content, setContent] = useState("");
  const [messages, setMessages] = useState<TestMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function sendTestMessage() {
    const trimmed = content.trim();

    if (!agentId || !trimmed) {
      return;
    }

    setPending(true);
    setError(null);
    setMessages((current) => [...current, { direction: "inbound", content: trimmed }]);
    setContent("");

    const response = await fetch("/api/agents/test-chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agentId,
        message: trimmed,
        history: messages
      })
    });

    const payload = (await response.json().catch(() => ({}))) as {
      reply?: string;
      error?: string;
    };

    if (!response.ok || !payload.reply) {
      setError(payload.error || "Nao foi possivel testar o agente.");
      setPending(false);
      return;
    }

    setMessages((current) => [...current, { direction: "outbound", content: payload.reply ?? "" }]);
    setPending(false);
  }

  return (
    <section className="rounded-lg border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-teal-700" />
        <h2 className="text-sm font-semibold text-slate-950">Testar agente</h2>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Converse com um agente antes de usar em campanha.
      </p>
      <select
        value={agentId}
        onChange={(event) => {
          setAgentId(event.target.value);
          setMessages([]);
        }}
        className="mt-4 h-10 w-full rounded-md border bg-white px-3 text-sm"
      >
        {agents.length ? (
          agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name} • {agent.agent_type === "broker_uazapi" ? "Uazapi" : "Meta"}
            </option>
          ))
        ) : (
          <option value="">Nenhum agente ativo</option>
        )}
      </select>
      <div className="mt-4 max-h-80 space-y-2 overflow-y-auto rounded-md border bg-slate-50 p-3">
        {messages.length ? (
          messages.map((message, index) => (
            <div
              key={`${message.direction}-${index}`}
              className={
                message.direction === "outbound"
                  ? "rounded-md bg-teal-700 px-3 py-2 text-sm text-white"
                  : "ml-auto rounded-md border bg-white px-3 py-2 text-sm text-slate-800"
              }
            >
              {message.content}
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">Envie uma mensagem para iniciar o teste.</p>
        )}
      </div>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      <div className="mt-4 flex gap-2">
        <input
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void sendTestMessage();
            }
          }}
          placeholder="Mensagem de teste..."
          className="h-10 flex-1 rounded-md border bg-white px-3 text-sm"
        />
        <button
          type="button"
          disabled={pending || !agentId || !content.trim()}
          onClick={() => void sendTestMessage()}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Send className="h-4 w-4" />
          {pending ? "..." : "Enviar"}
        </button>
      </div>
    </section>
  );
}
