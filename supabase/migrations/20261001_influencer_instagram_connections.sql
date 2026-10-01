create table if not exists public.influencer_instagram_connections (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.influencer_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  instagram_user_id text not null,
  username text,
  access_token_encrypted text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(profile_id),
  unique(user_id, instagram_user_id)
);

create index if not exists influencer_ig_connections_user_idx
  on public.influencer_instagram_connections(user_id);

alter table public.influencer_instagram_connections enable row level security;

drop policy if exists influencer_ig_connections_owner on public.influencer_instagram_connections;
create policy influencer_ig_connections_owner
on public.influencer_instagram_connections
for all using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop trigger if exists influencer_ig_connections_updated_at on public.influencer_instagram_connections;
create trigger influencer_ig_connections_updated_at
before update on public.influencer_instagram_connections
for each row execute function public.set_influencer_updated_at();
