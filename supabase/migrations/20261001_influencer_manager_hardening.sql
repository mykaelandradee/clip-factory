-- Influencer Manager: garante a estrutura usada pela capa, biblioteca e worker.
-- Seguro para executar mesmo se parte da migration anterior já tiver sido aplicada.

alter table public.influencer_profiles
  add column if not exists cover_r2_key text,
  add column if not exists posting_times jsonb not null default '[]'::jsonb,
  add column if not exists caption_mode text not null default 'zh_ja_random',
  add column if not exists auto_publish boolean not null default false,
  add column if not exists repeat_when_exhausted boolean not null default false,
  add column if not exists publishing_enabled boolean not null default false,
  add column if not exists next_publish_at timestamptz;

alter table public.influencer_content_items
  add column if not exists result_url text,
  add column if not exists clip_job_id uuid references public.clip_jobs(id) on delete set null,
  add column if not exists worker_job_id text,
  add column if not exists worker_run_id bigint,
  add column if not exists progress integer not null default 0,
  add column if not exists stage text,
  add column if not exists publish_title text,
  add column if not exists publish_description text,
  add column if not exists source_description text,
  add column if not exists duration_seconds numeric,
  add column if not exists published_at timestamptz,
  add column if not exists scheduled_at timestamptz,
  add column if not exists error_message text;

create index if not exists influencer_content_worker_job_idx on public.influencer_content_items(worker_job_id);
create index if not exists influencer_content_clip_job_idx on public.influencer_content_items(clip_job_id);
create index if not exists influencer_profiles_publish_idx on public.influencer_profiles(publishing_enabled, next_publish_at);
