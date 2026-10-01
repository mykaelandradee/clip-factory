-- Influencer Manager: schema final + biblioteca compartilhável entre perfis.
-- Idempotente: pode ser executada mesmo que parte das migrations anteriores já exista.

create table if not exists public.influencer_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  instagram_username text,
  posts_per_day integer not null default 3,
  posting_times jsonb not null default '[]'::jsonb,
  caption_mode text not null default 'zh_ja_random',
  cover_r2_key text,
  auto_publish boolean not null default false,
  repeat_when_exhausted boolean not null default false,
  publishing_enabled boolean not null default false,
  next_publish_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.influencer_profiles
  add column if not exists instagram_username text,
  add column if not exists posts_per_day integer not null default 3,
  add column if not exists posting_times jsonb not null default '[]'::jsonb,
  add column if not exists caption_mode text not null default 'zh_ja_random',
  add column if not exists cover_r2_key text,
  add column if not exists auto_publish boolean not null default false,
  add column if not exists repeat_when_exhausted boolean not null default false,
  add column if not exists publishing_enabled boolean not null default false,
  add column if not exists next_publish_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.influencer_content_items (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.influencer_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_url text not null,
  title text,
  source_type text not null default 'url',
  status text not null default 'queued',
  r2_key text,
  result_url text,
  clip_job_id uuid references public.clip_jobs(id) on delete set null,
  duration_seconds numeric,
  published_at timestamptz,
  scheduled_at timestamptz,
  error_message text,
  progress integer not null default 0,
  stage text,
  worker_job_id text,
  worker_run_id bigint,
  publish_title text,
  publish_description text,
  source_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.influencer_content_items
  add column if not exists profile_id uuid references public.influencer_profiles(id) on delete cascade,
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists source_url text,
  add column if not exists title text,
  add column if not exists source_type text not null default 'url',
  add column if not exists status text not null default 'queued',
  add column if not exists r2_key text,
  add column if not exists result_url text,
  add column if not exists clip_job_id uuid references public.clip_jobs(id) on delete set null,
  add column if not exists duration_seconds numeric,
  add column if not exists published_at timestamptz,
  add column if not exists scheduled_at timestamptz,
  add column if not exists error_message text,
  add column if not exists progress integer not null default 0,
  add column if not exists stage text,
  add column if not exists worker_job_id text,
  add column if not exists worker_run_id bigint,
  add column if not exists publish_title text,
  add column if not exists publish_description text,
  add column if not exists source_description text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.influencer_captions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.influencer_profiles(id) on delete cascade,
  language text not null,
  caption text not null,
  active boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Um vídeo processado pode pertencer a vários perfis sem duplicar o arquivo no R2.
create table if not exists public.influencer_content_shares (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.influencer_content_items(id) on delete cascade,
  profile_id uuid not null references public.influencer_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'available',
  scheduled_at timestamptz,
  published_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(item_id, profile_id)
);

create index if not exists influencer_profiles_user_idx on public.influencer_profiles(user_id);
create index if not exists influencer_content_profile_idx on public.influencer_content_items(profile_id,status,created_at);
create index if not exists influencer_content_user_idx on public.influencer_content_items(user_id);
create index if not exists influencer_shares_profile_idx on public.influencer_content_shares(profile_id,status,created_at);
create index if not exists influencer_shares_item_idx on public.influencer_content_shares(item_id);

alter table public.influencer_profiles enable row level security;
alter table public.influencer_content_items enable row level security;
alter table public.influencer_captions enable row level security;
alter table public.influencer_content_shares enable row level security;

drop policy if exists influencer_profiles_owner on public.influencer_profiles;
create policy influencer_profiles_owner on public.influencer_profiles
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists influencer_content_owner on public.influencer_content_items;
create policy influencer_content_owner on public.influencer_content_items
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists influencer_captions_owner on public.influencer_captions;
create policy influencer_captions_owner on public.influencer_captions
for all using (
  profile_id is null or exists (
    select 1 from public.influencer_profiles p
    where p.id = influencer_captions.profile_id and p.user_id = auth.uid()
  )
)
with check (
  profile_id is null or exists (
    select 1 from public.influencer_profiles p
    where p.id = influencer_captions.profile_id and p.user_id = auth.uid()
  )
);

drop policy if exists influencer_content_shares_owner on public.influencer_content_shares;
create policy influencer_content_shares_owner on public.influencer_content_shares
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.set_influencer_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists influencer_profiles_updated_at on public.influencer_profiles;
create trigger influencer_profiles_updated_at
before update on public.influencer_profiles
for each row execute function public.set_influencer_updated_at();

drop trigger if exists influencer_content_updated_at on public.influencer_content_items;
create trigger influencer_content_updated_at
before update on public.influencer_content_items
for each row execute function public.set_influencer_updated_at();

drop trigger if exists influencer_content_shares_updated_at on public.influencer_content_shares;
create trigger influencer_content_shares_updated_at
before update on public.influencer_content_shares
for each row execute function public.set_influencer_updated_at();

-- Copia conteúdos já existentes como compartilhados apenas quando necessário:
-- não duplica arquivos e não cria cópias automáticas entre perfis.
