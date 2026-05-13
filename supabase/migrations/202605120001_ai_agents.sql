create table if not exists public.ai_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  system_prompt text not null,
  qualification_criteria text,
  handoff_instructions text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.campaigns
  add column if not exists agent_id uuid references public.ai_agents(id) on delete set null;

create index if not exists ai_agents_organization_id_idx
  on public.ai_agents(organization_id, active);

create index if not exists campaigns_agent_id_idx
  on public.campaigns(agent_id);

alter table public.ai_agents enable row level security;

create policy "organization members can read ai agents"
on public.ai_agents for select
to authenticated
using (organization_id = public.current_user_organization_id());

create policy "organization managers can write ai agents"
on public.ai_agents for all
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.current_user_role() in ('admin', 'manager', 'user')
)
with check (organization_id = public.current_user_organization_id());
