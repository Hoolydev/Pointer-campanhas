import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import { fetchMetaMedia } from "@/services/meta/media";

type MessageMediaRow = {
  id: string;
  media_url: string | null;
  type: string;
};

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { profile, error: profileError } = await getCurrentProfile(supabase);

  if (!profile) {
    return NextResponse.json({ error: profileError }, { status: 401 });
  }

  const { data: message } = await supabase
    .from("messages")
    .select("id, media_url, type")
    .eq("id", id)
    .eq("organization_id", profile.organization_id)
    .maybeSingle<MessageMediaRow>();

  if (!message?.media_url) {
    return NextResponse.json({ error: "Midia nao encontrada." }, { status: 404 });
  }

  const media = await fetchMetaMedia(message.media_url);

  return new Response(media.body, {
    headers: {
      "Content-Type": media.mimeType,
      "Cache-Control": "private, max-age=300"
    }
  });
}
