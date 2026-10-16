-- Influencer Manager: modos de processamento (Original, Legendado, Cortes).
-- Cada vídeo da biblioteca guarda como foi processado e sua transcrição. Os
-- cortes de um mesmo vídeo de origem compartilham o mesmo group_id.

alter table public.influencer_libraries
  add column if not exists caption_style text not null default 'karaoke';

alter table public.influencer_libraries
  drop constraint if exists influencer_libraries_caption_style_check;
alter table public.influencer_libraries
  add constraint influencer_libraries_caption_style_check
  check (caption_style in ('karaoke','fire','beasty','youshaei','harmozi','cinematic'));

alter table public.influencer_content_items
  add column if not exists processing_mode text not null default 'original',
  add column if not exists caption_style text,
  add column if not exists group_id uuid,
  add column if not exists clip_index integer,
  add column if not exists clip_count integer,
  add column if not exists clip_start numeric,
  add column if not exists clip_end numeric,
  add column if not exists transcript text;

alter table public.influencer_content_items
  drop constraint if exists influencer_content_items_processing_mode_check;
alter table public.influencer_content_items
  add constraint influencer_content_items_processing_mode_check
  check (processing_mode in ('original','captioned','clips'));

create index if not exists influencer_content_items_group_idx
  on public.influencer_content_items(group_id) where group_id is not null;
