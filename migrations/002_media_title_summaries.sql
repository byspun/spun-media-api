ALTER TABLE media_titles
  ADD COLUMN IF NOT EXISTS year SMALLINT,
  ADD COLUMN IF NOT EXISTS rating NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS poster_path TEXT,
  ADD COLUMN IF NOT EXISTS summary_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS media_titles_summary_backfill_idx
  ON media_titles (summary_synced_at, created_at);
