# Pointer Campanhas - n8n Workflows

Esta pasta versiona os fluxos n8n que assumem a automacao operacional do Pointer Campanhas.

## Materializacao de chaves

O n8n self-hosted usado neste projeto nao depende de `$env.*` nos fluxos. Os arquivos JSON ficam com placeholders seguros e o script `deploy-workflows.mjs` substitui pelos valores reais antes de atualizar o n8n via API.

Os valores sao lidos de:

- `.env.local`
- `.env.vercel.tmp`, quando gerado por `vercel env pull`
- variaveis exportadas no terminal

## Valores necessarios

```env
POINTER_APP_URL=https://pointer-campanhas.vercel.app
POINTER_N8N_WEBHOOK_SECRET=

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
N8N_POSTGRES_CREDENTIAL_ID=
N8N_POSTGRES_CREDENTIAL_NAME="Pointer Supabase Postgres"

OPENAI_API_KEY=
OPENAI_MODEL=gpt-5-mini

META_ACCESS_TOKEN=
META_PHONE_NUMBER_ID=

UAZAPI_BASE_URL=
UAZAPI_TOKEN=

HAUZAPP_BASE_URL=https://hauzhub.com.br/requisicao/api/integracao.php
HAUZAPP_API_KEY=
HAUZAPP_PROSPECTION_STAGE_ID=0
HAUZAPP_CONTACT_STAGE_ID=2
HAUZAPP_QUALIFIED_STAGE_ID=3
HAUZAPP_DATA_INICIAL=01/01/2025

CRIS_PHONE=
```

Os tokens Uazapi e instancias ficam no Supabase, cadastrados pelo front em `/settings/whatsapp`.

## Workflows

- `01-campaign-dispatch-router.mjs`: recebe campanha do front, responde o webhook imediatamente, alterna ate 5 instancias Uazapi selecionadas, respeita 20 mensagens/hora por instancia, envia com delay humanizado e grava status no Supabase.
- `02-meta-inbound-lead-agent.json`: recebe webhook Meta, normaliza a mensagem inbound e envia para o cerebro `07`.
- `03-uazapi-inbound-router.json`: recebe Uazapi, normaliza telefone/texto e envia para o cerebro `07`.
- `04-hauzapp-prospection-sync.mjs`: busca negocios do HauzApp em Lead Novo direto no n8n, importa contatos/conversas/leads via Postgres e deixa a conversa com IA ativa. Tambem expoe o webhook manual `/webhook/pointer/hauzapp-sync-now` para testes imediatos.
- `05-broker-sla-orchestrator.json`: executa as regras de cobranca dos corretores, visitas, escalonamento e lembretes.
- `06-whatsapp-instance-health.json`: rotina para resetar contadores diarios e auditar instancias.
- `07-lead-ai-brain.mjs`: cerebro inbound de IA. Carrega/cria contato e conversa no Supabase via Postgres, busca o agente configurado no front, chama OpenAI, salva lead/mensagem, sincroniza a etapa do HauzApp quando o lead vem do CRM e responde pelo canal Meta ou Uazapi.

## Atualizar no n8n

```bash
cd n8n-mcp-main/pointer-campanhas-workflows
N8N_BASE_URL="https://n8n.growthailabs.com.br" \
N8N_API_KEY="cole-a-chave-localmente" \
node scripts/deploy-workflows.mjs
```

O script atualiza workflows existentes pelo nome, cria os ausentes e reativa os que ja estavam ativos.

Depois do deploy, copie a URL do webhook de `01-campaign-dispatch-router` para `N8N_CAMPAIGN_DISPATCH_WEBHOOK_URL` na Vercel.
