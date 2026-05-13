type UploadMetaMediaInput = {
  file: File;
  integrationConfig?: {
    accessToken?: string;
    phoneNumberId?: string;
  };
};

export async function uploadMetaMedia({ file, integrationConfig }: UploadMetaMediaInput) {
  const accessToken = integrationConfig?.accessToken || process.env.META_ACCESS_TOKEN;
  const phoneNumberId = integrationConfig?.phoneNumberId || process.env.META_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    throw new Error("Meta WhatsApp credentials are missing.");
  }

  const body = new FormData();
  body.append("messaging_product", "whatsapp");
  body.append("file", file, file.name);

  if (file.type) {
    body.append("type", file.type);
  }

  const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/media`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    body
  });

  const payload = (await response.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string };
  };

  if (!response.ok || !payload.id) {
    throw new Error(payload.error?.message || "Meta media upload failed.");
  }

  return {
    mediaId: payload.id,
    payload
  };
}

export function inferMetaHeaderMediaType(file: File): "image" | "video" | "document" | null {
  if (file.type.startsWith("image/")) {
    return "image";
  }

  if (file.type.startsWith("video/")) {
    return "video";
  }

  if (file.type || file.name) {
    return "document";
  }

  return null;
}
