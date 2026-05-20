type SendMetaTemplateInput = {
  phone: string;
  templateName: string;
  languageCode?: string;
  components?: unknown[];
  integrationConfig?: {
    accessToken?: string;
    phoneNumberId?: string;
  };
};

export async function sendMetaTemplate({
  phone,
  templateName,
  languageCode = "pt_BR",
  components = [],
  integrationConfig
}: SendMetaTemplateInput) {
  const accessToken = integrationConfig?.accessToken || process.env.META_ACCESS_TOKEN;
  const phoneNumberId = integrationConfig?.phoneNumberId || process.env.META_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    throw new Error("Meta WhatsApp credentials are missing.");
  }

  const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: templateName,
        language: {
          code: languageCode
        },
        components
      }
    })
  });

  const payload = (await response.json().catch(() => ({}))) as {
    messages?: Array<{ id?: string }>;
    error?: { message?: string; error_data?: { details?: string }; code?: number };
  };

  if (!response.ok) {
    const details = payload.error?.error_data?.details;
    const code = payload.error?.code ? `#${payload.error.code}` : null;
    const parts = [code, payload.error?.message, details].filter(Boolean);

    throw new Error(parts.length > 0 ? parts.join(" - ") : "Meta template request failed.");
  }

  return {
    externalMessageId: payload.messages?.[0]?.id ?? null,
    payload
  };
}
