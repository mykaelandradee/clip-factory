-- Influencer Manager: separate content libraries from publishing profiles.
-- Phase 1 only: additive schema. Existing profile/content/share tables remain
-- untouched so the current production flow keeps working during migration.
--
-- Safe to run once in Supabase SQL Editor. All objects are idempotent.

create table if not exists public.influencer_libraries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists influencer_libraries_user_idx
  on public.influencer_libraries(user_id);

create unique index if not exists influencer_libraries_user_name_key
  on public.influencer_libraries(user_id, lower(name));

alter table public.influencer_libraries enable row level security;

drop policy if exists influencer_libraries_owner
  on public.influencer_libraries;

create policy influencer_libraries_owner
  on public.influencer_libraries
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


create table if not exists public.influencer_profile_libraries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.influencer_profiles(id) on delete cascade,
  library_id uuid not null references public.influencer_libraries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  priority integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(profile_id, library_id)
);

create index if not exists influencer_profile_libraries_profile_idx
  on public.influencer_profile_libraries(profile_id, enabled, priority);

create index if not exists influencer_profile_libraries_library_idx
  on public.influencer_profile_libraries(library_id, enabled);

create index if not exists influencer_profile_libraries_user_idx
  on public.influencer_profile_libraries(user_id);

alter table public.influencer_profile_libraries enable row level security;

drop policy if exists influencer_profile_libraries_owner
  on public.influencer_profile_libraries;

create policy influencer_profile_libraries_owner
  on public.influencer_profile_libraries
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- Add the future ownership column without changing the current application.
-- It remains nullable during the transition because existing content still
-- uses influencer_content_items.profile_id.
alter table public.influencer_content_items
  add column if not exists library_id uuid
  references public.influencer_libraries(id) on delete set null;

create index if not exists influencer_content_library_status_idx
  on public.influencer_content_items(library_id, status, created_at);

create index if not exists influencer_content_library_idx
  on public.influencer_content_items(library_id);


-- Keep updated_at behavior consistent with the existing Influencer Manager.
drop trigger if exists influencer_libraries_updated_at
  on public.influencer_libraries;

create trigger influencer_libraries_updated_at
before update on public.influencer_libraries
for each row execute function public.set_influencer_updated_at();

drop trigger if exists influencer_profile_libraries_updated_at
  on public.influencer_profile_libraries;

create trigger influencer_profile_libraries_updated_at
before update on public.influencer_profile_libraries
for each row execute function public.set_influencer_updated_at();


-- RLS for the new content relationship is intentionally additive.
-- The existing content policy continues to protect content through user_id.
-- No existing rows are modified by this migration.

-- Validation queries after execution:
-- select table_name
-- from information_schema.tables
-- where table_schema = 'public'
--   and table_name in ('influencer_libraries','influencer_profile_libraries')
-- order by table_name;
--
-- select column_name
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'influencer_content_items'
--   and column_name = 'library_id';


-- Per-profile publication state for library content.
-- This is required because one library item may be published by multiple
-- profiles independently. The old influencer_content_items.status is global
-- to the video and cannot represent that safely.
create table if not exists public.influencer_profile_content (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.influencer_profiles(id) on delete cascade,
  item_id uuid not null references public.influencer_content_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'available',
  scheduled_at timestamptz,
  published_at timestamptz,
  error_message text,
  retry_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(profile_id, item_id)
);

create index if not exists influencer_profile_content_profile_idx
  on public.influencer_profile_content(profile_id, status, created_at);

create index if not exists influencer_profile_content_item_idx
  on public.influencer_profile_content(item_id, status);

create index if not exists influencer_profile_content_user_idx
  on public.influencer_profile_content(user_id);

alter table public.influencer_profile_content enable row level security;

drop policy if exists influencer_profile_content_owner
  on public.influencer_profile_content;

create policy influencer_profile_content_owner
  on public.influencer_profile_content
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists influencer_profile_content_updated_at
  on public.influencer_profile_content;

create trigger influencer_profile_content_updated_at
before update on public.influencer_profile_content
for each row execute function public.set_influencer_updated_at();


-- Seed publication state for the content already assigned to each profile.
-- This does not change the current content status or publishing history.
insert into public.influencer_profile_content (
  profile_id,
  item_id,
  user_id,
  status,
  scheduled_at,
  published_at,
  error_message,
  retry_count,
  created_at,
  updated_at
)
select
  i.profile_id,
  i.id,
  i.user_id,
  case
    when i.status in ('processing','queued','available','scheduled','published','failed')
      then i.status
    else 'available'
  end,
  i.scheduled_at,
  i.published_at,
  i.error_message,
  coalesce(i.retry_count, 0),
  coalesce(i.created_at, now()),
  now()
from public.influencer_content_items i
where i.profile_id is not null
on conflict (profile_id, item_id) do nothing;
