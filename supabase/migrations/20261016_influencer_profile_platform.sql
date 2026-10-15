-- Perfis por plataforma no Influencer Manager.
-- Cada perfil publica em uma única rede: Instagram (Reels) ou YouTube (Shorts).
-- Perfis existentes continuam como Instagram.

alter table public.influencer_profiles
  add column if not exists platform text not null default 'instagram',
  add column if not exists youtube_channel_title text;

alter table public.influencer_profiles
  drop constraint if exists influencer_profiles_platform_check;
alter table public.influencer_profiles
  add constraint influencer_profiles_platform_check check (platform in ('instagram','youtube'));

alter table public.influencer_profile_content
  add column if not exists youtube_video_id text;

-- Perfis que só têm um canal do YouTube conectado passam a ser perfis do YouTube.
update public.influencer_profiles p
set platform = 'youtube',
    youtube_channel_title = c.channel_title,
    updated_at = now()
from public.influencer_youtube_connections c
where c.profile_id = p.id
  and not exists (
    select 1 from public.influencer_instagram_connections i where i.profile_id = p.id
  );

-- Perfis do Instagram não publicam mais no YouTube: envios pendentes são
-- cancelados e o canal é liberado para ser conectado a um perfil do YouTube.
update public.influencer_youtube_posts y
set status = 'canceled', error_message = 'Perfil do Instagram: o YouTube agora usa um perfil próprio.', updated_at = now()
from public.influencer_profiles p
where y.profile_id = p.id and p.platform = 'instagram' and y.status in ('scheduled','processing');

delete from public.influencer_youtube_connections c
using public.influencer_profiles p
where c.profile_id = p.id and p.platform = 'instagram';
