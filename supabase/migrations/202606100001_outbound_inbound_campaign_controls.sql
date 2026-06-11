alter table public.campaigns
  add column if not exists inbound_enabled boolean not null default false;

alter table public.campaigns
  drop constraint if exists campaigns_campaign_type_check;

alter table public.campaigns
  add constraint campaigns_campaign_type_check
  check (campaign_type in ('standard', 'outbound', 'inbound', 'test'));

alter table public.whatsapp_instances
  add column if not exists hourly_limit int not null default 20,
  add column if not exists sent_current_hour int not null default 0,
  add column if not exists sent_current_hour_bucket timestamptz not null default date_trunc('hour', now());

alter table public.whatsapp_instances
  drop constraint if exists whatsapp_instances_hourly_limit_check;

alter table public.whatsapp_instances
  add constraint whatsapp_instances_hourly_limit_check
  check (hourly_limit >= 1 and hourly_limit <= 20);

create table if not exists public.campaign_whatsapp_instances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  whatsapp_instance_id uuid not null references public.whatsapp_instances(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (campaign_id, whatsapp_instance_id)
);

create index if not exists campaign_whatsapp_instances_campaign_idx
  on public.campaign_whatsapp_instances(organization_id, campaign_id);

alter table public.campaign_whatsapp_instances enable row level security;

drop policy if exists "organization members can read campaign whatsapp instances"
on public.campaign_whatsapp_instances;

create policy "organization members can read campaign whatsapp instances"
on public.campaign_whatsapp_instances for select
to authenticated
using (organization_id = public.current_user_organization_id());

drop policy if exists "organization managers can write campaign whatsapp instances"
on public.campaign_whatsapp_instances;

create policy "organization managers can write campaign whatsapp instances"
on public.campaign_whatsapp_instances for all
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.current_user_role() in ('admin', 'manager')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.current_user_role() in ('admin', 'manager')
);
