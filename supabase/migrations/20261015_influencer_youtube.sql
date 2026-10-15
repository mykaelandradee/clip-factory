-- YouTube por perfil no Influencer Manager.
-- Cada perfil pode ter um canal do YouTube, além do Instagram. Cada Reel
-- publicado no Instagram entra numa fila e é enviado ao canal como Short.

create table if not exists public.influencer_youtube_connections (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.influencer_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel_id text not null,
  channel_title text,
  channel_handle text,
  refresh_token_encrypted text not null,
  requires_reconnect boolean not null default false,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(profile_id),
  unique(user_id, channel_id)
);

create index if not exists influencer_yt_connections_user_idx
  on public.influencer_youtube_connections(user_id);

alter table public.influencer_youtube_connections enable row level security;

drop policy if exists influencer_yt_connections_owner on public.influencer_youtube_connections;
create policy influencer_yt_connections_owner
on public.influencer_youtube_connections
for all using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop trigger if exists influencer_yt_connections_updated_at on public.influencer_youtube_connections;
create trigger influencer_yt_connections_updated_at
before update on public.influencer_youtube_connections
for each row execute function public.set_influencer_updated_at();

create table if not exists public.influencer_youtube_posts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.influencer_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.influencer_content_items(id) on delete cascade,
  profile_content_id uuid references public.influencer_profile_content(id) on delete set null,
  reel_media_id text,
  youtube_video_id text,
  privacy_status text,
  title text,
  status text not null default 'scheduled'
    check (status in ('scheduled','processing','published','failed','canceled')),
  scheduled_at timestamptz not null default now(),
  published_at timestamptz,
  error_message text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists influencer_youtube_posts_due_idx
  on public.influencer_youtube_posts(status, scheduled_at);

create index if not exists influencer_youtube_posts_profile_idx
  on public.influencer_youtube_posts(profile_id, created_at desc);

alter table public.influencer_youtube_posts enable row level security;

drop policy if exists influencer_youtube_posts_owner on public.influencer_youtube_posts;
create policy influencer_youtube_posts_owner on public.influencer_youtube_posts
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists influencer_youtube_posts_updated_at on public.influencer_youtube_posts;
create trigger influencer_youtube_posts_updated_at before update on public.influencer_youtube_posts
for each row execute function public.set_influencer_updated_at();
