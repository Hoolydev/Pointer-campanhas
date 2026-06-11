alter type public.integration_provider add value if not exists 'n8n';

alter table public.campaigns
  add column if not exists dispatch_channel text not null default 'meta',
  add column if not exists n8n_enabled boolean not null default true,
  add column if not exists send_interval_min_seconds int not null default 90,
  add column if not exists send_interval_max_seconds int not null default 240,
  add column if not exists uazapi_instance_strategy text not null default 'round_robin';

alter table public.campaigns
  drop constraint if exists campaigns_dispatch_channel_check;

alter table public.campaigns
  add constraint campaigns_dispatch_channel_check
  check (dispatch_channel in ('meta', 'uazapi'));

alter table public.campaigns
  drop constraint if exists campaigns_send_interval_check;

alter table public.campaigns
  add constraint campaigns_send_interval_check
  check (
    send_interval_min_seconds >= 10
    and send_interval_max_seconds >= send_interval_min_seconds
    and send_interval_max_seconds <= 7200
  );

alter table public.campaigns
  drop constraint if exists campaigns_uazapi_instance_strategy_check;

alter table public.campaigns
  add constraint campaigns_uazapi_instance_strategy_check
  check (uazapi_instance_strategy in ('round_robin', 'least_recent'));

create table if not exists public.whatsapp_instances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('meta', 'uazapi')),
  name text not null,
  phone text,
  status text not null default 'pending',
  active boolean not null default true,
  send_order int not null default 0,
  min_delay_seconds int not null default 90,
  max_delay_seconds int not null default 240,
  hourly_limit int not null default 20,
  sent_current_hour int not null default 0,
  sent_current_hour_bucket timestamptz not null default date_trunc('hour', now()),
  daily_limit int not null default 500,
  sent_today int not null default 0,
  sent_today_date date not null default current_date,
  last_sent_at timestamptz,
  base_url text,
  token text,
  instance_key text,
  meta_phone_number_id text,
  meta_business_account_id text,
  meta_access_token text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_instances_delay_check
    check (
      min_delay_seconds >= 10
      and max_delay_seconds >= min_delay_seconds
      and max_delay_seconds <= 7200
    ),
  constraint whatsapp_instances_daily_limit_check
    check (daily_limit >= 1 and daily_limit <= 10000),
  constraint whatsapp_instances_hourly_limit_check
    check (hourly_limit >= 1 and hourly_limit <= 20)
);

create index if not exists whatsapp_instances_org_provider_idx
  on public.whatsapp_instances(organization_id, provider, active, send_order);

create index if not exists whatsapp_instances_rotation_idx
  on public.whatsapp_instances(organization_id, provider, active, last_sent_at);

alter table public.whatsapp_instances enable row level security;

drop policy if exists "organization members can read whatsapp instances"
on public.whatsapp_instances;

create policy "organization members can read whatsapp instances"
on public.whatsapp_instances for select
to authenticated
using (organization_id = public.current_user_organization_id());

drop policy if exists "organization managers can write whatsapp instances"
on public.whatsapp_instances;

create policy "organization managers can write whatsapp instances"
on public.whatsapp_instances for all
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.current_user_role() in ('admin', 'manager')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.current_user_role() in ('admin', 'manager')
);
