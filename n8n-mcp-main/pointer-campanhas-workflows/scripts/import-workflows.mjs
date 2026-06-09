import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const baseUrl = process.env.N8N_BASE_URL?.replace(/\/$/, "");
const apiKey = process.env.N8N_API_KEY;

if (!baseUrl || !apiKey) {
  console.error("Informe N8N_BASE_URL e N8N_API_KEY.");
  process.exit(1);
}

const workflowDir = resolve("workflows");
const files = (await readdir(workflowDir)).filter((file) => file.endsWith(".json")).sort();

for (const file of files) {
  const workflow = JSON.parse(await readFile(join(workflowDir, file), "utf8"));
  const response = await fetch(`${baseUrl}/api/v1/workflows`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-N8N-API-KEY": apiKey
    },
    body: JSON.stringify(workflow)
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error(`Falha ao importar ${file}:`, payload);
    process.exitCode = 1;
    continue;
  }

  console.log(`Importado: ${workflow.name} (${payload.id ?? "sem id"})`);
}
