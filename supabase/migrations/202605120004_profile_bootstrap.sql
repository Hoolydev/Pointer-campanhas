create or replace function public.bootstrap_current_user_organization(
  input_organization_name text default null,
  input_full_name text default null
)
returns table (
  id uuid,
  organization_id uuid,
  full_name text,
  role public.profile_role
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text := auth.jwt() ->> 'email';
  new_organization_id uuid;
begin
  if current_user_id is null then
    raise exception 'not_authenticated';
  end if;

  return query
    select p.id, p.organization_id, p.full_name, p.role
    from public.profiles p
    where p.id = current_user_id
    limit 1;

  if found then
    return;
  end if;

  insert into public.organizations (name)
  values (
    coalesce(
      nullif(trim(input_organization_name), ''),
      nullif(split_part(coalesce(current_email, ''), '@', 2), ''),
      'Minha imobiliaria'
    )
  )
  returning organizations.id into new_organization_id;

  insert into public.profiles (
    id,
    organization_id,
    full_name,
    role
  )
  values (
    current_user_id,
    new_organization_id,
    coalesce(nullif(trim(input_full_name), ''), current_email),
    'admin'
  );

  return query
    select p.id, p.organization_id, p.full_name, p.role
    from public.profiles p
    where p.id = current_user_id
    limit 1;
end;
$$;

grant execute on function public.bootstrap_current_user_organization(text, text)
to authenticated;
