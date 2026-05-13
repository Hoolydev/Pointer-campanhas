create or replace function public.create_default_followup_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.followup_rules (
    organization_id,
    type,
    name,
    delay_minutes,
    message_template,
    active
  )
  values
    (
      new.id,
      'lead',
      'Follow-up 1',
      120,
      'Ola, {{lead_name}}. Posso te ajudar com alguma duvida sobre o imovel?',
      true
    ),
    (
      new.id,
      'lead',
      'Follow-up 2',
      1200,
      'Ola, {{lead_name}}. Ainda faz sentido conversarmos sobre essa oportunidade?',
      true
    ),
    (
      new.id,
      'broker',
      'Retorno do corretor',
      30,
      'Ola, {{broker_name}}. Voce conseguiu atender o lead {{lead_name}}?',
      true
    );

  return new;
end;
$$;

create trigger create_default_followup_rules_after_organization
after insert on public.organizations
for each row
execute function public.create_default_followup_rules();
