import { readFile, readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

loadDotEnv(resolve("../../.env.local"));
loadDotEnv(resolve("../../.env.vercel.tmp"));

const baseUrl = process.env.N8N_BASE_URL?.replace(/\/$/, "");
const apiKey = process.env.N8N_API_KEY;

if (!baseUrl || !apiKey) {
  console.error("Informe N8N_BASE_URL e N8N_API_KEY.");
  process.exit(1);
}

const values = buildMaterializedValues();

const workflowDir = resolve("workflows");
const files = (await readdir(workflowDir))
  .filter((file) => file.endsWith(".json") || file.endsWith(".mjs"))
  .sort();
const existing = await listWorkflows();

for (const file of files) {
  const original = await loadWorkflow(join(workflowDir, file));
  const workflow = sanitizeWorkflow(materialize(original, values));
  const current = existing.find((item) => item.name === workflow.name);
  const method = current ? "PUT" : "POST";
  const url = current
    ? `${baseUrl}/api/v1/workflows/${current.id}`
    : `${baseUrl}/api/v1/workflows`;
  const wasActive = Boolean(current?.active);
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-N8N-API-KEY": apiKey
    },
    body: JSON.stringify(workflow)
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error(`Falha ao ${current ? "atualizar" : "importar"} ${file}:`, payload);
    process.exitCode = 1;
    continue;
  }

  if (wasActive) {
    await activateWorkflow(payload.id);
  }

  console.log(`${current ? "Atualizado" : "Importado"}: ${workflow.name} (${payload.id})`);
}

async function loadWorkflow(path) {
  if (path.endsWith(".mjs")) {
    const moduleUrl = `${pathToFileURL(path).href}?v=${Date.now()}`;
    const module = await import(moduleUrl);
    return module.default;
  }

  return JSON.parse(await readFile(path, "utf8"));
}

async function listWorkflows() {
  const response = await fetch(`${baseUrl}/api/v1/workflows?limit=250`, {
    headers: { "X-N8N-API-KEY": apiKey }
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.message || "Nao foi possivel listar workflows.");
  }

  return payload.data ?? [];
}

async function activateWorkflow(id) {
  await fetch(`${baseUrl}/api/v1/workflows/${id}/activate`, {
    method: "POST",
    headers: { "X-N8N-API-KEY": apiKey }
  }).catch(() => null);
}

function sanitizeWorkflow(workflow) {
  delete workflow.id;
  delete workflow.active;
  delete workflow.createdAt;
  delete workflow.updatedAt;
  delete workflow.versionId;
  delete workflow.tags;
  delete workflow.shared;
  return workflow;
}

function materialize(value, replacements) {
  if (typeof value === "string") {
    return materializeString(value, replacements);
  }

  if (Array.isArray(value)) {
    return value.map((item) => materialize(item, replacements));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, materialize(item, replacements)])
    );
  }

  return value;
}

function materializeString(input, replacements) {
  let output = input;

  for (const [key, value] of Object.entries(replacements)) {
    output = output
      .replaceAll(`__${key}__`, value)
      .replaceAll(`={{$env.${key}}}`, value)
      .replaceAll(`{{$env.${key}}}`, value)
      .replaceAll(`$env.${key}`, JSON.stringify(value));
  }

  if (output.startsWith("=Bearer ") && !output.includes("{{") && !output.includes("$json")) {
    return output.slice(1);
  }

  return output;
}

function buildMaterializedValues() {
  const pointerAppUrl =
    process.env.POINTER_APP_URL ||
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://pointer-campanhas.vercel.app";
  const n8nPublicWebhookBase =
    process.env.N8N_PUBLIC_WEBHOOK_BASE ||
    process.env.N8N_BASE_URL ||
    "https://n8n.growthailabs.com.br";

  return {
    POINTER_APP_URL: pointerAppUrl.replace(/\/$/, ""),
    N8N_PUBLIC_WEBHOOK_BASE: n8nPublicWebhookBase.replace(/\/$/, ""),
    POINTER_N8N_WEBHOOK_SECRET:
      process.env.POINTER_N8N_WEBHOOK_SECRET ||
      process.env.N8N_WEBHOOK_SECRET ||
      process.env.TRIGGER_SECRET_KEY ||
      process.env.CRON_SECRET ||
      "",
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
    OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-5-mini",
    SUPABASE_URL: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    N8N_POSTGRES_CREDENTIAL_ID:
      process.env.N8N_POSTGRES_CREDENTIAL_ID || "forN7iUdAHkHiWyM",
    N8N_POSTGRES_CREDENTIAL_NAME:
      process.env.N8N_POSTGRES_CREDENTIAL_NAME || "Pointer Supabase Postgres",
    META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN || "",
    META_PHONE_NUMBER_ID: process.env.META_PHONE_NUMBER_ID || "",
    UAZAPI_BASE_URL: process.env.UAZAPI_BASE_URL || "",
    UAZAPI_TOKEN: process.env.UAZAPI_TOKEN || ""
  };
}

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] ||= value;
  }
}
