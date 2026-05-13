alter table public.campaigns
  add column if not exists meta_header_media_type text,
  add column if not exists meta_header_media_url text,
  add column if not exists meta_header_media_id text;

alter table public.campaigns
  drop constraint if exists campaigns_meta_header_media_type_check;

alter table public.campaigns
  add constraint campaigns_meta_header_media_type_check
  check (
    meta_header_media_type is null
    or meta_header_media_type in ('image', 'video', 'document')
  );

create table if not exists public.campaign_materials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  title text not null,
  description text,
  media_type text not null default 'document',
  media_url text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint campaign_materials_media_type_check
    check (media_type in ('image', 'video', 'audio', 'document', 'link'))
);

create index if not exists campaign_materials_campaign_idx
  on public.campaign_materials(organization_id, campaign_id, active);

alter table public.campaign_materials enable row level security;

create policy "organization members can read campaign materials"
on public.campaign_materials for select
to authenticated
using (organization_id = public.current_user_organization_id());

create policy "organization users can write campaign materials"
on public.campaign_materials for all
to authenticated
using (organization_id = public.current_user_organization_id())
with check (organization_id = public.current_user_organization_id());
