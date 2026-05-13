import Link from "next/link";
import type { Route } from "next";
import {
  BarChart3,
  Bot,
  Building2,
  CalendarDays,
  ClipboardList,
  Inbox,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Settings,
  Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { signOutAction } from "@/app/(app)/actions";

const navigation: Array<{ href: Route; label: string; icon: LucideIcon }> = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/campaigns", label: "Campanhas", icon: Megaphone },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/crm", label: "CRM", icon: BarChart3 },
  { href: "/appointments" as Route, label: "Agenda", icon: CalendarDays },
  { href: "/brokers", label: "Corretores", icon: Users },
  { href: "/settings/agents" as Route, label: "Agentes IA", icon: Bot },
  { href: "/settings/logs" as Route, label: "Logs", icon: ClipboardList },
  { href: "/settings", label: "Configuracoes", icon: Settings }
];

export function AppShell({
  children,
  userEmail,
  showSignOut = true
}: {
  children: React.ReactNode;
  userEmail?: string | null;
  showSignOut?: boolean;
}) {
  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r bg-white lg:block">
        <div className="flex h-16 items-center gap-3 border-b px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-950">Pointer Campanhas</p>
            <p className="text-xs text-muted-foreground">WhatsApp, IA e CRM</p>
          </div>
        </div>
        <nav className="space-y-1 p-4">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-muted hover:text-slate-950"
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-white/90 px-6 backdrop-blur">
          <div>
            <p className="text-sm font-medium text-slate-950">{userEmail ?? "Usuario"}</p>
            <p className="text-xs text-muted-foreground">Sessao protegida por Supabase Auth</p>
          </div>
          {showSignOut ? (
            <form action={signOutAction}>
              <button
                type="submit"
                className="inline-flex h-9 items-center gap-2 rounded-md border bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-muted"
              >
                <LogOut className="h-4 w-4" />
                Sair
              </button>
            </form>
          ) : null}
        </header>
        <main className="px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
