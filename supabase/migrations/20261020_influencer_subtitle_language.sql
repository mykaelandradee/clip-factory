-- Influencer Manager: idioma da legenda (original, português ou inglês).
-- Padrão português: o público dos perfis é brasileiro.

alter table public.influencer_libraries
  add column if not exists subtitle_language text not null default 'pt-BR';

alter table public.influencer_libraries
  drop constraint if exists influencer_libraries_subtitle_language_check;
alter table public.influencer_libraries
  add constraint influencer_libraries_subtitle_language_check
  check (subtitle_language in ('original','pt-BR','en'));

alter table public.influencer_content_items
  add column if not exists subtitle_language text;
