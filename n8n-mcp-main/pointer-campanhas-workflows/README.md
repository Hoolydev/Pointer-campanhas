# Pointer Campanhas - n8n Workflows

Esta pasta versiona os fluxos n8n que assumem a automacao operacional do Pointer Campanhas.

## Variaveis no n8n

Configure estas variaveis no ambiente do n8n:

```env
POINTER_APP_URL=https://pointer-campanhas.vercel.app
POINTER_N8N_WEBHOOK_SECRET=

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

OPENAI_API_KEY=

META_ACCESS_TOKEN=
META_PHONE_NUMBER_ID=

HAUZAPP_BASE_URL=https://hauzhub.com.br/requisicao/api/integracao.php
HAUZAPP_API_KEY=

CRIS_PHONE=
```

Os tokens Uazapi e instancias ficam no Supabase, cadastrados pelo front em `/settings/whatsapp`.

## Workflows

- `01-campaign-dispatch-router.json`: recebe campanha do front, busca contatos pendentes, escolhe Meta ou Uazapi, alterna ate 5 instancias e envia com delay humanizado.
- `02-meta-inbound-lead-agent.json`: recebe webhook Meta, salva inbound, chama agente IA pelo app e envia resposta.
- `03-uazapi-inbound-router.json`: recebe Uazapi, decide se e lead, corretor ou Cristiana/admin e encaminha para o endpoint correto do app.
- `04-hauzapp-prospection-sync.json`: busca negocios do HauzApp em Prospecção e importa para o CRM.
- `05-broker-sla-orchestrator.json`: executa as regras de cobranca dos corretores, visitas, escalonamento e lembretes.
- `06-whatsapp-instance-health.json`: rotina para resetar contadores diarios e auditar instancias.

## Importar no n8n

```bash
cd n8n-mcp-main/pointer-campanhas-workflows
N8N_BASE_URL="https://n8n.growthailabs.com.br" \
N8N_API_KEY="cole-a-chave-localmente" \
node scripts/import-workflows.mjs
```

Depois de importar, ative os workflows no painel do n8n e copie a URL do webhook de `01-campaign-dispatch-router` para `N8N_CAMPAIGN_DISPATCH_WEBHOOK_URL` na Vercel.
