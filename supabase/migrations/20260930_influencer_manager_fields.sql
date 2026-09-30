-- Influencer Manager: fields needed by the async worker, per-Reel copy and hard deletion.
alter table public.influencer_content_items
  add column if not exists progress integer not null default 0 check (progress between 0 and 100),
  add column if not exists stage text,
  add column if not exists worker_job_id uuid,
  add column if not exists worker_run_id bigint,
  add column if not exists publish_title text,
  add column if not exists publish_description text;

create index if not exists influencer_content_worker_run_idx
  on public.influencer_content_items(worker_run_id);

-- Existing imported videos use their source title as the default Reel title.
update public.influencer_content_items
set publish_title = coalesce(publish_title, title)
where publish_title is null;
