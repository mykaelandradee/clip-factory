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
