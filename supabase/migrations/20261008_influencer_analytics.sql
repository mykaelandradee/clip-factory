-- Analytics e categorização do Influencer Manager.
-- Não altera vídeos existentes além de atribuir a categoria padrão "OUTROS".

alter table public.influencer_content_items
  add column if not exists category text not null default 'OUTROS';

alter table public.influencer_content_items
  drop constraint if exists influencer_content_items_category_check;

alter table public.influencer_content_items
  add constraint influencer_content_items_category_check
  check (category in (
    'MEME',
    'FUTEBOL',
    'FAIL',
    'ANIMAL',
    'RELACIONAMENTO',
    'REAÇÃO',
    'VIRAL',
    'ABSURDO',
    'COTIDIANO',
    'OUTROS'
  ));

alter table public.influencer_profile_content
  add column if not exists instagram_media_id text;

create index if not exists influencer_profile_content_instagram_media_idx
  on public.influencer_profile_content(instagram_media_id)
  where instagram_media_id is not null;

create table if not exists public.influencer_media_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references public.influencer_profiles(id) on delete cascade,
  item_id uuid not null references public.influencer_content_items(id) on delete cascade,
  profile_content_id uuid references public.influencer_profile_content(id) on delete cascade,
  instagram_media_id text not null,
  fetched_at timestamptz not null default now(),
  views bigint,
  reach bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  saves bigint,
  total_interactions bigint,
  follows bigint,
  profile_visits bigint,
  avg_watch_time_seconds numeric,
  total_watch_time_seconds numeric,
  raw_metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists influencer_media_insights_profile_idx
  on public.influencer_media_insights(profile_id, fetched_at desc);

create index if not exists influencer_media_insights_item_idx
  on public.influencer_media_insights(item_id, fetched_at desc);

create index if not exists influencer_media_insights_media_idx
  on public.influencer_media_insights(instagram_media_id, fetched_at desc);

alter table public.influencer_media_insights enable row level security;

drop policy if exists influencer_media_insights_owner on public.influencer_media_insights;
create policy influencer_media_insights_owner on public.influencer_media_insights
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
