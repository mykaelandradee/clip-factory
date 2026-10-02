alter table public.influencer_instagram_connections
  add column if not exists requires_reconnect boolean not null default false,
  add column if not exists last_refresh_error text;

create index if not exists influencer_ig_reconnect_idx
  on public.influencer_instagram_connections(profile_id,requires_reconnect);
