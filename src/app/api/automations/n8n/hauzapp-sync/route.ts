import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncHauzappProspectionLeads } from "@/services/hauzapp/prospection-sync";

export async function POST(request: Request) {
  const secret = process.env.N8N_WEBHOOK_SECRET || process.env.TRIGGER_SECRET_KEY || process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (secret && authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: integrations, error } = await supabase
    .from("integrations")
    .select("organization_id")
    .eq("provider", "hauzapp")
    .eq("active", true)
    .returns<Array<{ organization_id: string }>>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const organizationIds = [...new Set((integrations ?? []).map((item) => item.organization_id))];
  const results = [];

  for (const organizationId of organizationIds) {
    try {
      const result = await syncHauzappProspectionLeads({ supabase, organizationId });
      results.push({ organizationId, status: "done", result });
    } catch (error) {
      results.push({
        organizationId,
        status: "failed",
        error: error instanceof Error ? error.message : "Erro desconhecido"
      });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
