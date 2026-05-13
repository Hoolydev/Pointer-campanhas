"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/organization";
import { enqueueHauzappQualifiedLead } from "@/services/leads/workflow";
import { createClient } from "@/lib/supabase/server";

const stages = [
  "new",
  "ai_attending",
  "interested",
  "qualifying",
  "qualified",
  "sent_to_broker",
  "broker_attending",
  "no_response",
  "lost",
  "won"
] as const;

const stageSchema = z.object({
  lead_id: z.string().uuid(),
  stage: z.enum(stages)
});

export async function updateLeadStageAction(formData: FormData) {
  const parsed = stageSchema.safeParse({
    lead_id: formData.get("lead_id"),
    stage: formData.get("stage")
  });

  if (!parsed.success) {
    return;
  }

  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile) {
    return;
  }

  await supabase
    .from("leads")
    .update({ stage: parsed.data.stage })
    .eq("id", parsed.data.lead_id)
    .eq("organization_id", profile.organization_id);

  revalidatePath("/crm");
  revalidatePath(`/leads/${parsed.data.lead_id}`);
}

export async function resendLeadToBrokerAction(formData: FormData) {
  const leadId = String(formData.get("lead_id") ?? "");
  const supabase = await createClient();
  const { profile } = await getCurrentProfile(supabase);

  if (!profile || !leadId) {
    return;
  }

  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("organization_id", profile.organization_id)
    .single<{
      id: string;
    }>();

  if (!lead) {
    return;
  }

  await enqueueHauzappQualifiedLead({
    supabase,
    organizationId: profile.organization_id,
    leadId: lead.id,
    reason: "manual_lead_resend_to_hauzapp"
  });

  revalidatePath("/crm");
  revalidatePath(`/leads/${lead.id}`);
}
