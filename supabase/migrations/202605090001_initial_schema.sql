create extension if not exists "pgcrypto";

create type public.profile_role as enum ('admin', 'manager', 'broker', 'user');
create type public.campaign_status as enum ('draft', 'active', 'paused', 'finished');
create type public.message_direction as enum ('inbound', 'outbound');
create type public.message_channel as enum ('meta', 'uazapi', 'canal_pro');
create type public.message_type as enum ('text', 'image', 'audio', 'video', 'document', 'template');
create type public.lead_source as enum ('campaign', 'canal_pro', 'manual');
create type public.broker_assignment_status as enum (
  'assigned',
  'accepted',
  'no_response',
  'redistributed',
  'finished'
);
create type public.followup_type as enum ('lead', 'broker');
create type public.scheduled_job_status as enum (
  'pending',
  'running',
  'done',
  'failed',
  'cancelled'
);
create type public.integration_provider as enum (
  'meta',
  'uazapi',
  'houseup',
  'canal_pro',
  'openai'
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text,
  role public.profile_role not null default 'user',
  phone text,
  created_at timestamptz not null default now()
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  property_description text,
  initial_message text,
  agent_prompt text,
  status public.campaign_status not null default 'draft',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  name text,
  phone text not null,
  raw_data jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  campaign_id uuid references public.campaigns(id) on delete set null,
  status text not null default 'open',
  current_stage text not null default 'new',
  ai_enabled boolean not null default true,
  assigned_broker_id uuid,
  window_expires_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  direction public.message_direction not null,
  channel public.message_channel not null,
  type public.message_type not null default 'text',
  content text,
  media_url text,
  status text not null default 'created',
  external_message_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  campaign_id uuid references public.campaigns(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  name text,
  phone text not null,
  source public.lead_source not null default 'campaign',
  interest text,
  region text,
  budget numeric(14, 2),
  payment_method text,
  qualification_status text not null default 'new',
  score integer not null default 0 check (score >= 0 and score <= 100),
  summary text,
  stage text not null default 'new',
  houseup_external_id text,
  created_at timestamptz not null default now()
);

create table public.brokers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  phone text not null,
  active boolean not null default true,
  priority int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.conversations
  add constraint conversations_assigned_broker_id_fkey
  foreign key (assigned_broker_id) references public.brokers(id) on delete set null;

create table public.broker_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  broker_id uuid not null references public.brokers(id) on delete cascade,
  status public.broker_assignment_status not null default 'assigned',
  assigned_at timestamptz not null default now(),
  responded_at timestamptz,
  redistributed_at timestamptz
);

create table public.followup_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  type public.followup_type not null,
  name text not null,
  delay_minutes int not null check (delay_minutes > 0),
  message_template text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.scheduled_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_type text not null,
  target_id uuid,
  status public.scheduled_job_status not null default 'pending',
  run_at timestamptz not null,
  executed_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider public.integration_provider not null,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.webhook_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  provider public.integration_provider not null,
  event_type text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'received',
  error_message text,
  created_at timestamptz not null default now()
);

create table public.integration_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider public.integration_provider not null,
  target_type text not null,
  target_id uuid,
  status text not null,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create index profiles_organization_id_idx on public.profiles(organization_id);
create index campaigns_organization_id_idx on public.campaigns(organization_id);
create index contacts_campaign_id_idx on public.contacts(campaign_id);
create index contacts_phone_idx on public.contacts(phone);
create index conversations_contact_id_idx on public.conversations(contact_id);
create index conversations_last_message_at_idx on public.conversations(last_message_at desc);
create index messages_conversation_id_created_at_idx on public.messages(conversation_id, created_at);
create index leads_stage_idx on public.leads(organization_id, stage);
create index brokers_active_idx on public.brokers(organization_id, active, priority desc);
create index broker_assignments_lead_id_idx on public.broker_assignments(lead_id);
create index scheduled_jobs_run_at_idx on public.scheduled_jobs(status, run_at);
create unique index integrations_provider_org_idx on public.integrations(organization_id, provider, name);

create or replace function public.current_user_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.profiles
  where id = auth.uid()
  limit 1
$$;

create or replace function public.current_user_role()
returns public.profile_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
  limit 1
$$;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.contacts enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.leads enable row level security;
alter table public.brokers enable row level security;
alter table public.broker_assignments enable row level security;
alter table public.followup_rules enable row level security;
alter table public.scheduled_jobs enable row level security;
alter table public.integrations enable row level security;
alter table public.webhook_logs enable row level security;
alter table public.integration_logs enable row level security;

create policy "members can read their organization"
on public.organizations for select
to authenticated
using (id = public.current_user_organization_id());

create policy "admins can update their organization"
on public.organizations for update
to authenticated
using (id = public.current_user_organization_id() and public.current_user_role() in ('admin', 'manager'))
with check (id = public.current_user_organization_id());

create policy "members can read profiles"
on public.profiles for select
to authenticated
using (organization_id = public.current_user_organization_id());

create policy "users can update own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid() and organization_id = public.current_user_organization_id());

create policy "admins can manage profiles"
on public.profiles for all
to authenticated
using (organization_id = public.current_user_organization_id() and public.current_user_role() in ('admin', 'manager'))
with check (organization_id = public.current_user_organization_id());

create policy "organization members can read campaigns"
on public.campaigns for select
to authenticated
using (organization_id = public.current_user_organization_id());

create policy "organization managers can write campaigns"
on public.campaigns for all
to authenticated
using (organization_id = public.current_user_organization_id() and public.current_user_role() in ('admin', 'manager', 'user'))
with check (organization_id = public.current_user_organization_id());

create policy "organization members can read contacts"
on public.contacts for select
to authenticated
using (organization_id = public.current_user_organization_id());

create policy "organization users can write contacts"
on public.contacts for all
to authenticated
using (organization_id = public.current_user_organization_id() and public.current_user_role() in ('admin', 'manager', 'user'))
with check (organization_id = public.current_user_organization_id());

create policy "organization members can read conversations"
on public.conversations for select
to authenticated
using (organization_id = public.current_user_organization_id());

create policy "organization users can write conversations"
on public.conversations for all
to authenticated
using (organization_id = public.current_user_organization_id())
with check (organization_id = public.current_user_organization_id());

create policy "organization members can read messages"
on public.messages for select
to authenticated
using (organization_id = public.current_user_organization_id());

create policy "organization users can write messages"
on public.messages for all
to authenticated
using (organization_id = public.current_user_organization_id())
with check (organization_id = public.current_user_organization_id());

create policy "organization members can read leads"
on public.leads for select
to authenticated
using (organization_id = public.current_user_organization_id());

create policy "organization users can write leads"
on public.leads for all
to authenticated
using (organization_id = public.current_user_organization_id())
with check (organization_id = public.current_user_organization_id());

create policy "organization members can read brokers"
on public.brokers for select
to authenticated
using (organization_id = public.current_user_organization_id());

create policy "organization managers can write brokers"
on public.brokers for all
to authenticated
using (organization_id = public.current_user_organization_id() and public.current_user_role() in ('admin', 'manager'))
with check (organization_id = public.current_user_organization_id());

create policy "organization members can read broker assignments"
on public.broker_assignments for select
to authenticated
using (organization_id = public.current_user_organization_id());

create policy "organization users can write broker assignments"
on public.broker_assignments for all
to authenticated
using (organization_id = public.current_user_organization_id())
with check (organization_id = public.current_user_organization_id());

create policy "organization members can read followup rules"
on public.followup_rules for select
to authenticated
using (organization_id = public.current_user_organization_id());

create policy "organization managers can write followup rules"
on public.followup_rules for all
to authenticated
using (organization_id = public.current_user_organization_id() and public.current_user_role() in ('admin', 'manager'))
with check (organization_id = public.current_user_organization_id());

create policy "organization members can read scheduled jobs"
on public.scheduled_jobs for select
to authenticated
using (organization_id = public.current_user_organization_id());

create policy "organization managers can write scheduled jobs"
on public.scheduled_jobs for all
to authenticated
using (organization_id = public.current_user_organization_id() and public.current_user_role() in ('admin', 'manager'))
with check (organization_id = public.current_user_organization_id());

create policy "organization managers can read integrations"
on public.integrations for select
to authenticated
using (organization_id = public.current_user_organization_id() and public.current_user_role() in ('admin', 'manager'));

create policy "organization admins can write integrations"
on public.integrations for all
to authenticated
using (organization_id = public.current_user_organization_id() and public.current_user_role() = 'admin')
with check (organization_id = public.current_user_organization_id());

create policy "organization managers can read webhook logs"
on public.webhook_logs for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.current_user_role() in ('admin', 'manager')
);

create policy "organization managers can read integration logs"
on public.integration_logs for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.current_user_role() in ('admin', 'manager')
);
