alter table public.campaigns
  add column if not exists campaign_type text not null default 'standard';

alter table public.campaigns
  drop constraint if exists campaigns_campaign_type_check;

alter table public.campaigns
  add constraint campaigns_campaign_type_check
  check (campaign_type in ('standard', 'test'));

create index if not exists campaigns_type_org_idx
  on public.campaigns(organization_id, campaign_type, created_at desc);
