-- Complementa o schema do Influencer Manager para instalações que já executaram a migration inicial.
alter table public.influencer_profiles
  add column if not exists description text,
  add column if not exists fixed_publish_title text,
  add column if not exists fixed_publish_description text,
  add column if not exists share_to_feed boolean not null default true,
  add column if not exists publishing_enabled boolean not null default false,
  add column if not exists next_publish_at timestamptz;

alter table public.influencer_content_items
  add column if not exists result_url text,
  add column if not exists worker_job_id text,
  add column if not exists worker_run_id bigint,
  add column if not exists progress integer not null default 0,
  add column if not exists stage text,
  add column if not exists publish_title text,
  add column if not exists publish_description text,
  add column if not exists source_description text;

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

-- Perfis já existentes ficam com identidade fixa somente quando já houver conteúdo definido.
update public.influencer_profiles
set fixed_publish_title = coalesce(nullif(fixed_publish_title, ''), name),
    fixed_publish_description = coalesce(nullif(fixed_publish_description, ''), description)
where fixed_publish_title is null or fixed_publish_description is null;
