alter table public.leads
  add column if not exists last_stage_updated_at timestamptz not null default now(),
  add column if not exists last_broker_response_at timestamptz,
  add column if not exists stale_owner_notified_at timestamptz,
  add column if not exists reclaimed_at timestamptz,
  add column if not exists lost_reason text;

alter table public.broker_assignments
  add column if not exists first_check_sent_at timestamptz,
  add column if not exists admin_escalated_at timestamptz,
  add column if not exists last_progress_check_at timestamptz,
  add column if not exists reclaimed_at timestamptz;

alter table public.appointments
  add column if not exists reminder_sent_at timestamptz,
  add column if not exists broker_post_visit_checked_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists outcome text;

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  title text not null,
  message text not null,
  remind_at timestamptz not null,
  status text not null default 'pending',
  sent_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists leads_stage_update_idx
  on public.leads(organization_id, stage, last_stage_updated_at);

create index if not exists broker_assignments_sla_idx
  on public.broker_assignments(organization_id, status, assigned_at, responded_at);

create index if not exists reminders_due_idx
  on public.reminders(organization_id, status, remind_at);

alter table public.reminders enable row level security;

create policy "organization members can read reminders"
on public.reminders for select
to authenticated
using (organization_id = public.current_user_organization_id());

create policy "organization users can write reminders"
on public.reminders for all
to authenticated
using (organization_id = public.current_user_organization_id())
with check (organization_id = public.current_user_organization_id());
