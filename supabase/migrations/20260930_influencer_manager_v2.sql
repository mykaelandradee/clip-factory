-- Influencer Manager v2: processed vertical video, generated captions and persistent publishing controls.

alter table public.influencer_profiles
  add column if not exists publishing_enabled boolean not null default false;

alter table public.influencer_content_items
  add column if not exists progress integer not null default 0,
  add column if not exists stage text,
  add column if not exists worker_job_id uuid,
  add column if not exists worker_run_id bigint,
  add column if not exists publish_title text,
  add column if not exists publish_description text,
  add column if not exists source_description text;

create index if not exists influencer_content_publish_queue_idx
  on public.influencer_content_items(profile_id, status, scheduled_at, created_at);

-- Extra short/medium Chinese/Japanese captions used as visual previews and publication captions.
insert into public.influencer_captions (profile_id, language, caption)
select null, v.language, v.caption
from (values
  ('zh','真的太离谱了 😂'),
  ('zh','这个瞬间太精彩了。'),
  ('zh','看到这里真的笑了。'),
  ('zh','今天也遇到了这种瞬间。'),
  ('zh','有时候现实比电影还精彩。'),
  ('zh','这一幕真的值得看第二遍。'),
  ('zh','完全没想到会这样。'),
  ('zh','这也太有意思了吧。'),
  ('ja','これは面白すぎる 😂'),
  ('ja','この瞬間は最高すぎる。'),
  ('ja','ここで本当に笑った。'),
  ('ja','今日はこんな瞬間に出会った。'),
  ('ja','現実は映画より面白い。'),
  ('ja','これはもう一回見たくなる。'),
  ('ja','まさかこんな展開になるとは。'),
  ('ja','これは本当に面白い。')
) as v(language,caption)
where not exists (
  select 1 from public.influencer_captions c
  where c.profile_id is null and c.language=v.language and c.caption=v.caption
);