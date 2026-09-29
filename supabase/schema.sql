-- Clip Factory: persistent multi-user identity and YouTube connections.
-- Run this once in the Supabase SQL Editor.

create table if not exists public.youtube_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  refresh_token_encrypted text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create index if not exists youtube_connections_user_id_idx
  on public.youtube_connections(user_id);

alter table public.youtube_connections enable row level security;

-- The browser never reads this table. Server routes use the service-role key.
-- Therefore no client-facing RLS policy is intentionally created.

create table if not exists public.clip_jobs (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Anonymous visitors may generate clips. Authenticated users keep ownership when logged in.
alter table public.clip_jobs alter column user_id drop not null;

create index if not exists clip_jobs_user_id_idx
  on public.clip_jobs(user_id);

alter table public.clip_jobs enable row level security;

-- Jobs are also accessed only by server routes with the service-role key.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists youtube_connections_updated_at on public.youtube_connections;

create trigger youtube_connections_updated_at
before update on public.youtube_connections
for each row execute function public.set_updated_at();

-- Instagram connections are isolated by the authenticated Clip Factory user.
create table if not exists public.instagram_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  instagram_user_id text not null,
  username text,
  access_token_encrypted text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create index if not exists instagram_connections_user_id_idx
  on public.instagram_connections(user_id);

alter table public.instagram_connections enable row level security;

drop policy if exists "Users can view their Instagram connection" on public.instagram_connections;
create policy "Users can view their Instagram connection"
  on public.instagram_connections
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their Instagram connection" on public.instagram_connections;
create policy "Users can insert their Instagram connection"
  on public.instagram_connections
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their Instagram connection" on public.instagram_connections;
create policy "Users can update their Instagram connection"
  on public.instagram_connections
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- FASE 5 — histórico de gerações.
alter table public.clip_jobs add column if not exists source_url text;
alter table public.clip_jobs add column if not exists source_title text;
alter table public.clip_jobs add column if not exists requested_count integer;
alter table public.clip_jobs add column if not exists min_duration integer;
alter table public.clip_jobs add column if not exists max_duration integer;
alter table public.clip_jobs add column if not exists subtitle_language text;
alter table public.clip_jobs add column if not exists caption_style text;

create index if not exists clip_jobs_created_at_idx
  on public.clip_jobs(created_at desc);


-- Automatic retention for job metadata. Video files are cleaned independently from R2.
create extension if not exists pg_cron;

create or replace function public.cleanup_clip_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.clip_jobs
  where created_at < now() - interval '90 days';

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.cleanup_clip_jobs() from public;

do $do$
begin
  if not exists (
    select 1
    from cron.job
    where jobname = 'clip-jobs-cleanup'
  ) then
    perform cron.schedule(
      'clip-jobs-cleanup',
      '17 4 * * *',
      $cron$select public.cleanup_clip_jobs();$cron$
    );
  end if;
end;
$do$;


-- Scheduled YouTube publications.
create table if not exists public.youtube_scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.clip_jobs(id) on delete cascade,
  file text not null,
  video_id text not null,
  title text not null,
  scheduled_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists youtube_scheduled_posts_user_id_idx
  on public.youtube_scheduled_posts(user_id);

create unique index if not exists youtube_scheduled_posts_user_video_idx
  on public.youtube_scheduled_posts(user_id, video_id);

create index if not exists youtube_scheduled_posts_status_idx
  on public.youtube_scheduled_posts(status, scheduled_at);

alter table public.youtube_scheduled_posts enable row level security;

drop policy if exists "Users can view their scheduled YouTube posts" on public.youtube_scheduled_posts;
create policy "Users can view their scheduled YouTube posts"
  on public.youtube_scheduled_posts
  for select
  using (auth.uid() = user_id);

drop trigger if exists youtube_scheduled_posts_updated_at on public.youtube_scheduled_posts;
create trigger youtube_scheduled_posts_updated_at
before update on public.youtube_scheduled_posts
for each row execute function public.set_updated_at();


-- Scheduler HTTP support for automatic Instagram publications.
create extension if not exists pg_net;

-- Scheduled Instagram publications.
create table if not exists public.instagram_scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.clip_jobs(id) on delete cascade,
  file text not null,
  caption text not null,
  scheduled_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'processing', 'published', 'failed', 'canceled')),
  attempts integer not null default 0,
  media_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists instagram_scheduled_posts_due_idx
  on public.instagram_scheduled_posts(status, scheduled_at);

create index if not exists instagram_scheduled_posts_user_id_idx
  on public.instagram_scheduled_posts(user_id);

alter table public.instagram_scheduled_posts enable row level security;

drop policy if exists "Users can view their scheduled Instagram posts" on public.instagram_scheduled_posts;
create policy "Users can view their scheduled Instagram posts"
  on public.instagram_scheduled_posts
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their scheduled Instagram posts" on public.instagram_scheduled_posts;
create policy "Users can insert their scheduled Instagram posts"
  on public.instagram_scheduled_posts
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their scheduled Instagram posts" on public.instagram_scheduled_posts;
create policy "Users can update their scheduled Instagram posts"
  on public.instagram_scheduled_posts
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists instagram_scheduled_posts_updated_at on public.instagram_scheduled_posts;
create trigger instagram_scheduled_posts_updated_at
before update on public.instagram_scheduled_posts
for each row execute function public.set_updated_at();
