function code(fn) {
  const source = fn.toString();
  return source.slice(source.indexOf("{") + 1, source.lastIndexOf("}")).trim();
}

const buildDispatchItems = code(function () {
const secret = "__POINTER_N8N_WEBHOOK_SECRET__";
const auth = $json.headers?.authorization || $json.headers?.Authorization || "";

if (secret && auth !== `Bearer ${secret}`) {
  throw new Error("Unauthorized");
}

const body = $json.body || $json;
const campaign = body.campaign || {};
const contacts = Array.isArray(body.contacts) ? body.contacts : [];
const strategy = body.uazapiInstanceStrategy || "round_robin";
const minDelay = Math.max(10, Number(body.minDelaySeconds || campaign.minDelaySeconds || 90));
const maxDelay = Math.max(minDelay, Number(body.maxDelaySeconds || campaign.maxDelaySeconds || 240));
const now = new Date();
const currentHour = new Date(now);
currentHour.setMinutes(0, 0, 0);

if (!campaign.id || !body.organizationId) {
  throw new Error("campaign/organization ausentes");
}

if (!contacts.length) {
  return [];
}

function hourCount(instance) {
  const bucket = instance.sentCurrentHourBucket ? new Date(instance.sentCurrentHourBucket) : null;
  return bucket && bucket.getTime() === currentHour.getTime() ? Number(instance.sentCurrentHour || 0) : 0;
}

function hourlyLimit(instance) {
  return Math.max(1, Math.min(20, Number(instance.hourlyLimit || body.hourlyLimitPerInstance || 20)));
}

const instances = (body.uazapiInstances || [])
  .filter((instance) => instance?.id && instance?.baseUrl && instance?.token)
  .slice(0, 5)
  .map((instance) => ({
    ...instance,
    hourlyLimit: hourlyLimit(instance),
    sentCurrentHour: hourCount(instance)
  }));

if (campaign.dispatchChannel === "uazapi" && instances.length === 0) {
  throw new Error("Nenhuma instancia Uazapi ativa no payload");
}

const assigned = new Map();

function nextInstance(index) {
  if (!instances.length) return null;
  if (strategy === "least_recent") {
    return [...instances].sort((a, b) => {
      const assignedA = assigned.get(a.id) || 0;
      const assignedB = assigned.get(b.id) || 0;
      const pressureA = (a.sentCurrentHour + assignedA) / a.hourlyLimit;
      const pressureB = (b.sentCurrentHour + assignedB) / b.hourlyLimit;
      if (pressureA !== pressureB) return pressureA - pressureB;
      return new Date(a.lastSentAt || 0).getTime() - new Date(b.lastSentAt || 0).getTime();
    })[0];
  }
  return instances[index % instances.length];
}

return contacts.map((contact, index) => {
  const instance = campaign.dispatchChannel === "uazapi" ? nextInstance(index) : null;
  let delaySeconds = Math.floor(minDelay + Math.random() * Math.max(1, maxDelay - minDelay));

  if (instance) {
    const instanceCount = assigned.get(instance.id) || 0;
    assigned.set(instance.id, instanceCount + 1);
    const slotIndex = Number(instance.sentCurrentHour || 0) + instanceCount;
    const hourOffset = Math.floor(slotIndex / instance.hourlyLimit) * 3600;
    const slotInHour = slotIndex % instance.hourlyLimit;
    const rateSpacing = Math.ceil(3600 / instance.hourlyLimit);
    delaySeconds += hourOffset + slotInHour * rateSpacing;
  } else {
    delaySeconds += index * Math.floor(minDelay + Math.random() * Math.max(1, maxDelay - minDelay));
  }

  return {
    json: {
      body,
      campaign,
      contact,
      instance,
      meta: body.meta || {},
      delaySeconds
    }
  };
});
});

const sendAndBuildSql = code(async function () {
function sql(value) {
  if (value === null || value === undefined || value === "") return "null";
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function json(value) {
  return sql(JSON.stringify(value ?? {}));
}

function renderTemplate(template, contact) {
  const name = contact.name || "";
  return String(template || "Ola, {{nome}}. Obrigado por responder. Como posso te ajudar?")
    .replace(/{{\s*nome\s*}}/gi, name)
    .replace(/{{\s*name\s*}}/gi, name)
    .replace(/{{\s*telefone\s*}}/gi, contact.phone || "")
    .replace(/{{\s*phone\s*}}/gi, contact.phone || "");
}

async function parsePayload(response) {
  const text = await response.text().catch(() => "");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

const campaign = $json.campaign;
const contact = $json.contact;
const instance = $json.instance || null;
const meta = $json.meta || {};
const channel = campaign.dispatchChannel === "uazapi" ? "uazapi" : "meta";
let ok = false;
let payload = {};
let error = null;
let externalMessageId = null;
let content = "";

try {
  if (channel === "meta") {
    content = `[template] ${campaign.metaTemplateName}`;
    const response = await fetch(`https://graph.facebook.com/v21.0/${meta.phoneNumberId || campaign.metaPhoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${meta.accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: contact.phone,
        type: "template",
        template: {
          name: campaign.metaTemplateName,
          language: { code: campaign.metaTemplateLanguage || "pt_BR" },
          components: contact.components || []
        }
      })
    });
    payload = await parsePayload(response);
    ok = response.ok;
    externalMessageId = payload.messages?.[0]?.id || null;
    if (!ok) error = payload.error?.message || response.statusText;
  } else {
    content = renderTemplate(campaign.initialMessage, contact);
    const response = await fetch(`${String(instance.baseUrl).replace(/\/$/, "")}/send-message`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${instance.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        phone: contact.phone,
        message: content,
        instanceKey: instance.instanceKey || undefined
      })
    });
    payload = await parsePayload(response);
    ok = response.ok;
    externalMessageId = payload.id || payload.messageId || payload.message_id || null;
    if (!ok) error = payload.message || payload.error || response.statusText;
  }
} catch (sendError) {
  error = sendError instanceof Error ? sendError.message : "Erro desconhecido no envio";
  payload = { error };
}

const status = ok ? "sent" : "failed";
const messageStatus = ok ? "sent" : "failed";
const query = `
with contact_row as (
  select c.*
  from public.contacts c
  where c.id = ${sql(contact.id)}::uuid
  limit 1
),
campaign_row as (
  select *
  from public.campaigns
  where id = ${sql(campaign.id)}::uuid
  limit 1
),
existing_conversation as (
  select conv.*
  from public.conversations conv, contact_row contact
  where conv.contact_id = contact.id
    and conv.campaign_id = ${sql(campaign.id)}::uuid
    and coalesce(conv.channel, ${sql(channel)}) = ${sql(channel)}
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
    last_message_at
  )
  select
    contact.organization_id,
    contact.id,
    ${sql(campaign.id)}::uuid,
    'open',
    'recognition',
    true,
    ${sql(channel)},
    now()
  from contact_row contact
  where not exists (select 1 from existing_conversation)
  returning *
),
conversation_row as (
  select * from existing_conversation
  union all
  select * from inserted_conversation
  limit 1
),
message_row as (
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
    contact.organization_id,
    conv.id,
    contact.id,
    'outbound'::public.message_direction,
    ${sql(channel)}::public.message_channel,
    case when ${sql(channel)} = 'meta' then 'template' else 'text' end::public.message_type,
    ${sql(content)},
    ${sql(messageStatus)},
    ${sql(externalMessageId)},
    ${json({
      n8n: true,
      campaignDispatch: true,
      ok,
      error,
      response: payload,
      instance: instance ? { id: instance.id, name: instance.name, phone: instance.phone } : null
    })}::jsonb
  from contact_row contact
  join conversation_row conv on conv.contact_id = contact.id
  returning id
),
contact_update as (
  update public.contacts
  set status = ${sql(status)}
  where id = ${sql(contact.id)}::uuid
  returning id
),
campaign_update as (
  update public.campaigns
  set status = case when status = 'draft' then 'active' else status end
  where id = ${sql(campaign.id)}::uuid
  returning id
),
instance_update as (
  update public.whatsapp_instances
  set
    sent_today = case when sent_today_date = current_date then sent_today + 1 else 1 end,
    sent_today_date = current_date,
    sent_current_hour = case
      when sent_current_hour_bucket = date_trunc('hour', now()) then sent_current_hour + 1
      else 1
    end,
    sent_current_hour_bucket = date_trunc('hour', now()),
    last_sent_at = now(),
    updated_at = now()
  where ${ok && instance?.id ? `${sql(instance.id)}::uuid` : "null::uuid"} is not null
    and id = ${ok && instance?.id ? `${sql(instance.id)}::uuid` : "null::uuid"}
  returning id
)
select jsonb_build_object(
  'processed', true,
  'sent', ${ok ? "true" : "false"},
  'contact_id', ${sql(contact.id)},
  'status', ${sql(status)},
  'channel', ${sql(channel)},
  'instance_id', ${sql(instance?.id || null)},
  'error', ${sql(error)}
) as response;
`;

return [{ json: { sql: query, response: { ok, status, contactId: contact.id, error } } }];
});

export default {
  name: "Pointer - 01 Campaign Dispatch Router",
  nodes: [
    {
      parameters: {
        httpMethod: "POST",
        path: "pointer/campaign-dispatch",
        responseMode: "onReceived",
        responseData: "firstEntryJson",
        options: {}
      },
      id: "webhook-campaign-dispatch",
      name: "Webhook Campaign Dispatch",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [-900, 0]
    },
    {
      parameters: { jsCode: buildDispatchItems },
      id: "build-dispatch-items",
      name: "Build Dispatch Items",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [-620, 0]
    },
    {
      parameters: {
        amount: "={{$json.delaySeconds}}",
        unit: "seconds"
      },
      id: "humanized-wait",
      name: "Humanized Wait",
      type: "n8n-nodes-base.wait",
      typeVersion: 1.1,
      position: [-340, 0],
      webhookId: "pointer-campaign-wait"
    },
    {
      parameters: { jsCode: sendAndBuildSql },
      id: "send-and-build-sql",
      name: "Send Message and Build SQL",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [-80, 0]
    },
    {
      parameters: {
        operation: "executeQuery",
        query: "={{$json.sql}}"
      },
      id: "save-dispatch-result",
      name: "Save Dispatch Result",
      type: "n8n-nodes-base.postgres",
      typeVersion: 2.6,
      position: [180, 0],
      credentials: {
        postgres: {
          id: "__N8N_POSTGRES_CREDENTIAL_ID__",
          name: "__N8N_POSTGRES_CREDENTIAL_NAME__"
        }
      }
    }
  ],
  connections: {
    "Webhook Campaign Dispatch": {
      main: [[{ node: "Build Dispatch Items", type: "main", index: 0 }]]
    },
    "Build Dispatch Items": {
      main: [[{ node: "Humanized Wait", type: "main", index: 0 }]]
    },
    "Humanized Wait": {
      main: [[{ node: "Send Message and Build SQL", type: "main", index: 0 }]]
    },
    "Send Message and Build SQL": {
      main: [[{ node: "Save Dispatch Result", type: "main", index: 0 }]]
    }
  },
  settings: { executionOrder: "v1", saveExecutionProgress: true },
  active: false
};
