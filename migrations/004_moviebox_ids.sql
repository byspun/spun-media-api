ALTER TABLE media_titles ADD COLUMN IF NOT EXISTS moviebox_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS media_titles_moviebox_id_unique_idx
  ON media_titles (moviebox_id)
  WHERE moviebox_id IS NOT NULL;
