do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'lead_source'
  ) then
    alter type public.lead_source add value if not exists 'hauzapp';
  end if;
end
$$;

alter table public.contacts
  add column if not exists hauzapp_cliente_id text;

alter table public.conversations
  add column if not exists channel text not null default 'meta',
  add column if not exists hauzapp_cliente_id text;

create index if not exists contacts_hauzapp_cliente_id_idx
  on public.contacts(organization_id, hauzapp_cliente_id);

create index if not exists conversations_hauzapp_cliente_id_idx
  on public.conversations(organization_id, hauzapp_cliente_id);

create index if not exists leads_phone_source_idx
  on public.leads(organization_id, phone, source);
