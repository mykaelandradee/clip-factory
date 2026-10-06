-- Finalize the library-first Influencer Manager architecture.
-- Content ownership and publication state are represented by
-- influencer_content_items.library_id and influencer_profile_content.
-- Existing R2 objects remain safe because their exact key is stored in r2_key.

ALTER TABLE public.influencer_content_items
  DROP COLUMN IF EXISTS profile_id;
