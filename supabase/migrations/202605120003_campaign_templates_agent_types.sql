alter table public.campaigns
  add column if not exists meta_template_name text,
  add column if not exists meta_template_language text not null default 'pt_BR',
  add column if not exists meta_template_body_params jsonb not null default '[]'::jsonb;

alter table public.ai_agents
  add column if not exists agent_type text not null default 'lead_meta',
  add column if not exists broker_message_template text,
  add column if not exists broker_followup_minutes int not null default 30;

alter table public.ai_agents
  drop constraint if exists ai_agents_agent_type_check;

alter table public.ai_agents
  add constraint ai_agents_agent_type_check
  check (agent_type in ('lead_meta', 'broker_uazapi'));

create index if not exists ai_agents_type_organization_idx
  on public.ai_agents(organization_id, agent_type, active);
