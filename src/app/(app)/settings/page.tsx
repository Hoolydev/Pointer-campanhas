import { Settings } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Configuracoes" description="Preferencias da organizacao e regras gerais." />
      <EmptyState
        icon={Settings}
        title="Configuracoes da conta"
        description="As proximas etapas conectam integracoes, janelas de atendimento e follow-ups."
      />
    </>
  );
}
