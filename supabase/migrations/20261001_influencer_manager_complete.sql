-- Completa a estrutura usada pela tela e pelas APIs do Influencer Manager.
alter table public.influencer_profiles
  add column if not exists fixed_publish_title text,
  add column if not exists fixed_publish_description text,
  add column if not exists share_to_feed boolean not null default true;

-- Garante que a biblioteca tenha a URL final usada no preview/publicação.
alter table public.influencer_content_items
  add column if not exists result_url text,
  add column if not exists clip_job_id uuid references public.clip_jobs(id) on delete set null;

create index if not exists influencer_content_clip_job_idx
  on public.influencer_content_items(clip_job_id);
