# Pointer Campanhas

MVP SaaS para campanhas imobiliarias com WhatsApp, Inbox, IA de qualificacao e CRM interno.

## Etapa 1 implementada

- Setup Next.js App Router com TypeScript e TailwindCSS.
- Supabase Auth com login por e-mail/senha.
- Middleware para proteger rotas privadas.
- Layout interno com navegacao para Dashboard, Campanhas, Inbox, CRM, Leads, Corretores e Configuracoes.
- Dashboard inicial com cards de metricas.
- Migrations Supabase com tabelas, enums, indices, logs e RLS por `organization_id`.
- `.env.example` com variaveis esperadas para Supabase, OpenAI, Meta, Uazapi, HouseUp e Trigger/QStash.

## Etapa 2 implementada

- Criacao de campanhas em `/campaigns/new`.
- Upload e importacao de contatos por CSV ou XLSX.
- Armazenamento da planilha original no Supabase Storage, bucket `campaign-imports`.
- Normalizacao de telefones brasileiros para o formato `55DDDnumero`.
- Listagem de campanhas em `/campaigns`.
- Detalhe de campanha em `/campaigns/[id]` com contatos importados.
- Dashboard conectado ao Supabase com contagens reais por organizacao.

## Etapas 3, 4 e 5 iniciadas

- Endpoint `POST /api/campaigns/[id]/send` para enfileirar disparos.
- Processador `POST /api/jobs/process` para jobs pendentes.
- Servico Meta WhatsApp em `src/services/meta/send-message.ts`.
- Webhook Meta `GET/POST /api/webhooks/meta` com recebimento de mensagens e status.
- Inbox funcional em `/inbox`, com historico, resposta manual e controles de IA.
- Agente IA em `src/agents/lead-agent.ts`, com fallback heuristico quando `OPENAI_API_KEY` nao estiver configurada.
- CRM Kanban em `/crm`.
- Detalhe de lead em `/leads/[id]`.
- Configuracao de agentes de IA em `/settings/agents`.
- Campanhas podem escolher qual agente atende os leads que responderem.
- Cadastro e ativacao de corretores em `/brokers`.
- Servico Uazapi e webhook `POST /api/webhooks/uazapi`.
- Redistribuicao via job `check_broker_response`.
- Integracao HauzApp para leads qualificados: cria negocio, move para etapa configurada e encaminha para corretor em rodizio.
- Placeholder HouseUp em `src/services/houseup/create-lead.ts`.
- Placeholder Canal Pro em `POST /api/webhooks/canal-pro`.
- Telas de integracoes e follow-ups conectadas ao Supabase.

## Requisitos

- Node.js 20+
- Um projeto Supabase
- Supabase CLI, se for aplicar migrations localmente

## Configuracao

1. Instale as dependencias:

```bash
npm install
```

2. Crie o arquivo `.env.local` baseado em `.env.example`:

```bash
cp .env.example .env.local
```

3. Preencha as variaveis Supabase:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

4. Aplique as migrations:

```bash
supabase db push
```

5. Crie uma organizacao e um perfil para o usuario autenticado. Veja o exemplo em `supabase/README.md`.

6. Rode o projeto:

```bash
npm run dev
```

## Rotas criadas

- `/login`
- `/dashboard`
- `/campaigns`
- `/campaigns/new`
- `/campaigns/[id]`
- `/inbox`
- `/crm`
- `/leads/[id]`
- `/brokers`
- `/settings`
- `/settings/integrations`
- `/settings/followups`

## Importacao de contatos

A planilha pode ser `.csv`, `.xlsx` ou `.xls`. O importador procura colunas com nomes como:

- `nome`, `name`, `cliente`, `lead`, `contato`
- `telefone`, `phone`, `celular`, `whatsapp`, `numero`

Exemplo de telefone:

```txt
62999998888 -> 5562999998888
```

## Processar fila localmente

Com `TRIGGER_SECRET_KEY` configurado:

```bash
curl -X POST http://localhost:3001/api/jobs/process \
  -H "Authorization: Bearer $TRIGGER_SECRET_KEY"
```

Em producao, o sistema publica automaticamente o processador no QStash quando cria
jobs em `scheduled_jobs`. Configure `APP_URL` com o dominio publico da Vercel e as
chaves do QStash. O endpoint tambem aceita chamada manual protegida por
`TRIGGER_SECRET_KEY` ou `CRON_SECRET`.

```env
APP_URL=https://seu-dominio.vercel.app
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
```

## Variaveis Meta WhatsApp

Configure no `.env.local`:

```env
META_VERIFY_TOKEN=
META_APP_SECRET=
META_ACCESS_TOKEN=
META_PHONE_NUMBER_ID=
META_BUSINESS_ACCOUNT_ID=
META_DEFAULT_FOLLOWUP_TEMPLATE=
META_DEFAULT_TEMPLATE_LANGUAGE=pt_BR
```

Para jobs em cron/Vercel:

```env
TRIGGER_SECRET_KEY=
CRON_SECRET=
```

## Variaveis HauzApp

Os nomes das etapas no CRM aparecem como 1, 2 e 3 para o usuario, mas a API retornou IDs baseados em zero. No projeto testado:

```env
HAUZAPP_BASE_URL=https://hauzhub.com.br/requisicao/api/integracao.php
HAUZAPP_API_KEY=
HAUZAPP_PROSPECTION_STAGE_ID=0
HAUZAPP_CONTACT_STAGE_ID=1
HAUZAPP_QUALIFIED_STAGE_ID=2
```

Tambem da para controlar pelo front em `/settings/integrations`, criando uma integracao `HauzApp` com JSON:

```json
{
  "apiKey": "sua-chave",
  "prospectionStageId": 1,
  "qualifiedStageId": 3,
  "leadAgentId": "uuid-do-agente",
  "autoGreetProspects": false
}
```

E uma integracao `Uazapi`:

```json
{
  "baseUrl": "https://sua-uazapi",
  "token": "seu-token",
  "leadAgentId": "uuid-do-agente"
}
```

Configure o webhook da Uazapi para:

```txt
https://pointer-campanhas.vercel.app/api/webhooks/uazapi
```

## Fluxo de atendimento IA

1. Voce cria um agente em `/settings/agents`.
2. Voce cria uma campanha e seleciona esse agente.
3. A primeira mensagem da campanha e disparada por voce pelo endpoint de envio/fila.
4. Quando o cliente responde no WhatsApp, o webhook Meta salva a conversa.
5. Se `ai_enabled = true`, o agente selecionado responde, qualifica e atualiza o lead.
6. Quando qualificado, o lead e enviado ao HauzApp na etapa `Lead Qualificado`.
7. Se o lead demonstrar intencao de visita, o agente prepara opcoes de agenda e registra em `/appointments`.
8. A sincronizacao HauzApp em `/settings/integrations` busca leads em `Prospecção` e cria atendimento por Uazapi.
9. Respostas vindas pela Uazapi chamam o agente configurado e atualizam o CRM.

## Habilidades inspiradas na secretaria n8n

- Atendimento com memoria da conversa.
- Resposta em mensagens quebradas, com pausas simuladas por job.
- Deteccao de interesse em visita ao decorado.
- Geracao de janelas de agenda com disponibilidade semanal.
- Registro de visita em `appointments`, pronto para conectar Google Calendar.
- Escalonamento para humano/corretor via fluxo de lead qualificado.

## Variaveis Google Calendar

```env
GOOGLE_CALENDAR_ID=
GOOGLE_CALENDAR_CLIENT_EMAIL=
GOOGLE_CALENDAR_PRIVATE_KEY=
```

## Proxima etapa

Refinar integracoes reais, criar testes automatizados e evoluir a IA para templates Meta quando a janela de 24h expirar.
