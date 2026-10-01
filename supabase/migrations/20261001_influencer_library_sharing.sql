-- Influencer Manager: compartilhamento de biblioteca entre perfis do mesmo usuário.
-- Migration idempotente: pode ser executada mesmo se a tabela já existir.

create table if not exists public.influencer_content_shares (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.influencer_content_items(id) on delete cascade,
  profile_id uuid not null references public.influencer_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued','available','scheduled','published','failed','canceled')),
  scheduled_at timestamptz,
  published_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  unique(item_id, profile_id)
);

create index if not exists influencer_content_shares_profile_idx
  on public.influencer_content_shares(profile_id, status);

create index if not exists influencer_content_shares_user_idx
  on public.influencer_content_shares(user_id);

alter table public.influencer_content_shares enable row level security;

drop policy if exists influencer_content_shares_owner
  on public.influencer_content_shares;

create policy influencer_content_shares_owner
  on public.influencer_content_shares
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
