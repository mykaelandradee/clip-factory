-- Campos adicionais usados pelo editor e pela automação do Influencer Manager.
alter table public.influencer_profiles
  add column if not exists fixed_publish_title text,
  add column if not exists fixed_publish_description text,
  add column if not exists share_to_feed boolean not null default true;

-- Garante índices para as consultas de publicação.
create index if not exists influencer_profiles_user_created_idx
  on public.influencer_profiles(user_id, created_at);
