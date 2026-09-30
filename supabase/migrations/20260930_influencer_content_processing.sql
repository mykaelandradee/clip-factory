alter table public.influencer_content_items add column if not exists result_url text;
alter table public.influencer_content_items add column if not exists clip_job_id uuid references public.clip_jobs(id) on delete set null;
create index if not exists influencer_content_clip_job_idx on public.influencer_content_items(clip_job_id);
