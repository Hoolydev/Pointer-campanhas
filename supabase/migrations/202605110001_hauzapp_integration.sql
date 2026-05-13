alter table public.leads
  add column if not exists hauzapp_cliente_id text,
  add column if not exists hauzapp_stage_id int,
  add column if not exists hauzapp_sent_at timestamptz;

alter table public.brokers
  add column if not exists hauzapp_corretor_id text,
  add column if not exists last_assigned_at timestamptz;

create index if not exists leads_hauzapp_cliente_id_idx
  on public.leads(organization_id, hauzapp_cliente_id);

create index if not exists brokers_hauzapp_round_robin_idx
  on public.brokers(organization_id, active, last_assigned_at, priority desc);
