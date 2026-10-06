-- Remove legacy sharing table replaced by the library-first architecture.
-- Verified in Supabase before this migration: the table contains 0 rows.

DROP TABLE IF EXISTS public.influencer_content_shares;
