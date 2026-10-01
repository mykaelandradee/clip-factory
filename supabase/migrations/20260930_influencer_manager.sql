create table if not exists public.influencer_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  instagram_username text,
  posts_per_day integer not null default 3 check (posts_per_day between 1 and 9),
  posting_times jsonb not null default '[]'::jsonb,
  caption_mode text not null default 'zh_ja_random' check (caption_mode in ('zh_random','ja_random','zh_ja_random','custom')),
  cover_r2_key text,
  auto_publish boolean not null default false,
  repeat_when_exhausted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.influencer_content_items (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.influencer_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_url text not null,
  title text,
  source_type text not null default 'url' check (source_type in ('url','upload')),
  status text not null default 'queued' check (status in ('queued','processing','available','scheduled','published','failed','archived')),
  r2_key text,
  result_url text,
  clip_job_id uuid references public.clip_jobs(id) on delete set null,
  duration_seconds numeric,
  published_at timestamptz,
  scheduled_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.influencer_captions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.influencer_profiles(id) on delete cascade,
  language text not null check (language in ('zh','ja')),
  caption text not null,
  active boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists influencer_profiles_user_id_idx on public.influencer_profiles(user_id);
create index if not exists influencer_content_profile_status_idx on public.influencer_content_items(profile_id,status);
create index if not exists influencer_content_user_id_idx on public.influencer_content_items(user_id);
create index if not exists influencer_captions_profile_language_idx on public.influencer_captions(profile_id,language,active);

alter table public.influencer_profiles enable row level security;
alter table public.influencer_content_items enable row level security;
alter table public.influencer_captions enable row level security;

drop policy if exists influencer_profiles_owner on public.influencer_profiles;
create policy influencer_profiles_owner on public.influencer_profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists influencer_content_owner on public.influencer_content_items;
create policy influencer_content_owner on public.influencer_content_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists influencer_captions_owner on public.influencer_captions;
create policy influencer_captions_owner on public.influencer_captions
for all using (
  exists (select 1 from public.influencer_profiles p where p.id = influencer_captions.profile_id and p.user_id = auth.uid())
)
with check (
  exists (select 1 from public.influencer_profiles p where p.id = influencer_captions.profile_id and p.user_id = auth.uid())
);

create or replace function public.set_influencer_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists influencer_profiles_updated_at on public.influencer_profiles;
create trigger influencer_profiles_updated_at before update on public.influencer_profiles
for each row execute function public.set_influencer_updated_at();

drop trigger if exists influencer_content_updated_at on public.influencer_content_items;
create trigger influencer_content_updated_at before update on public.influencer_content_items
for each row execute function public.set_influencer_updated_at();

insert into public.influencer_captions (profile_id, language, caption)
select null, v.language, v.caption
from (values
  ('zh','今天真的太有意思了 😂'),
  ('zh','这个瞬间真的太经典了。'),
  ('zh','有时候真的不知道该说什么。'),
  ('zh','生活中总有一些意想不到的瞬间。'),
  ('ja','これは本当に面白すぎる 😂'),
  ('ja','この瞬間は本当に最高です。'),
  ('ja','何と言えばいいのかわからない。'),
  ('ja','日常には予想できない瞬間があります。')
) as v(language,caption)
where false;


create index if not exists influencer_content_clip_job_idx on public.influencer_content_items(clip_job_id);


-- Campos usados pelo worker assíncrono e pela biblioteca/editor do Influencer Manager.
alter table public.influencer_content_items
  add column if not exists worker_job_id text,
  add column if not exists worker_run_id bigint,
  add column if not exists progress integer not null default 0,
  add column if not exists stage text,
  add column if not exists publish_title text,
  add column if not exists publish_description text,
  add column if not exists source_description text;

create index if not exists influencer_content_worker_job_idx on public.influencer_content_items(worker_job_id);


-- Campos usados pelo controle automático de publicação.
alter table public.influencer_profiles
  add column if not exists publishing_enabled boolean not null default false,
  add column if not exists next_publish_at timestamptz,
  add column if not exists description text,
  add column if not exists fixed_publish_title text,
  add column if not exists fixed_publish_description text,
  add column if not exists share_to_feed boolean not null default true;

create index if not exists influencer_profiles_publish_idx
  on public.influencer_profiles(publishing_enabled, next_publish_at);

-- Compartilhamento de itens entre perfis do mesmo usuário.
create table if not exists public.influencer_content_shares (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.influencer_content_items(id) on delete cascade,
  profile_id uuid not null references public.influencer_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','available','scheduled','published','failed','canceled')),
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

drop policy if exists influencer_content_shares_owner on public.influencer_content_shares;
create policy influencer_content_shares_owner on public.influencer_content_shares
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
