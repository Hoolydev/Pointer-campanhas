type SendUazapiMessageInput = {
  phone: string;
  text: string;
  integrationConfig?: {
    baseUrl?: string;
    token?: string;
    apiKey?: string;
  };
};

export async function sendUazapiMessage({
  phone,
  text,
  integrationConfig
}: SendUazapiMessageInput) {
  const baseUrl = integrationConfig?.baseUrl || process.env.UAZAPI_BASE_URL;
  const token = integrationConfig?.token || integrationConfig?.apiKey || process.env.UAZAPI_TOKEN;

  if (!baseUrl || !token) {
    throw new Error("Uazapi credentials are missing.");
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/send-message`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      phone,
      message: text
    })
  });

  const payload = (await response.json().catch(() => ({}))) as { message?: string };

  if (!response.ok) {
    throw new Error(payload.message || "Uazapi request failed.");
  }

  return payload;
}
