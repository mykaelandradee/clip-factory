-- Influencer Manager: add runtime metadata required by the worker/library.
alter table public.influencer_content_items
  add column if not exists worker_job_id text,
  add column if not exists worker_run_id bigint,
  add column if not exists progress integer not null default 0,
  add column if not exists stage text,
  add column if not exists publish_title text,
  add column if not exists publish_description text,
  add column if not exists source_description text;

create index if not exists influencer_content_worker_job_idx
  on public.influencer_content_items(worker_job_id);
