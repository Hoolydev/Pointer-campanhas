function code(fn) {
  const source = fn.toString();
  return source.slice(source.indexOf("{") + 1, source.lastIndexOf("}")).trim();
}

const buildContextSql = code(function () {
function sql(value) {
  if (value === null || value === undefined || value === "") return "null";
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function json(value) {
  return sql(JSON.stringify(value ?? {}));
}

const body = $json.body || $json;
const channel = String(body.channel || "").toLowerCase();
const phone = String(body.phone || "").replace(/\D/g, "");
const text = String(body.text || "").trim();
const contactName = body.contactName || body.name || null;
const externalMessageId = body.externalMessageId || body.messageId || null;
const campaignId = body.campaignId || null;
const payload = body.payload || body;

if (!["meta", "uazapi"].includes(channel) || !phone || !text) {
  return [{
    json: {
      skip: true,
      response: {
        processed: false,
        reason: "missing_channel_phone_or_text",
        channel,
        phone
      }
    }
  }];
}

const query = `
with input as (
  select
    ${sql(channel)}::text as channel,
    ${sql(phone)}::text as phone,
    ${sql(text)}::text as content,
    ${sql(contactName)}::text as contact_name,
    ${sql(externalMessageId)}::text as external_message_id,
    ${campaignId ? `${sql(campaignId)}::uuid` : "null::uuid"} as campaign_id,
    ${json(payload)}::jsonb as payload
),
existing_contact as (
  select c.*
  from public.contacts c, input i
  where c.phone = i.phone
  order by c.created_at desc
  limit 1
),
org_from_integration as (
  select organization_id
  from public.integrations integ, input i
  where integ.active = true
    and (
      (i.channel = 'meta' and integ.provider = 'meta')
      or (i.channel = 'uazapi' and integ.provider = 'uazapi')
    )
  order by integ.created_at desc
  limit 1
),
org_fallback as (
  select id as organization_id
  from public.organizations
  order by created_at asc
  limit 1
),
resolved as (
  select
    coalesce(
      (select organization_id from existing_contact),
      (select organization_id from org_from_integration),
      (select organization_id from org_fallback)
    ) as organization_id
),
inserted_contact as (
  insert into public.contacts (
    organization_id,
    campaign_id,
    name,
    phone,
    raw_data,
    status
  )
  select
    r.organization_id,
    i.campaign_id,
    i.contact_name,
    i.phone,
    i.payload,
    case when i.channel = 'uazapi' then 'hauzapp_prospect' else 'responded' end
  from input i, resolved r
  where r.organization_id is not null
    and not exists (select 1 from existing_contact)
  returning *
),
contact_row as (
  select * from existing_contact
  union all
  select * from inserted_contact
  limit 1
),
campaign_row as (
  select c.*
  from public.campaigns c, input i, contact_row contact
  where c.id = coalesce(i.campaign_id, contact.campaign_id)
  limit 1
),
existing_conversation as (
  select conv.*
  from public.conversations conv, contact_row contact, input i
  where conv.contact_id = contact.id
    and coalesce(conv.channel, i.channel) = i.channel
  order by conv.created_at desc
  limit 1
),
inserted_conversation as (
  insert into public.conversations (
    organization_id,
    contact_id,
    campaign_id,
    status,
    current_stage,
    ai_enabled,
    channel,
    last_message_at,
    window_expires_at
  )
  select
    contact.organization_id,
    contact.id,
    coalesce((select id from campaign_row), contact.campaign_id),
    'open',
    case when i.channel = 'uazapi' then 'hauzapp_prospection' else 'recognition' end,
    true,
    i.channel,
    now(),
    case when i.channel = 'meta' then now() + interval '24 hours' else null end
  from contact_row contact, input i
  where not exists (select 1 from existing_conversation)
  returning *
),
conversation_row as (
  select * from existing_conversation
  union all
  select * from inserted_conversation
  limit 1
),
duplicate_message as (
  select exists (
    select 1
    from public.messages m, input i
    where i.external_message_id is not null
      and m.external_message_id = i.external_message_id
      and m.direction = 'inbound'
  ) as duplicate
),
insert_inbound as (
  insert into public.messages (
    organization_id,
    conversation_id,
    contact_id,
    direction,
    channel,
    type,
    content,
    status,
    external_message_id,
    payload
  )
  select
    conv.organization_id,
    conv.id,
    conv.contact_id,
    'inbound'::public.message_direction,
    i.channel::public.message_channel,
    'text'::public.message_type,
    i.content,
    'received',
    i.external_message_id,
    i.payload
  from conversation_row conv, input i, duplicate_message d
  where not d.duplicate
  returning id
),
touch_conversation as (
  update public.conversations conv
  set
    last_message_at = now(),
    window_expires_at = case when i.channel = 'meta' then now() + interval '24 hours' else conv.window_expires_at end
  from input i, conversation_row selected
  where conv.id = selected.id
  returning conv.*
),
uazapi_config as (
  select config
  from public.integrations integ, conversation_row conv
  where integ.organization_id = conv.organization_id
    and integ.provider = 'uazapi'
    and integ.active = true
  order by integ.created_at desc
  limit 1
),
hauzapp_config as (
  select config
  from public.integrations integ, conversation_row conv
  where integ.organization_id = conv.organization_id
    and integ.provider = 'hauzapp'
    and integ.active = true
  order by integ.created_at desc
  limit 1
),
agent_row as (
  select a.*
  from public.ai_agents a
  cross join conversation_row conv
  left join campaign_row campaign on true
  left join uazapi_config uazapi on true
  left join hauzapp_config hauzapp on true
  where a.organization_id = conv.organization_id
    and a.active = true
    and a.agent_type = 'lead_meta'
  order by
    (campaign.agent_id is not null and a.id = campaign.agent_id) desc,
    (nullif(hauzapp.config->>'leadAgentId', '') is not null and a.id::text = hauzapp.config->>'leadAgentId') desc,
    (nullif(uazapi.config->>'leadAgentId', '') is not null and a.id::text = uazapi.config->>'leadAgentId') desc,
    a.created_at desc
  limit 1
),
history as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object('direction', h.direction, 'content', h.content)
      order by h.created_at asc
    ),
    '[]'::jsonb
  ) as messages
  from (
    select m.direction, m.content, m.created_at
    from public.messages m, conversation_row conv
    where m.conversation_id = conv.id
    order by m.created_at desc
    limit 30
  ) h
),
agent_materials as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'title', am.title,
        'description', am.description,
        'media_type', am.media_type,
        'url', am.public_url
      )
    ),
    '[]'::jsonb
  ) as materials
  from public.agent_materials am, agent_row a
  where am.agent_id = a.id
    and am.organization_id = a.organization_id
    and am.active = true
),
campaign_materials as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'title', cm.title,
        'description', cm.description,
        'media_type', cm.media_type,
        'url', cm.media_url
      )
    ),
    '[]'::jsonb
  ) as materials
  from public.campaign_materials cm, campaign_row campaign
  where cm.campaign_id = campaign.id
    and cm.organization_id = campaign.organization_id
    and cm.active = true
),
select jsonb_build_object(
  'duplicate', (select duplicate from duplicate_message),
  'organization_id', conv.organization_id,
  'contact_id', conv.contact_id,
  'conversation_id', conv.id,
  'campaign_id', conv.campaign_id,
  'channel', i.channel,
  'phone', i.phone,
  'text', i.content,
  'contact_name', contact.name,
  'ai_enabled', conv.ai_enabled,
  'campaign', coalesce(to_jsonb(campaign), '{}'::jsonb),
  'agent', coalesce(to_jsonb(agent), '{}'::jsonb),
  'history', (select messages from history),
  'agent_materials', (select materials from agent_materials),
  'campaign_materials', (select materials from campaign_materials),
  'uazapi_config', coalesce((select config from uazapi_config), '{}'::jsonb),
  'hauzapp_cliente_id', coalesce(
    conv.hauzapp_cliente_id,
    contact.hauzapp_cliente_id,
    i.payload->>'hauzapp_cliente_id',
    i.payload->>'clienteID',
    i.payload->>'clienteId'
  )
) as context
from conversation_row conv
join contact_row contact on contact.id = conv.contact_id
cross join input i
left join campaign_row campaign on true
left join agent_row agent on true;
`;

return [{ json: { sql: query } }];
});

const buildAgentInput = code(function () {
const context = typeof $json.context === "string" ? JSON.parse($json.context) : $json.context;

if (!context || context.duplicate || !context.conversation_id || context.ai_enabled === false) {
  return [{
    json: {
      skip: true,
      response: {
        processed: true,
        skipped: true,
        reason: context?.duplicate ? "duplicate_message" : "missing_context_or_ai_disabled"
      }
    }
  }];
}

const agent = context.agent || {};
const campaign = context.campaign || {};
const history = Array.isArray(context.history) ? context.history : [];
const agentMaterials = Array.isArray(context.agent_materials) ? context.agent_materials : [];
const campaignMaterials = Array.isArray(context.campaign_materials) ? context.campaign_materials : [];
const materialLines = [...agentMaterials, ...campaignMaterials]
  .filter((item) => item && (item.title || item.url))
  .map((item) => `- ${item.title || "Material"} (${item.media_type || "arquivo"}): ${item.url || "arquivo interno"}${item.description ? ` - ${item.description}` : ""}`)
  .join("\n");

const systemPrompt = [
  agent.system_prompt || "Voce e um SDR imobiliario brasileiro. Responda curto, qualifique o lead e conduza para visita.",
  "",
  "Voce esta dentro do n8n, orquestrando o atendimento real do Pointer Campanhas.",
  "O lead respondeu a uma abordagem ativa. Nao trate como inbound generico.",
  "Responda em portugues do Brasil, com tom humano de WhatsApp, sem textao.",
  "Use no maximo uma pergunta por mensagem quando possivel.",
  "Se a ultima mensagem for apenas saudacao, responda com a saudacao configurada e pergunte como pode ajudar, sem empilhar qualificacao.",
  agent.greeting_template ? `Saudacao preferida: ${agent.greeting_template}` : "",
  agent.humanization_rules ? `Humanizacao:\n${agent.humanization_rules}` : "",
  agent.forbidden_phrases ? `Frases proibidas:\n${agent.forbidden_phrases}` : "",
  agent.conversation_examples ? `Exemplos bons:\n${agent.conversation_examples}` : "",
  agent.agent_skills ? `Skills:\n${agent.agent_skills}` : "",
  agent.qualification_criteria ? `Criterios de qualificacao:\n${agent.qualification_criteria}` : "",
  agent.handoff_instructions ? `Encaminhamento:\n${agent.handoff_instructions}` : "",
  materialLines ? `Materiais disponiveis quando o lead pedir:\n${materialLines}` : "",
  "Retorne apenas JSON valido no schema solicitado."
].filter(Boolean).join("\n");

const userPayload = {
  contact: { name: context.contact_name, phone: context.phone },
  channel: context.channel,
  campaign: {
    name: campaign.name,
    property_description: campaign.property_description,
    agent_prompt: campaign.agent_prompt
  },
  messages: history
};

return [{
  json: {
    context,
    openai: {
      model: agent.openai_model || "__OPENAI_MODEL__",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload) }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "pointer_lead_qualification",
          schema: {
            type: "object",
            additionalProperties: false,
            required: [
              "name",
              "phone",
              "interest",
              "region",
              "budget",
              "paymentMethod",
              "urgency",
              "intention",
              "qualificationStatus",
              "stage",
              "score",
              "summary",
              "qualified",
              "wantsVisit",
              "visitDatePreference",
              "reply"
            ],
            properties: {
              name: { type: ["string", "null"] },
              phone: { type: "string" },
              interest: { type: ["string", "null"] },
              region: { type: ["string", "null"] },
              budget: { type: ["number", "null"] },
              paymentMethod: { type: ["string", "null"] },
              urgency: { type: ["string", "null"] },
              intention: { type: "string", enum: ["compra", "aluguel", "investimento", "indefinido"] },
              qualificationStatus: { type: "string" },
              stage: { type: "string" },
              score: { type: "integer", minimum: 0, maximum: 100 },
              summary: { type: "string" },
              qualified: { type: "boolean" },
              wantsVisit: { type: "boolean" },
              visitDatePreference: { type: ["string", "null"] },
              reply: { type: "string" }
            }
          }
        }
      }
    }
  }
}];
});

const runOpenAiAgent = code(async function () {
function responseText(payload) {
  if (payload.output_text) return payload.output_text;
  for (const output of payload.output || []) {
    for (const content of output.content || []) {
      if (typeof content.text === "string") return content.text;
    }
  }
  return "";
}

function heuristic(context) {
  const text = String(context.text || "").toLowerCase().trim();
  const greetingOnly = /^(oi|ola|olá|bom dia|boa tarde|boa noite|opa|e ai|e aí)[\s!.]*$/i.test(text);
  const wantsVisit = /visita|decorado|conhecer|agenda|agendar|marcar|hor[aá]rio|posso ir|consigo ir/.test(text);
  const budgetMatch = text.match(/(?:r\$|rs)?\s?(\d{3,}(?:[\.,]\d{3})*)/i);
  const budget = budgetMatch?.[1] ? Number(budgetMatch[1].replace(/\./g, "").replace(",", ".")) : null;
  const score = Math.min(100, 35 + (budget ? 25 : 0) + (wantsVisit ? 35 : 0) + (/invest/.test(text) ? 10 : 0));
  const qualified = score >= 70 || wantsVisit;
  const agent = context.agent || {};
  return {
    name: context.contact_name || null,
    phone: context.phone,
    interest: context.campaign?.property_description || null,
    region: null,
    budget,
    paymentMethod: null,
    urgency: null,
    intention: /invest/.test(text) ? "investimento" : /alug/.test(text) ? "aluguel" : /compr/.test(text) ? "compra" : "indefinido",
    qualificationStatus: qualified ? "qualified" : "qualifying",
    stage: qualified ? "qualified" : "qualifying",
    score,
    summary: text ? `Lead respondeu: ${text.slice(0, 220)}` : "Lead com poucas informacoes.",
    qualified,
    wantsVisit,
    visitDatePreference: null,
    reply: greetingOnly
      ? (agent.greeting_template || "Olá, obrigado por responder. Como posso te ajudar?")
      : qualified
        ? (agent.handoff_instructions || "Perfeito, ja tenho informacoes suficientes. Vou encaminhar seu atendimento para um especialista.")
        : "Perfeito. Me conta rapidinho: voce esta olhando mais para morar ou investir?"
  };
}

const context = $json.context;
let qualification;
let openaiError = null;

try {
  if (!"__OPENAI_API_KEY__") throw new Error("OPENAI_API_KEY ausente no workflow materializado.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: "Bearer __OPENAI_API_KEY__",
      "Content-Type": "application/json"
    },
    body: JSON.stringify($json.openai)
  });
  const payload = await response.json().catch(() => ({}));
  const text = responseText(payload);
  if (!response.ok || !text) throw new Error(payload.error?.message || "OpenAI nao retornou texto.");
  qualification = JSON.parse(text);
} catch (error) {
  openaiError = error instanceof Error ? error.message : "Erro desconhecido na OpenAI.";
  qualification = heuristic(context);
}

qualification.phone = qualification.phone || context.phone;
qualification.name = qualification.name ?? context.contact_name ?? null;
qualification.score = Math.max(0, Math.min(100, Number(qualification.score || 0)));
qualification.qualified = Boolean(qualification.qualified);
qualification.wantsVisit = Boolean(qualification.wantsVisit);
qualification.reply = String(qualification.reply || "Certo. Como posso te ajudar?").trim();

return [{ json: { context, qualification, openaiError } }];
});

const buildSaveSql = code(function () {
function sql(value) {
  if (value === null || value === undefined || value === "") return "null";
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function json(value) {
  return sql(JSON.stringify(value ?? {}));
}

const context = $json.context;
const q = $json.qualification;
const openaiError = $json.openaiError || null;

const query = `
with input as (
  select
    ${json(context)}::jsonb as ctx,
    ${json(q)}::jsonb as q,
    ${sql(openaiError)}::text as openai_error
),
lead_existing as (
  select l.*
  from public.leads l, input i
  where l.organization_id = (i.ctx->>'organization_id')::uuid
    and l.conversation_id = (i.ctx->>'conversation_id')::uuid
  limit 1
),
updated_lead as (
  update public.leads l
  set
    name = nullif(i.q->>'name', ''),
    phone = coalesce(nullif(i.q->>'phone', ''), i.ctx->>'phone'),
    interest = nullif(i.q->>'interest', ''),
    region = nullif(i.q->>'region', ''),
    budget = case when jsonb_typeof(i.q->'budget') = 'number' then (i.q->>'budget')::numeric else null end,
    payment_method = nullif(i.q->>'paymentMethod', ''),
    qualification_status = coalesce(nullif(i.q->>'qualificationStatus', ''), 'qualifying'),
    score = greatest(0, least(100, coalesce((i.q->>'score')::int, 0))),
    summary = coalesce(nullif(i.q->>'summary', ''), l.summary),
    stage = coalesce(nullif(i.q->>'stage', ''), l.stage),
    hauzapp_cliente_id = coalesce(l.hauzapp_cliente_id, nullif(i.ctx->>'hauzapp_cliente_id', '')),
    last_stage_updated_at = now()
  from input i, lead_existing existing
  where l.id = existing.id
  returning l.*
),
inserted_lead as (
  insert into public.leads (
    organization_id,
    contact_id,
    campaign_id,
    conversation_id,
    name,
    phone,
    source,
    interest,
    region,
    budget,
    payment_method,
    qualification_status,
    score,
    summary,
    stage,
    hauzapp_cliente_id,
    last_stage_updated_at
  )
  select
    (ctx->>'organization_id')::uuid,
    (ctx->>'contact_id')::uuid,
    nullif(ctx->>'campaign_id', '')::uuid,
    (ctx->>'conversation_id')::uuid,
    nullif(q->>'name', ''),
    coalesce(nullif(q->>'phone', ''), ctx->>'phone'),
    case when ctx->>'channel' = 'uazapi' then 'hauzapp' else 'campaign' end::public.lead_source,
    nullif(q->>'interest', ''),
    nullif(q->>'region', ''),
    case when jsonb_typeof(q->'budget') = 'number' then (q->>'budget')::numeric else null end,
    nullif(q->>'paymentMethod', ''),
    coalesce(nullif(q->>'qualificationStatus', ''), 'qualifying'),
    greatest(0, least(100, coalesce((q->>'score')::int, 0))),
    nullif(q->>'summary', ''),
    coalesce(nullif(q->>'stage', ''), 'qualifying'),
    nullif(ctx->>'hauzapp_cliente_id', ''),
    now()
  from input
  where not exists (select 1 from lead_existing)
  returning *
),
lead_row as (
  select * from updated_lead
  union all
  select * from inserted_lead
  limit 1
),
touch_conversation as (
  update public.conversations conv
  set
    current_stage = coalesce(nullif(i.q->>'stage', ''), conv.current_stage),
    last_message_at = now()
  from input i
  where conv.id = (i.ctx->>'conversation_id')::uuid
  returning conv.id
),
outbound_message as (
  insert into public.messages (
    organization_id,
    conversation_id,
    contact_id,
    direction,
    channel,
    type,
    content,
    status,
    payload
  )
  select
    (ctx->>'organization_id')::uuid,
    (ctx->>'conversation_id')::uuid,
    (ctx->>'contact_id')::uuid,
    'outbound'::public.message_direction,
    (ctx->>'channel')::public.message_channel,
    'text'::public.message_type,
    q->>'reply',
    'created',
    jsonb_build_object('qualification', q, 'openai_error', openai_error, 'runner', 'n8n_lead_ai_brain')
  from input
  returning id
),
qualified_job as (
  insert into public.scheduled_jobs (
    organization_id,
    job_type,
    target_id,
    status,
    run_at,
    payload
  )
  select
    lead.organization_id,
    'hauzapp_create_qualified_lead',
    lead.id,
    'pending',
    now(),
    jsonb_build_object('reason', 'n8n_ai_qualified')
  from lead_row lead, input i
  where coalesce((i.q->>'qualified')::boolean, false) = true
    and lead.hauzapp_sent_at is null
    and lead.hauzapp_cliente_id is null
    and not exists (
      select 1
      from public.scheduled_jobs job
      where job.organization_id = lead.organization_id
        and job.job_type = 'hauzapp_create_qualified_lead'
        and job.target_id = lead.id
        and job.status in ('pending', 'running')
    )
  on conflict do nothing
  returning id
)
select jsonb_build_object(
  'processed', true,
  'organization_id', lead.organization_id,
  'lead_id', lead.id,
  'message_id', (select id from outbound_message),
  'conversation_id', lead.conversation_id,
  'contact_id', lead.contact_id,
  'channel', ctx->>'channel',
  'phone', ctx->>'phone',
  'reply', q->>'reply',
  'qualified', coalesce((q->>'qualified')::boolean, false),
  'stage', q->>'stage',
  'hauzapp_cliente_id', lead.hauzapp_cliente_id,
  'hauzapp_stage_id', lead.hauzapp_stage_id,
  'message_split_enabled', coalesce((ctx->'agent'->>'message_split_enabled')::boolean, true),
  'typing_words_per_minute', coalesce((ctx->'agent'->>'typing_words_per_minute')::int, 150),
  'uazapi_config', ctx->'uazapi_config',
  'openai_error', openai_error
) as outbound
from input, lead_row lead;
`;

return [{ json: { sql: query } }];
});

const syncHauzappStage = code(async function () {
const outbound = typeof $json.outbound === "string" ? JSON.parse($json.outbound) : $json.outbound;
const clienteId = outbound?.hauzapp_cliente_id;
const currentStageId = Number(outbound?.hauzapp_stage_id);
const contactStageId = Number("__HAUZAPP_CONTACT_STAGE_ID__");
const qualifiedStageId = Number("__HAUZAPP_QUALIFIED_STAGE_ID__");
const targetStageId = outbound?.qualified ? qualifiedStageId : contactStageId;

if (outbound?.channel !== "uazapi" || !clienteId || !targetStageId || currentStageId === targetStageId) {
  return [{ json: { outbound } }];
}

try {
  const baseUrl = "__HAUZAPP_BASE_URL__";
  const apiKey = "__HAUZAPP_API_KEY__";
  if (!baseUrl || !apiKey) throw new Error("HauzApp credentials are missing");
  const response = await fetch(`${baseUrl}?method=changeNegociacaoEtapa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chave: apiKey,
      clienteID: Number(clienteId),
      funilStageID: targetStageId
    })
  });
  const payload = await response.json().catch(() => ({}));
  const accepted = response.ok && ["success", "etapa_already"].includes(String(payload.response || ""));
  outbound.hauzapp_stage_sync = {
    attempted: true,
    ok: accepted,
    target_stage_id: targetStageId,
    response: payload
  };
  if (accepted) {
    outbound.hauzapp_target_stage_id = targetStageId;
  }
} catch (error) {
  outbound.hauzapp_stage_sync = {
    attempted: true,
    ok: false,
    target_stage_id: targetStageId,
    error: error instanceof Error ? error.message : "Erro desconhecido ao alterar etapa no HauzApp"
  };
}

return [{ json: { outbound } }];
});

const sendReply = code(async function () {
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitMessage(text, enabled) {
  const clean = String(text || "").trim();
  if (!enabled || clean.length < 180) return [clean].filter(Boolean);
  const chunks = clean
    .split(/\n{2,}|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const out = [];
  let current = "";
  for (const chunk of chunks) {
    if ((current + " " + chunk).trim().length > 260 && current) {
      out.push(current);
      current = chunk;
    } else {
      current = (current + " " + chunk).trim();
    }
  }
  if (current) out.push(current);
  return out.slice(0, 4);
}

const outbound = typeof $json.outbound === "string" ? JSON.parse($json.outbound) : $json.outbound;
const segments = splitMessage(outbound.reply, outbound.message_split_enabled);
const results = [];

for (const [index, segment] of segments.entries()) {
  if (index > 0) {
    const words = segment.split(/\s+/).length;
    const wpm = Number(outbound.typing_words_per_minute || 150);
    await sleep(Math.min(9000, Math.max(1200, Math.round((words / wpm) * 60 * 1000))));
  }

  if (outbound.channel === "meta") {
    const response = await fetch("https://graph.facebook.com/v21.0/__META_PHONE_NUMBER_ID__/messages", {
      method: "POST",
      headers: {
        Authorization: "Bearer __META_ACCESS_TOKEN__",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: outbound.phone,
        type: "text",
        text: {
          preview_url: false,
          body: segment
        }
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || "Meta send failed");
    results.push({ channel: "meta", segment, payload, externalMessageId: payload.messages?.[0]?.id || null });
  } else {
    const config = outbound.uazapi_config || {};
    const baseUrl = config.baseUrl || config.base_url || "__UAZAPI_BASE_URL__";
    const token = config.token || config.apiKey || config.api_key || "__UAZAPI_TOKEN__";
    if (!baseUrl || !token) throw new Error("Uazapi credentials are missing");
    const response = await fetch(`${String(baseUrl).replace(/\/$/, "")}/send-message`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        phone: outbound.phone,
        message: segment
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "Uazapi send failed");
    results.push({ channel: "uazapi", segment, payload, externalMessageId: payload.id || payload.messageId || null });
  }
}

return [{ json: { outbound, results } }];
});

const buildDeliverySql = code(function () {
function sql(value) {
  if (value === null || value === undefined || value === "") return "null";
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function json(value) {
  return sql(JSON.stringify(value ?? {}));
}

const outbound = $json.outbound;
const results = $json.results || [];
const externalMessageId = results.find((item) => item.externalMessageId)?.externalMessageId || null;
const hauzappTargetStageId = outbound.hauzapp_target_stage_id ? Number(outbound.hauzapp_target_stage_id) : null;

const query = `
with message_update as (
update public.messages
set
  status = 'sent',
  external_message_id = ${sql(externalMessageId)},
  payload = coalesce(payload, '{}'::jsonb) || ${json({ sendResults: results, hauzappStageSync: outbound.hauzapp_stage_sync || null })}::jsonb
where id = ${sql(outbound.message_id)}::uuid
returning id
),
lead_update as (
  update public.leads
  set
    hauzapp_stage_id = coalesce(${hauzappTargetStageId ?? "null"}::int, hauzapp_stage_id),
    last_stage_updated_at = case when ${hauzappTargetStageId ?? "null"}::int is null then last_stage_updated_at else now() end
  where id = ${sql(outbound.lead_id)}::uuid
  returning id
)
select jsonb_build_object(
  'processed', true,
  'sent', true,
  'lead_id', ${sql(outbound.lead_id)},
  'conversation_id', ${sql(outbound.conversation_id)},
  'segments', ${results.length},
  'hauzapp_stage_sync', ${json(outbound.hauzapp_stage_sync || null)}::jsonb
) as response;
`;

return [{ json: { sql: query } }];
});

export default {
  name: "Pointer - 07 Lead AI Brain",
  nodes: [
    {
      parameters: {
        httpMethod: "POST",
        path: "pointer/lead-ai-brain",
        responseMode: "responseNode",
        options: {}
      },
      id: "webhook-lead-ai-brain",
      name: "Webhook Lead AI Brain",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [-1180, 0]
    },
    {
      parameters: {
        jsCode: buildContextSql
      },
      id: "build-context-sql",
      name: "Build Context SQL",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [-940, 0]
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
      id: "should-skip-before-db",
      name: "Skip Before DB?",
      type: "n8n-nodes-base.if",
      typeVersion: 1,
      position: [-700, 0]
    },
    {
      parameters: {
        respondWith: "json",
        responseBody: "={{$json.response}}"
      },
      id: "respond-skipped-before-db",
      name: "Respond Skipped Before DB",
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1.1,
      position: [-460, -180]
    },
    {
      parameters: {
        operation: "executeQuery",
        query: "={{$json.sql}}"
      },
      id: "load-context",
      name: "Load Context",
      type: "n8n-nodes-base.postgres",
      typeVersion: 2.6,
      position: [-460, 80],
      credentials: {
        postgres: {
          id: "__N8N_POSTGRES_CREDENTIAL_ID__",
          name: "__N8N_POSTGRES_CREDENTIAL_NAME__"
        }
      }
    },
    {
      parameters: {
        jsCode: buildAgentInput
      },
      id: "build-agent-input",
      name: "Build Agent Input",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [-220, 80]
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
      id: "should-skip-agent",
      name: "Skip Agent?",
      type: "n8n-nodes-base.if",
      typeVersion: 1,
      position: [20, 80]
    },
    {
      parameters: {
        respondWith: "json",
        responseBody: "={{$json.response}}"
      },
      id: "respond-skipped-agent",
      name: "Respond Skipped Agent",
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1.1,
      position: [260, -100]
    },
    {
      parameters: {
        jsCode: runOpenAiAgent
      },
      id: "run-openai-agent",
      name: "Run OpenAI Agent",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [260, 180]
    },
    {
      parameters: {
        jsCode: buildSaveSql
      },
      id: "build-save-sql",
      name: "Build Save SQL",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [500, 180]
    },
    {
      parameters: {
        operation: "executeQuery",
        query: "={{$json.sql}}"
      },
      id: "save-ai-result",
      name: "Save AI Result",
      type: "n8n-nodes-base.postgres",
      typeVersion: 2.6,
      position: [740, 180],
      credentials: {
        postgres: {
          id: "__N8N_POSTGRES_CREDENTIAL_ID__",
          name: "__N8N_POSTGRES_CREDENTIAL_NAME__"
        }
      }
    },
    {
      parameters: {
        jsCode: sendReply
      },
      id: "send-whatsapp-reply",
      name: "Send WhatsApp Reply",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1220, 180]
    },
    {
      parameters: {
        jsCode: syncHauzappStage
      },
      id: "sync-hauzapp-stage",
      name: "Sync HauzApp Stage",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [980, 180]
    },
    {
      parameters: {
        jsCode: buildDeliverySql
      },
      id: "build-delivery-sql",
      name: "Build Delivery SQL",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1220, 180]
    },
    {
      parameters: {
        operation: "executeQuery",
        query: "={{$json.sql}}"
      },
      id: "save-delivery",
      name: "Save Delivery",
      type: "n8n-nodes-base.postgres",
      typeVersion: 2.6,
      position: [1460, 180],
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
      id: "respond-processed",
      name: "Respond Processed",
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1.1,
      position: [1700, 180]
    }
  ],
  connections: {
    "Webhook Lead AI Brain": {
      main: [[{ node: "Build Context SQL", type: "main", index: 0 }]]
    },
    "Build Context SQL": {
      main: [[{ node: "Skip Before DB?", type: "main", index: 0 }]]
    },
    "Skip Before DB?": {
      main: [
        [{ node: "Respond Skipped Before DB", type: "main", index: 0 }],
        [{ node: "Load Context", type: "main", index: 0 }]
      ]
    },
    "Load Context": {
      main: [[{ node: "Build Agent Input", type: "main", index: 0 }]]
    },
    "Build Agent Input": {
      main: [[{ node: "Skip Agent?", type: "main", index: 0 }]]
    },
    "Skip Agent?": {
      main: [
        [{ node: "Respond Skipped Agent", type: "main", index: 0 }],
        [{ node: "Run OpenAI Agent", type: "main", index: 0 }]
      ]
    },
    "Run OpenAI Agent": {
      main: [[{ node: "Build Save SQL", type: "main", index: 0 }]]
    },
    "Build Save SQL": {
      main: [[{ node: "Save AI Result", type: "main", index: 0 }]]
    },
    "Save AI Result": {
      main: [[{ node: "Sync HauzApp Stage", type: "main", index: 0 }]]
    },
    "Sync HauzApp Stage": {
      main: [[{ node: "Send WhatsApp Reply", type: "main", index: 0 }]]
    },
    "Send WhatsApp Reply": {
      main: [[{ node: "Build Delivery SQL", type: "main", index: 0 }]]
    },
    "Build Delivery SQL": {
      main: [[{ node: "Save Delivery", type: "main", index: 0 }]]
    },
    "Save Delivery": {
      main: [[{ node: "Respond Processed", type: "main", index: 0 }]]
    }
  },
  settings: { executionOrder: "v1", saveExecutionProgress: true },
  active: false
};
