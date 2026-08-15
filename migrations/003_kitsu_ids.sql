-- Add Kitsu identity support for anime catalog rows.
ALTER TABLE media_titles
  ADD COLUMN IF NOT EXISTS kitsu_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS media_titles_kitsu_id_unique_idx
  ON media_titles (kitsu_id)
  WHERE kitsu_id IS NOT NULL;
