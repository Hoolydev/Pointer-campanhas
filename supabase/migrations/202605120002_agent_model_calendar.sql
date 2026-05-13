alter table public.ai_agents
  add column if not exists openai_model text not null default 'gpt-5-mini',
  add column if not exists message_split_enabled boolean not null default true,
  add column if not exists typing_words_per_minute int not null default 150,
  add column if not exists appointment_enabled boolean not null default true,
  add column if not exists appointment_duration_minutes int not null default 30,
  add column if not exists calendar_id text,
  add column if not exists weekly_availability jsonb not null default '{
    "monday":[{"start":"08:00","end":"12:00"},{"start":"14:00","end":"18:00"}],
    "tuesday":[{"start":"08:00","end":"12:00"},{"start":"14:00","end":"18:00"}],
    "wednesday":[{"start":"08:00","end":"12:00"},{"start":"14:00","end":"18:00"}],
    "thursday":[{"start":"08:00","end":"12:00"},{"start":"14:00","end":"18:00"}],
    "friday":[{"start":"08:00","end":"12:00"},{"start":"14:00","end":"18:00"}],
    "saturday":[{"start":"08:00","end":"11:00"}],
    "sunday":[]
  }'::jsonb;

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  agent_id uuid references public.ai_agents(id) on delete set null,
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending',
  google_event_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists appointments_organization_starts_idx
  on public.appointments(organization_id, starts_at);

alter table public.appointments enable row level security;

create policy "organization members can read appointments"
on public.appointments for select
to authenticated
using (organization_id = public.current_user_organization_id());

create policy "organization users can write appointments"
on public.appointments for all
to authenticated
using (organization_id = public.current_user_organization_id())
with check (organization_id = public.current_user_organization_id());
