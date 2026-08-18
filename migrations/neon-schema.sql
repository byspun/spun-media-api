-- Spün Media API canonical Neon schema extensions
-- Run this script after the base media_titles table has been created.
-- All statements are idempotent and preserve 19-digit MovieBox IDs exactly.

ALTER TABLE media_titles
  ADD COLUMN IF NOT EXISTS year SMALLINT,
  ADD COLUMN IF NOT EXISTS rating NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS poster_path TEXT,
  ADD COLUMN IF NOT EXISTS summary_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS media_titles_summary_backfill_idx
  ON media_titles (summary_synced_at, created_at);

ALTER TABLE media_titles
  ADD COLUMN IF NOT EXISTS kitsu_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS media_titles_kitsu_id_unique_idx
  ON media_titles (kitsu_id)
  WHERE kitsu_id IS NOT NULL;

-- MovieBox subject IDs can be 19 digits, so this must remain TEXT rather than BIGINT.
ALTER TABLE media_titles
  ADD COLUMN IF NOT EXISTS moviebox_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS media_titles_moviebox_id_unique_idx
  ON media_titles (moviebox_id)
  WHERE moviebox_id IS NOT NULL;
