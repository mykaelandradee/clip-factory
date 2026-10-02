-- Automatic publication recovery: track per-item and per-share publish retries.
alter table public.influencer_profiles
  add column if not exists publish_retry_count integer not null default 0;

alter table public.influencer_content_items
  add column if not exists retry_count integer not null default 0;

alter table public.influencer_content_shares
  add column if not exists retry_count integer not null default 0;

create index if not exists influencer_content_retry_idx
  on public.influencer_content_items(profile_id,status,retry_count);

create index if not exists influencer_content_share_retry_idx
  on public.influencer_content_shares(profile_id,status,retry_count);
