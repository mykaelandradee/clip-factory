alter table public.influencer_profiles
  add column if not exists fixed_publish_title text,
  add column if not exists fixed_publish_description text,
  add column if not exists share_to_feed boolean not null default true;

update public.influencer_profiles
set share_to_feed = true
where share_to_feed is null;
