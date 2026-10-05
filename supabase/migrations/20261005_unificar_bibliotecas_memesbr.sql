-- Migração: unificar todas as bibliotecas atuais na Biblioteca MemesBR.
-- Executar no Supabase SQL Editor.
-- Não remove bibliotecas nem vídeos.
-- A operação é idempotente e pode ser executada novamente.

begin;

do $$
declare
  v_user_id uuid := 'f4f7381d-8217-4c65-9662-12039bddfebc';
  v_memes_library uuid := '476123f1-805f-47c8-ae9c-0819f242e36f';
begin
  if not exists (
    select 1 from public.influencer_libraries
    where id = v_memes_library and user_id = v_user_id
  ) then
    raise exception 'Biblioteca MemesBR não encontrada para o usuário informado.';
  end if;

  if exists (
    select 1
    from public.influencer_content_items i
    join public.influencer_libraries l on l.id = i.library_id
    where l.user_id = v_user_id
      and i.library_id is not null
      and i.user_id <> v_user_id
  ) then
    raise exception 'Foram encontrados vídeos de outro usuário. Migração cancelada por segurança.';
  end if;
end $$;

-- 1. Move todos os vídeos atualmente vinculados às bibliotecas do usuário.
update public.influencer_content_items
set library_id = '476123f1-805f-47c8-ae9c-0819f242e36f'
where user_id = 'f4f7381d-8217-4c65-9662-12039bddfebc'
  and library_id is not null;

-- 2. Garante que os três perfis usem a Biblioteca MemesBR.
insert into public.influencer_profile_libraries
  (profile_id, library_id, user_id, priority, enabled, created_at, updated_at)
values
  ('42be8aad-daa3-4431-b503-0fb7ec5ca34c', '476123f1-805f-47c8-ae9c-0819f242e36f', 'f4f7381d-8217-4c65-9662-12039bddfebc', 0, true, now(), now()),
  ('d771fae5-989d-4491-869a-62ceacb2fe5f', '476123f1-805f-47c8-ae9c-0819f242e36f', 'f4f7381d-8217-4c65-9662-12039bddfebc', 0, true, now()),
  ('013f7820-be57-4c41-bdff-b801dcab7341', '476123f1-805f-47c8-ae9c-0819f242e36f', 'f4f7381d-8217-4c65-9662-12039bddfebc', 0, true, now(), now())
on conflict (profile_id, library_id)
do update set priority = excluded.priority, enabled = true, updated_at = now();

-- 3. Remove apenas os vínculos antigos desses três perfis.
delete from public.influencer_profile_libraries
where user_id = 'f4f7381d-8217-4c65-9662-12039bddfebc'
  and profile_id in (
    '42be8aad-daa3-4431-b503-0fb7ec5ca34c',
    'd771fae5-989d-4491-869a-62ceacb2fe5f',
    '013f7820-be57-4c41-bdff-b801dcab7341'
  )
  and library_id <> '476123f1-805f-47c8-ae9c-0819f242e36f';

commit;

-- Validação dos vídeos por biblioteca.
select l.name as biblioteca, count(i.id) as videos
from public.influencer_libraries l
left join public.influencer_content_items i on i.library_id = l.id
where l.user_id = 'f4f7381d-8217-4c65-9662-12039bddfebc'
group by l.id, l.name
order by l.name;

-- Validação dos vínculos dos perfis.
select p.name as perfil, l.name as biblioteca, pl.enabled, pl.priority
from public.influencer_profiles p
join public.influencer_profile_libraries pl on pl.profile_id = p.id
join public.influencer_libraries l on l.id = pl.library_id
where p.id in (
  '42be8aad-daa3-4431-b503-0fb7ec5ca34c',
  'd771fae5-989d-4491-869a-62ceacb2fe5f',
  '013f7820-be57-4c41-bdff-b801dcab7341'
)
order by p.name;
