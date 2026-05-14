with ranked_hauzapp_jobs as (
  select
    id,
    row_number() over (
      partition by organization_id, target_id
      order by created_at asc
    ) as row_number
  from public.scheduled_jobs
  where job_type = 'hauzapp_create_qualified_lead'
    and status in ('pending', 'running')
    and target_id is not null
)
update public.scheduled_jobs
set
  status = 'cancelled',
  executed_at = now(),
  payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('cancel_reason', 'duplicate_hauzapp_job')
where id in (
  select id
  from ranked_hauzapp_jobs
  where row_number > 1
);

create unique index if not exists scheduled_jobs_hauzapp_active_unique
  on public.scheduled_jobs(organization_id, target_id)
  where job_type = 'hauzapp_create_qualified_lead'
    and status in ('pending', 'running')
    and target_id is not null;
