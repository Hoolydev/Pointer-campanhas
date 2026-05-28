import Link from "next/link";
import type { Route } from "next";
import { Bot, ClipboardList, MessageSquareText, Plug } from "lucide-react";
import { PageHeader } from "@/components/page-header";

const settingsLinks: Array<{
  href: Route;
  title: string;
  description: string;
  icon: typeof Plug;
}> = [
  {
    href: "/settings/integrations" as Route,
    title: "Integrações",
    description: "Conectar HauzApp, Uazapi e configurar o webhook.",
    icon: Plug
  },
  {
    href: "/settings/agents" as Route,
    title: "Agentes IA",
    description: "Editar prompts, materiais, humanização e agente de corretores.",
    icon: Bot
  },
  {
    href: "/settings/followups" as Route,
    title: "Follow-ups",
    description: "Regras de mensagens para leads e corretores.",
    icon: MessageSquareText
  },
  {
    href: "/settings/logs" as Route,
    title: "Logs",
    description: "Auditar webhooks, jobs e chamadas externas.",
    icon: ClipboardList
  }
];

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Configurações" description="Central de ajustes da operação." />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {settingsLinks.map((item) => {
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg border bg-card p-5 shadow-sm transition hover:border-primary/40 hover:bg-muted/40"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-slate-700">
                <Icon className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-base font-semibold text-slate-950">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
            </Link>
          );
        })}
      </section>
    </>
  );
}
