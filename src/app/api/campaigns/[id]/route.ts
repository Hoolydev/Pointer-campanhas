import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { profile, error: profileError } = await getCurrentProfile(supabase);

  if (!profile) {
    return NextResponse.json({ error: profileError }, { status: 401 });
  }

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", id)
    .eq("organization_id", profile.organization_id)
    .maybeSingle<{ id: string }>();

  if (!campaign) {
    return NextResponse.json({ error: "Campanha nao encontrada." }, { status: 404 });
  }

  const cleanup = [
    supabase
      .from("scheduled_jobs")
      .delete()
      .eq("organization_id", profile.organization_id)
      .contains("payload", { campaignId: id }),
    supabase
      .from("campaign_materials")
      .delete()
      .eq("organization_id", profile.organization_id)
      .eq("campaign_id", id),
    supabase
      .from("leads")
      .delete()
      .eq("organization_id", profile.organization_id)
      .eq("campaign_id", id),
    supabase
      .from("conversations")
      .delete()
      .eq("organization_id", profile.organization_id)
      .eq("campaign_id", id),
    supabase
      .from("contacts")
      .delete()
      .eq("organization_id", profile.organization_id)
      .eq("campaign_id", id)
  ];

  for (const operation of cleanup) {
    const { error } = await operation;

    if (error && error.code !== "42P01") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const { error: deleteError } = await supabase
    .from("campaigns")
    .delete()
    .eq("id", id)
    .eq("organization_id", profile.organization_id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
