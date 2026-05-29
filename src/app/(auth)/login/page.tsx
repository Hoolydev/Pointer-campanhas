import Image from "next/image";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <section className="w-full max-w-md rounded-lg border bg-card p-8 shadow-soft">
        <div className="mb-8">
          <Image
            src="/logo.jpeg"
            alt="Pointer Campanhas"
            width={180}
            height={43}
            priority
            className="h-auto w-[180px]"
          />
          <h1 className="mt-3 text-2xl font-semibold text-slate-950">Acesse sua conta</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Entre para gerenciar campanhas, conversas, leads e corretores.
          </p>
        </div>
        <LoginForm redirectTo={params.redirectTo} />
      </section>
    </main>
  );
}
