-- Storage privado para capas fixas do Influencer Manager.
-- O servidor usa SUPABASE_SERVICE_ROLE_KEY para upload/download, portanto
-- não precisamos expor o bucket publicamente nem criar políticas de escrita.

insert into storage.buckets (id, name, public)
values ('influencer-covers', 'influencer-covers', false)
on conflict (id) do update set public = false;
