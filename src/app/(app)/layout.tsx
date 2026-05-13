import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { createClient, hasSupabasePublicEnv } from "@/lib/supabase/server";

export default async function ProtectedLayout({
  children
}: {
  children: React.ReactNode;
}) {
  if (!hasSupabasePublicEnv()) {
    return (
      <AppShell userEmail="Ambiente local" showSignOut={false}>
        <section className="rounded-lg border bg-card p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">
            Configuracao pendente
          </p>
          <h1 className="mt-3 text-2xl font-semibold text-slate-950">
            Supabase ainda nao foi configurado
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Crie um arquivo <code className="rounded bg-muted px-1.5 py-0.5">.env.local</code>{" "}
            baseado no <code className="rounded bg-muted px-1.5 py-0.5">.env.example</code> e
            preencha <code className="rounded bg-muted px-1.5 py-0.5">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
            e{" "}
            <code className="rounded bg-muted px-1.5 py-0.5">
              NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
            </code>
            . Depois reinicie o servidor Next.js.
          </p>
        </section>
      </AppShell>
    );
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <AppShell userEmail={user.email}>{children}</AppShell>;
}
