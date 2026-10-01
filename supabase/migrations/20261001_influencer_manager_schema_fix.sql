-- Ajustes incrementais para instalações que já possuíam as tabelas do Influencer Manager.
alter table public.influencer_content_items
  add column if not exists result_url text;

alter table public.influencer_content_items
  add column if not exists clip_job_id uuid references public.clip_jobs(id) on delete set null;

alter table public.influencer_content_items
  add column if not exists worker_job_id text,
  add column if not exists worker_run_id bigint,
  add column if not exists progress integer not null default 0,
  add column if not exists stage text,
  add column if not exists publish_title text,
  add column if not exists publish_description text,
  add column if not exists source_description text;

alter table public.influencer_profiles
  add column if not exists cover_r2_key text,
  add column if not exists posting_times jsonb not null default '[]'::jsonb,
  add column if not exists auto_publish boolean not null default false,
  add column if not exists repeat_when_exhausted boolean not null default false,
  add column if not exists publishing_enabled boolean not null default false,
  add column if not exists next_publish_at timestamptz;

create index if not exists influencer_content_result_url_idx
  on public.influencer_content_items(profile_id, status);