-- Influencer Manager: último resultado da publicação automática por perfil.
-- Permite mostrar na tela por que a fila não publicou (fila vazia, conta
-- desconectada, cota do YouTube...) em vez de falhar em silêncio.

alter table public.influencer_profiles
  add column if not exists last_publish_status text,
  add column if not exists last_publish_message text,
  add column if not exists last_publish_at timestamptz;

alter table public.influencer_profiles
  drop constraint if exists influencer_profiles_last_publish_status_check;
alter table public.influencer_profiles
  add constraint influencer_profiles_last_publish_status_check
  check (last_publish_status is null or last_publish_status in ('published','empty','error','retry'));

-- Perfis desativados automaticamente por fila vazia (comportamento antigo)
-- não são reativados aqui: a reativação fica a critério do usuário.
