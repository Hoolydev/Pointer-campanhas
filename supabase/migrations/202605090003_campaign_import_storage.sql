insert into storage.buckets (id, name, public)
values ('campaign-imports', 'campaign-imports', false)
on conflict (id) do nothing;

create policy "organization members can read campaign imports"
on storage.objects for select
to authenticated
using (
  bucket_id = 'campaign-imports'
  and (storage.foldername(name))[1] = public.current_user_organization_id()::text
);

create policy "organization members can upload campaign imports"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'campaign-imports'
  and (storage.foldername(name))[1] = public.current_user_organization_id()::text
);

create policy "organization managers can update campaign imports"
on storage.objects for update
to authenticated
using (
  bucket_id = 'campaign-imports'
  and (storage.foldername(name))[1] = public.current_user_organization_id()::text
  and public.current_user_role() in ('admin', 'manager', 'user')
)
with check (
  bucket_id = 'campaign-imports'
  and (storage.foldername(name))[1] = public.current_user_organization_id()::text
);
