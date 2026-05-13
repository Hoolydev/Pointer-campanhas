alter table public.ai_agents
  add column if not exists greeting_template text not null default 'Olá, obrigado por responder. Como posso te ajudar?',
  add column if not exists humanization_rules text,
  add column if not exists forbidden_phrases text,
  add column if not exists conversation_examples text,
  add column if not exists agent_skills text;

create table if not exists public.agent_materials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.ai_agents(id) on delete cascade,
  title text not null,
  description text,
  media_type text not null default 'document',
  storage_path text,
  public_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint agent_materials_media_type_check
    check (media_type in ('image', 'document', 'link'))
);

create index if not exists agent_materials_agent_idx
  on public.agent_materials(organization_id, agent_id, active);

alter table public.agent_materials enable row level security;

create policy "organization members can read agent materials"
on public.agent_materials for select
to authenticated
using (organization_id = public.current_user_organization_id());

create policy "organization users can write agent materials"
on public.agent_materials for all
to authenticated
using (organization_id = public.current_user_organization_id())
with check (organization_id = public.current_user_organization_id());

insert into storage.buckets (id, name, public)
values ('agent-materials', 'agent-materials', true)
on conflict (id) do update set public = true;

create policy "organization members can upload agent materials"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'agent-materials'
  and (storage.foldername(name))[1] = public.current_user_organization_id()::text
);

create policy "organization members can update agent materials"
on storage.objects for update
to authenticated
using (
  bucket_id = 'agent-materials'
  and (storage.foldername(name))[1] = public.current_user_organization_id()::text
)
with check (
  bucket_id = 'agent-materials'
  and (storage.foldername(name))[1] = public.current_user_organization_id()::text
);

create policy "public can read agent materials"
on storage.objects for select
to public
using (bucket_id = 'agent-materials');
