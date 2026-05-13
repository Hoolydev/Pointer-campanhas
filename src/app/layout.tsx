import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pointer Campanhas",
  description: "SaaS para campanhas imobiliarias com WhatsApp, IA e CRM."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
