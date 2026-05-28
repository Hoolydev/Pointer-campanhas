const DEFAULT_BASE_URL = "https://hauzhub.com.br/requisicao/api/integracao.php";

type HauzappResponse<T = unknown> = {
  response: string;
  details?: T;
};

export type HauzappBroker = {
  corretorID: string;
  corretorNome: string;
  corretorEmail?: string;
  corretorPhone?: string;
  corretorBlocked?: string;
  corretorRodizioBlocked?: string;
};

export type HauzappNegotiation = {
  clienteID: string;
  clienteNome: string;
  clienteTelefone: string;
  clienteFunilStageID?: string;
  clienteFunilStage?: string;
  clienteTemperature?: string;
  corretorID?: string;
  corretorName?: string;
};

export type AddNegocioInput = {
  contatoNome: string;
  contatoPhone: string;
  contatoEmail?: string | null;
  negocioPrice?: string | null;
  negocioApelido?: string | null;
  negocioTemperature?: 0 | 1 | 2;
};

export type HauzappIntegrationConfig = {
  baseUrl?: string | null;
  apiKey?: string | null;
  chave?: string | null;
};

export async function hauzappRequest<T>(
  method: string,
  body: Record<string, unknown> = {},
  integrationConfig?: HauzappIntegrationConfig
) {
  const baseUrl = integrationConfig?.baseUrl || process.env.HAUZAPP_BASE_URL || DEFAULT_BASE_URL;
  const chave = integrationConfig?.apiKey || integrationConfig?.chave || process.env.HAUZAPP_API_KEY;

  if (!chave) {
    throw new Error("HAUZAPP_API_KEY is missing.");
  }

  const response = await fetch(`${baseUrl}?method=${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chave,
      ...body
    })
  });

  const payload = (await response.json().catch(() => ({}))) as HauzappResponse<T>;

  if (!response.ok || payload.response !== "success") {
    throw new Error(`HauzApp ${method} failed: ${payload.response || response.status}`);
  }

  return payload;
}

export async function addNegocio(input: AddNegocioInput, integrationConfig?: HauzappIntegrationConfig) {
  return hauzappRequest("addNegocio", {
    contatoNome: input.contatoNome,
    contatoPhone: formatPhoneForHauzapp(input.contatoPhone),
    contatoEmail: input.contatoEmail || undefined,
    negocioPrice: input.negocioPrice || undefined,
    negocioApelido: input.negocioApelido || undefined,
    negocioTemperature: input.negocioTemperature ?? 2
  }, integrationConfig);
}

export async function getAllNegociacoes(search?: string, integrationConfig?: HauzappIntegrationConfig) {
  const response = await hauzappRequest<HauzappNegotiation[]>("getAllNegociacoes", {
    search: search || undefined
  }, integrationConfig);
  const details = parseDetails<HauzappNegotiation[]>(response.details);

  return Array.isArray(details) ? details : [];
}

export async function changeNegociacaoEtapa(
  clienteID: string | number,
  funilStageID: number,
  integrationConfig?: HauzappIntegrationConfig
) {
  return hauzappRequest("changeNegociacaoEtapa", {
    clienteID: Number(clienteID),
    funilStageID
  }, integrationConfig);
}

export async function imobEncaminharNegocio(
  clienteID: string | number,
  corretorID: string | number,
  integrationConfig?: HauzappIntegrationConfig
) {
  return hauzappRequest("imobEncaminharNegocio", {
    clienteID: Number(clienteID),
    corretorID: Number(corretorID)
  }, integrationConfig);
}

export async function getFunilStages(integrationConfig?: HauzappIntegrationConfig) {
  const response = await hauzappRequest<Array<{ id: number; name?: string; nome?: string }>>(
    "getFunilStages",
    {},
    integrationConfig
  );
  const details = parseDetails<Array<{ id: number; name?: string; nome?: string }>>(
    response.details
  );
  return Array.isArray(details) ? details : [];
}

export async function getAllCorretoresImob(integrationConfig?: HauzappIntegrationConfig) {
  const response = await hauzappRequest<HauzappBroker[]>("getAllCorretoresImob", {}, integrationConfig);
  const details = parseDetails<HauzappBroker[]>(response.details);
  return Array.isArray(details) ? details : [];
}

export async function findNegotiationByPhone(phone: string, integrationConfig?: HauzappIntegrationConfig) {
  const normalized = phone.replace(/\D/g, "");
  const lastDigits = normalized.slice(-8);
  const negotiations = await getAllNegociacoes(lastDigits, integrationConfig);

  return (
    negotiations.find((negotiation) => {
      const negotiationPhone = negotiation.clienteTelefone.replace(/\D/g, "");
      return negotiationPhone.endsWith(lastDigits);
    }) ?? null
  );
}

export function formatCurrencyForHauzapp(value: number | null | undefined) {
  if (!value) {
    return undefined;
  }

  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

export function formatPhoneForHauzapp(phone: string) {
  const digits = phone.replace(/\D/g, "");

  if (digits.startsWith("55")) {
    return `+${digits}`;
  }

  return digits.length >= 10 ? `+55${digits}` : phone;
}

function parseDetails<T>(details: unknown) {
  if (typeof details !== "string") {
    return details as T;
  }

  try {
    return JSON.parse(details) as T;
  } catch {
    return details as T;
  }
}
