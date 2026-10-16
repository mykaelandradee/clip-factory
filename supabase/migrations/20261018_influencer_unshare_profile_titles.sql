-- Influencer Manager: remove títulos/descrições de perfil gravados nos vídeos.
--
-- Até agora, ao adicionar um vídeo à biblioteca, o título e a descrição fixos do
-- perfil usado no processamento eram gravados no próprio vídeo, que é
-- compartilhado entre perfis. Esses textos são limpos aqui; na publicação, cada
-- perfil usa o próprio texto fixo ou o texto automático em chinês/japonês.

update public.influencer_content_items i
set publish_title = null, updated_at = now()
where i.publish_title is not null
  and exists (
    select 1 from public.influencer_profiles p
    where p.user_id = i.user_id
      and nullif(trim(p.fixed_publish_title), '') = trim(i.publish_title)
  );

update public.influencer_content_items i
set publish_description = null, updated_at = now()
where i.publish_description is not null
  and exists (
    select 1 from public.influencer_profiles p
    where p.user_id = i.user_id
      and nullif(trim(p.fixed_publish_description), '') = trim(i.publish_description)
  );
