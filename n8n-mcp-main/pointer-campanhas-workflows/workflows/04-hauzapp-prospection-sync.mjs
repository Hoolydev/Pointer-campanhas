function code(fn) {
  const source = fn.toString();
  return source.slice(source.indexOf("{") + 1, source.lastIndexOf("}")).trim();
}

const buildImportSql = code(function () {
function sql(value) {
  if (value === null || value === undefined || value === "") return "null";
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function json(value) {
  return sql(JSON.stringify(value ?? {}));
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return null;
}

function isProspection(item) {
  const configuredId = Number("__HAUZAPP_PROSPECTION_STAGE_ID__");
  const stageId = Number(item.clienteFunilStageID ?? item.funilStageID ?? item.stageId);
  const stageName = String(item.clienteFunilStage || item.funilStage || item.stage || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return stageId === configuredId || stageName.includes("prospeccao") || stageName.includes("prospec");
}

const body = $json;
const details = Array.isArray(body.details) ? body.details : [];
const selected = details
  .filter(isProspection)
  .map((item) => ({ ...item, pointer_phone: normalizePhone(item.clienteTelefone) }))
  .filter((item) => item.pointer_phone);

if (!selected.length) {
  return [{
    json: {
      skip: true,
      response: {
        processed: true,
        imported: 0,
        skipped: details.length,
        reason: details.length ? "no_prospection_stage_matches" : "hauzapp_returned_zero_negotiations",
        total: details.length
      }
    }
  }];
}

const query = `
with input as (
  select ${json(selected)}::jsonb as items
),
org as (
  select organization_id
  from public.integrations
  where provider = 'hauzapp'
    and active = true
  order by created_at desc
  limit 1
),
org_fallback as (
  select id as organization_id
  from public.organizations
  order by created_at asc
  limit 1
),
resolved_org as (
  select coalesce((select organization_id from org), (select organization_id from org_fallback)) as organization_id
),
rows as (
  select
    r.organization_id,
    item,
    item->>'clienteID' as cliente_id,
    nullif(item->>'clienteNome', '') as cliente_nome,
    item->>'pointer_phone' as phone,
    nullif(item->>'clienteFunilStage', '') as stage_name,
    nullif(item->>'clienteFunilStageID', '')::int as stage_id,
    coalesce(nullif(item->>'clienteTemperature', '')::int, 0) as temperature
  from input
  cross join resolved_org r
  cross join lateral jsonb_array_elements(items) item
  where r.organization_id is not null
),
existing_contacts as (
  select distinct on (row.cliente_id, row.phone)
    row.cliente_id,
    row.phone,
    c.id,
    c.organization_id
  from rows row
  join public.contacts c
    on c.organization_id = row.organization_id
   and (
    c.hauzapp_cliente_id = row.cliente_id
    or c.phone = row.phone
   )
  order by row.cliente_id, row.phone, c.created_at desc
),
inserted_contacts as (
  insert into public.contacts (
    organization_id,
    campaign_id,
    name,
    phone,
    raw_data,
    status,
    hauzapp_cliente_id
  )
  select
    row.organization_id,
    null,
    row.cliente_nome,
    row.phone,
    row.item,
    'hauzapp_prospect',
    row.cliente_id
  from rows row
  where not exists (
    select 1
    from existing_contacts ec
    where ec.cliente_id = row.cliente_id
       or ec.phone = row.phone
  )
  returning id, organization_id, phone, hauzapp_cliente_id
),
contact_rows as (
  select id, organization_id, phone, cliente_id as hauzapp_cliente_id from existing_contacts
  union all
  select id, organization_id, phone, hauzapp_cliente_id from inserted_contacts
),
updated_contacts as (
  update public.contacts c
  set
    name = coalesce(row.cliente_nome, c.name),
    raw_data = row.item,
    status = 'hauzapp_prospect',
    hauzapp_cliente_id = row.cliente_id
  from rows row
  where c.organization_id = row.organization_id
    and (c.hauzapp_cliente_id = row.cliente_id or c.phone = row.phone)
  returning c.id
),
existing_conversations as (
  select distinct on (contact.id)
    contact.id as contact_id,
    conv.id
  from contact_rows contact
  join public.conversations conv
    on conv.organization_id = contact.organization_id
   and conv.contact_id = contact.id
   and coalesce(conv.channel, 'uazapi') = 'uazapi'
  order by contact.id, conv.created_at desc
),
inserted_conversations as (
  insert into public.conversations (
    organization_id,
    contact_id,
    campaign_id,
    status,
    current_stage,
    ai_enabled,
    channel,
    hauzapp_cliente_id,
    last_message_at
  )
  select
    contact.organization_id,
    contact.id,
    null,
    'open',
    'hauzapp_prospection',
    true,
    'uazapi',
    contact.hauzapp_cliente_id,
    now()
  from contact_rows contact
  where not exists (
    select 1
    from existing_conversations ec
    where ec.contact_id = contact.id
  )
  returning id, contact_id
),
conversation_rows as (
  select id, contact_id from existing_conversations
  union all
  select id, contact_id from inserted_conversations
),
updated_conversations as (
  update public.conversations conv
  set
    ai_enabled = true,
    current_stage = 'hauzapp_prospection',
    hauzapp_cliente_id = contact.hauzapp_cliente_id
  from contact_rows contact
  where conv.contact_id = contact.id
    and conv.organization_id = contact.organization_id
    and coalesce(conv.channel, 'uazapi') = 'uazapi'
  returning conv.id
),
existing_leads as (
  select l.id, l.hauzapp_cliente_id, l.phone
  from public.leads l
  join rows row
    on l.organization_id = row.organization_id
   and (
    l.hauzapp_cliente_id = row.cliente_id
    or l.phone = row.phone
   )
),
inserted_leads as (
  insert into public.leads (
    organization_id,
    contact_id,
    campaign_id,
    conversation_id,
    name,
    phone,
    source,
    qualification_status,
    score,
    summary,
    stage,
    hauzapp_cliente_id,
    hauzapp_stage_id,
    hauzapp_sent_at,
    last_stage_updated_at
  )
  select
    row.organization_id,
    contact.id,
    null,
    conv.id,
    row.cliente_nome,
    row.phone,
    'hauzapp'::public.lead_source,
    'new',
    case when row.temperature >= 2 then 80 when row.temperature = 1 then 55 else 30 end,
    'Lead importado da etapa ' || coalesce(row.stage_name, row.stage_id::text, 'Prospecção') || ' do HauzApp.',
    'hauzapp_prospection',
    row.cliente_id,
    row.stage_id,
    null,
    now()
  from rows row
  join contact_rows contact
    on contact.organization_id = row.organization_id
   and (contact.hauzapp_cliente_id = row.cliente_id or contact.phone = row.phone)
  join conversation_rows conv on conv.contact_id = contact.id
  where not exists (
    select 1
    from existing_leads lead
    where lead.hauzapp_cliente_id = row.cliente_id
       or lead.phone = row.phone
  )
  returning id
),
updated_leads as (
  update public.leads l
  set
    stage = case when l.stage in ('new', 'hauzapp_prospection') then 'hauzapp_prospection' else l.stage end,
    qualification_status = case when l.qualification_status = 'new' then 'new' else l.qualification_status end,
    hauzapp_stage_id = row.stage_id,
    summary = coalesce(l.summary, 'Lead importado da etapa ' || coalesce(row.stage_name, row.stage_id::text, 'Prospecção') || ' do HauzApp.'),
    last_stage_updated_at = now()
  from rows row
  where l.organization_id = row.organization_id
    and (l.hauzapp_cliente_id = row.cliente_id or l.phone = row.phone)
  returning l.id
),
log_row as (
  insert into public.integration_logs (
    organization_id,
    provider,
    target_type,
    status,
    request_payload,
    response_payload
  )
  select
    organization_id,
    'hauzapp',
    'n8n_prospection_sync',
    'done',
    jsonb_build_object('prospectionStageId', '__HAUZAPP_PROSPECTION_STAGE_ID__'),
    jsonb_build_object(
      'received', ${details.length},
      'matched', ${selected.length},
      'insertedLeads', (select count(*) from inserted_leads),
      'updatedLeads', (select count(*) from updated_leads)
    )
  from resolved_org
  where organization_id is not null
  returning id
)
select jsonb_build_object(
  'processed', true,
  'received', ${details.length},
  'matched', ${selected.length},
  'inserted_leads', (select count(*) from inserted_leads),
  'updated_leads', (select count(*) from updated_leads),
  'ai_enabled', true
) as response;
`;

return [{ json: { sql: query } }];
});

export default {
  name: "Pointer - 04 HauzApp Prospection Sync",
  nodes: [
    {
      parameters: {
        rule: {
          interval: [
            {
              field: "minutes",
              minutesInterval: 15
            }
          ]
        }
      },
      id: "cron-hauzapp-sync",
      name: "Every 15 Minutes",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [-900, -120]
    },
    {
      parameters: {
        httpMethod: "POST",
        path: "pointer/hauzapp-sync-now",
        responseMode: "responseNode",
        options: {}
      },
      id: "manual-hauzapp-sync",
      name: "Manual HauzApp Sync",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [-900, 120]
    },
    {
      parameters: {
        method: "POST",
        url: "__HAUZAPP_BASE_URL__?method=getAllNegociacoes",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "Content-Type", value: "application/json" }
          ]
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={\"chave\":\"__HAUZAPP_API_KEY__\"}",
        options: {}
      },
      id: "get-hauzapp-negotiations",
      name: "Get HauzApp Negotiations",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [-620, 0]
    },
    {
      parameters: {
        jsCode: buildImportSql
      },
      id: "build-import-sql",
      name: "Build Import SQL",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [-360, 0]
    },
    {
      parameters: {
        conditions: {
          boolean: [
            {
              value1: "={{$json.skip}}",
              value2: true
            }
          ]
        }
      },
      id: "skip-import",
      name: "Skip Import?",
      type: "n8n-nodes-base.if",
      typeVersion: 1,
      position: [-120, 0]
    },
    {
      parameters: {
        respondWith: "json",
        responseBody: "={{$json.response}}"
      },
      id: "respond-no-import",
      name: "Respond No Import",
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1.1,
      position: [160, -160]
    },
    {
      parameters: {
        operation: "executeQuery",
        query: "={{$json.sql}}"
      },
      id: "import-prospects",
      name: "Import Prospects",
      type: "n8n-nodes-base.postgres",
      typeVersion: 2.6,
      position: [160, 100],
      credentials: {
        postgres: {
          id: "__N8N_POSTGRES_CREDENTIAL_ID__",
          name: "__N8N_POSTGRES_CREDENTIAL_NAME__"
        }
      }
    },
    {
      parameters: {
        respondWith: "json",
        responseBody: "={{$json.response}}"
      },
      id: "respond-imported",
      name: "Respond Imported",
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1.1,
      position: [440, 100]
    }
  ],
  connections: {
    "Every 15 Minutes": {
      main: [[{ node: "Get HauzApp Negotiations", type: "main", index: 0 }]]
    },
    "Manual HauzApp Sync": {
      main: [[{ node: "Get HauzApp Negotiations", type: "main", index: 0 }]]
    },
    "Get HauzApp Negotiations": {
      main: [[{ node: "Build Import SQL", type: "main", index: 0 }]]
    },
    "Build Import SQL": {
      main: [[{ node: "Skip Import?", type: "main", index: 0 }]]
    },
    "Skip Import?": {
      main: [
        [{ node: "Respond No Import", type: "main", index: 0 }],
        [{ node: "Import Prospects", type: "main", index: 0 }]
      ]
    },
    "Import Prospects": {
      main: [[{ node: "Respond Imported", type: "main", index: 0 }]]
    }
  },
  settings: { executionOrder: "v1", saveExecutionProgress: true },
  active: false
};
