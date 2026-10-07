-- Instagram Stories para o Influencer Manager.
alter table public.influencer_profiles
  add column if not exists auto_story boolean not null default false,
  add column if not exists story_delay_minutes integer not null default 30
    check (story_delay_minutes between 0 and 1440);

create table if not exists public.influencer_story_posts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.influencer_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.influencer_content_items(id) on delete cascade,
  profile_content_id uuid references public.influencer_profile_content(id) on delete cascade,
  reel_media_id text,
  story_media_id text,
  status text not null default 'scheduled'
    check (status in ('scheduled','processing','published','failed','canceled')),
  scheduled_at timestamptz not null,
  published_at timestamptz,
  error_message text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(profile_id, profile_content_id)
);

create index if not exists influencer_story_posts_due_idx
  on public.influencer_story_posts(status, scheduled_at);

create index if not exists influencer_story_posts_profile_idx
  on public.influencer_story_posts(profile_id, status);

alter table public.influencer_story_posts enable row level security;

drop policy if exists influencer_story_posts_owner on public.influencer_story_posts;
create policy influencer_story_posts_owner on public.influencer_story_posts
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists influencer_story_posts_updated_at on public.influencer_story_posts;
create trigger influencer_story_posts_updated_at before update on public.influencer_story_posts
for each row execute function public.set_influencer_updated_at();
