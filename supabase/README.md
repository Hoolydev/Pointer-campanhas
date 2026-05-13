# Supabase

Rode as migrations deste diretorio no projeto Supabase antes de iniciar o app.

```bash
supabase db push
```

As tabelas usam RLS por `organization_id`. Para acessar o sistema, crie uma organizacao e um perfil vinculado ao usuario autenticado:

```sql
insert into public.organizations (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Minha Imobiliaria');

insert into public.profiles (id, organization_id, full_name, role)
values (
  '<auth-user-id>',
  '00000000-0000-0000-0000-000000000001',
  'Admin',
  'admin'
);
```
