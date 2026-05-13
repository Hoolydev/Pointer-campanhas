type GraphError = {
  error?: {
    message?: string;
  };
};

export type MetaPhoneStatus = {
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
};

export type MetaTemplate = {
  name: string;
  language: string;
  status: string;
  category: string | null;
};

export async function getMetaPhoneStatus(): Promise<{
  data: MetaPhoneStatus | null;
  error: string | null;
}> {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    return { data: null, error: "META_ACCESS_TOKEN ou META_PHONE_NUMBER_ID ausente." };
  }

  const payload = await graphFetch<{
    id: string;
    display_phone_number?: string;
    verified_name?: string;
    quality_rating?: string;
  }>(
    `${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
    accessToken
  );

  if ("error" in payload) {
    return { data: null, error: payload.error };
  }

  return {
    data: {
      id: payload.id,
      displayPhoneNumber: payload.display_phone_number ?? null,
      verifiedName: payload.verified_name ?? null,
      qualityRating: payload.quality_rating ?? null
    },
    error: null
  };
}

export async function getMetaTemplates(): Promise<{
  data: MetaTemplate[];
  error: string | null;
}> {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const businessAccountId = process.env.META_BUSINESS_ACCOUNT_ID;

  if (!accessToken || !businessAccountId) {
    return { data: [], error: "META_ACCESS_TOKEN ou META_BUSINESS_ACCOUNT_ID ausente." };
  }

  const payload = await graphFetch<{
    data?: Array<{
      name?: string;
      language?: string;
      status?: string;
      category?: string;
    }>;
  }>(
    `${businessAccountId}/message_templates?fields=name,language,status,category&limit=100`,
    accessToken
  );

  if ("error" in payload) {
    return { data: [], error: payload.error };
  }

  return {
    data:
      payload.data
        ?.filter((template) => template.name && template.language && template.status)
        .map((template) => ({
          name: String(template.name),
          language: String(template.language),
          status: String(template.status),
          category: template.category ?? null
        })) ?? [],
    error: null
  };
}

async function graphFetch<T>(path: string, accessToken: string): Promise<T | { error: string }> {
  const response = await fetch(`https://graph.facebook.com/v21.0/${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    next: { revalidate: 300 }
  });

  const payload = (await response.json().catch(() => ({}))) as T & GraphError;

  if (!response.ok) {
    return { error: payload.error?.message ?? "Nao foi possivel consultar a Meta." };
  }

  return payload;
}
