import { NextResponse } from "next/server";
import { z } from "zod";
import { runAgentChat } from "@/agents/chat-agent";
import { getCurrentProfile } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";

const testChatSchema = z.object({
  agentId: z.string().uuid(),
  message: z.string().min(1).max(4000),
  history: z
    .array(
      z.object({
        direction: z.enum(["inbound", "outbound"]),
        content: z.string().nullable()
      })
    )
    .max(30)
    .default([])
});

type AgentRow = {
  name: string;
  description: string | null;
  openai_model: string;
  system_prompt: string;
  greeting_template: string | null;
  humanization_rules: string | null;
  forbidden_phrases: string | null;
  conversation_examples: string | null;
  agent_skills: string | null;
  qualification_criteria: string | null;
  handoff_instructions: string | null;
};

export async function POST(request: Request) {
  const parsed = testChatSchema.safeParse(await request.json().catch(() => ({})));

  if (!parsed.success) {
    return NextResponse.json({ error: "Mensagem invalida." }, { status: 400 });
  }

  const supabase = await createClient();
  const { profile, error: profileError } = await getCurrentProfile(supabase);

  if (!profile) {
    return NextResponse.json({ error: profileError }, { status: 401 });
  }

  const [{ data: agent }, { data: materials }] = await Promise.all([
    supabase
      .from("ai_agents")
      .select(
        "name, description, openai_model, system_prompt, greeting_template, humanization_rules, forbidden_phrases, conversation_examples, agent_skills, qualification_criteria, handoff_instructions"
      )
      .eq("id", parsed.data.agentId)
      .eq("organization_id", profile.organization_id)
      .eq("active", true)
      .maybeSingle<AgentRow>(),
    supabase
      .from("agent_materials")
      .select("title, description, media_type, public_url")
      .eq("organization_id", profile.organization_id)
      .eq("agent_id", parsed.data.agentId)
      .eq("active", true)
      .returns<Array<{ title: string; description: string | null; media_type: string; public_url: string | null }>>()
  ]);

  if (!agent) {
    return NextResponse.json({ error: "Agente nao encontrado ou inativo." }, { status: 404 });
  }

  const messages = [
    ...parsed.data.history,
    {
      direction: "inbound" as const,
      content: parsed.data.message
    }
  ];

  try {
    const reply = await runAgentChat({
      agent: {
        ...agent,
        agent_skills: [
          agent.agent_skills,
          materials?.length
            ? `Materiais disponiveis:\n${materials
                .map(
                  (material) =>
                    `- ${material.title} (${material.media_type}): ${material.public_url || "arquivo interno"}${material.description ? ` - ${material.description}` : ""}`
                )
                .join("\n")}`
            : null
        ]
          .filter(Boolean)
          .join("\n\n")
      },
      messages
    });

    return NextResponse.json({ reply });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Nao foi possivel testar o agente."
      },
      { status: 500 }
    );
  }
}
