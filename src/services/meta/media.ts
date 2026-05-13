type MetaMediaMetadata = {
  url?: string;
  mime_type?: string;
  file_size?: number;
  id?: string;
};

export async function fetchMetaMedia(mediaId: string) {
  const accessToken = process.env.META_ACCESS_TOKEN;

  if (!accessToken) {
    throw new Error("META_ACCESS_TOKEN ausente.");
  }

  const metadataResponse = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const metadata = (await metadataResponse.json().catch(() => ({}))) as MetaMediaMetadata & {
    error?: { message?: string };
  };

  if (!metadataResponse.ok || !metadata.url) {
    throw new Error(metadata.error?.message || "Nao foi possivel buscar a midia na Meta.");
  }

  const mediaResponse = await fetch(metadata.url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!mediaResponse.ok) {
    throw new Error("Nao foi possivel baixar a midia da Meta.");
  }

  return {
    body: mediaResponse.body,
    mimeType: metadata.mime_type || mediaResponse.headers.get("content-type") || "application/octet-stream",
    fileSize: metadata.file_size ?? null
  };
}
