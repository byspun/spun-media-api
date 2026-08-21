-- Spün Media API canonical Neon database schema
-- Generated from the live Neon project odd-resonance-48189926 on 2026-08-18.
-- Run this file in any PostgreSQL-compatible SQL editor connected to Neon.
-- Runtime tables are created empty; the static studio registry is seeded below.

BEGIN;

-- The live database contains this sequence object. The current provider_health
-- table does not use it as a column default, but it is preserved for parity.
CREATE SEQUENCE IF NOT EXISTS public.provider_health_id_seq
  AS BIGINT START WITH 1 INCREMENT BY 1 MINVALUE 1
  MAXVALUE 9223372036854775807 NO CYCLE;

CREATE TABLE IF NOT EXISTS public.media_titles (
  spun_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  content_type TEXT NOT NULL,
  title TEXT NOT NULL,
  tmdb_id BIGINT,
  anilist_id BIGINT,
  mal_id BIGINT,
  imdb_id TEXT,
  tvdb_id BIGINT,
  daratech_id TEXT,
  daratech_score SMALLINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  year SMALLINT,
  rating NUMERIC(3,1),
  poster_path TEXT,
  summary_synced_at TIMESTAMPTZ,
  kitsu_id BIGINT,
  moviebox_id TEXT,
  CONSTRAINT media_titles_pkey PRIMARY KEY (spun_id),
  CONSTRAINT media_titles_content_type_check CHECK (content_type IN ('movie', 'tv', 'anime')),
  CONSTRAINT media_titles_daratech_score_check CHECK (daratech_score >= 0 AND daratech_score <= 100)
);

CREATE TABLE IF NOT EXISTS public.episode_cache (
  spun_id TEXT NOT NULL,
  mal_id BIGINT NOT NULL,
  episodes_json JSONB NOT NULL,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT episode_cache_pkey PRIMARY KEY (spun_id),
  CONSTRAINT episode_cache_spun_id_fkey FOREIGN KEY (spun_id)
    REFERENCES public.media_titles (spun_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.provider_health (
  id BIGINT NOT NULL,
  provider_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'healthy',
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  consecutive_failures SMALLINT NOT NULL DEFAULT 0,
  last_error TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT provider_health_pkey PRIMARY KEY (id),
  CONSTRAINT provider_health_content_type_check CHECK (content_type IN ('movie', 'tv', 'anime')),
  CONSTRAINT provider_health_status_check CHECK (status IN ('healthy', 'degraded', 'down'))
);

CREATE TABLE IF NOT EXISTS public.studio_ids (
  spun_studio_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  query_type TEXT NOT NULL,
  query_value TEXT NOT NULL,
  description TEXT,
  logo_url TEXT,
  CONSTRAINT studio_ids_pkey PRIMARY KEY (spun_studio_id),
  CONSTRAINT studio_ids_category_check CHECK (category IN ('streaming', 'network', 'production', 'anime')),
  CONSTRAINT studio_ids_query_type_check CHECK (query_type IN ('watch_provider', 'network', 'company', 'anilist_studio'))
);

CREATE TABLE IF NOT EXISTS public.log_archives (
  service TEXT NOT NULL,
  log_date DATE NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT log_archives_pkey PRIMARY KEY (service, log_date),
  CONSTRAINT log_archives_service_check CHECK (service IN ('metadata', 'providers'))
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS media_titles_kitsu_id_unique_idx
  ON public.media_titles (kitsu_id) WHERE kitsu_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS media_titles_moviebox_id_unique_idx
  ON public.media_titles (moviebox_id) WHERE moviebox_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS media_titles_summary_backfill_idx
  ON public.media_titles (summary_synced_at, created_at);

CREATE INDEX IF NOT EXISTS idx_media_titles_anilist_id ON public.media_titles (anilist_id);
CREATE INDEX IF NOT EXISTS idx_media_titles_content_type ON public.media_titles (content_type);
CREATE INDEX IF NOT EXISTS idx_media_titles_imdb_id ON public.media_titles (imdb_id);
CREATE INDEX IF NOT EXISTS idx_media_titles_mal_id ON public.media_titles (mal_id);
CREATE INDEX IF NOT EXISTS idx_media_titles_slug ON public.media_titles (slug);
CREATE INDEX IF NOT EXISTS idx_media_titles_tmdb_id ON public.media_titles (tmdb_id);

CREATE INDEX IF NOT EXISTS idx_episode_cache_expires_at ON public.episode_cache (expires_at);
CREATE INDEX IF NOT EXISTS idx_episode_cache_mal_id ON public.episode_cache (mal_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_health_unique
  ON public.provider_health (provider_id, content_type);
CREATE INDEX IF NOT EXISTS idx_provider_health_status ON public.provider_health (status);

CREATE INDEX IF NOT EXISTS idx_studio_ids_category ON public.studio_ids (category);
CREATE INDEX IF NOT EXISTS idx_log_archives_date ON public.log_archives (log_date DESC);

-- Curated studio and network registry
-- 34 entries as of 2026-08-18.
INSERT INTO public.studio_ids (spun_studio_id, name, category, query_type, query_value, description, logo_url)
VALUES
  ('a1-pictures', 'A-1 Pictures', 'anime', 'anilist_studio', '56', 'A-1 Pictures — Sword Art Online, Fairy Tail, Kaguya-sama', NULL),
  ('a24', 'A24', 'production', 'company', '41077', 'A24 films and series', NULL),
  ('amazon-prime', 'Amazon Prime', 'streaming', 'watch_provider', '9', 'Prime Video originals', NULL),
  ('amc', 'AMC', 'network', 'network', '174', 'AMC originals', NULL),
  ('apple-tv', 'Apple TV+', 'streaming', 'watch_provider', '350', 'Apple TV+ originals', NULL),
  ('bbc', 'BBC', 'network', 'network', '4', 'BBC originals', NULL),
  ('blumhouse', 'Blumhouse', 'production', 'company', '3172', 'Blumhouse Productions', NULL),
  ('bones', 'Bones', 'anime', 'anilist_studio', '4', 'Bones — Fullmetal Alchemist, My Hero Academia, Mob Psycho 100', NULL),
  ('dc-studios', 'DC Studios', 'production', 'company', '9993', 'DC Studios films', NULL),
  ('disney-plus', 'Disney+', 'streaming', 'watch_provider', '337', 'Disney+ originals', NULL),
  ('dreamworks', 'DreamWorks', 'production', 'company', '521', 'DreamWorks Animation', NULL),
  ('fx', 'FX', 'network', 'network', '88', 'FX originals', NULL),
  ('ghibli', 'Studio Ghibli', 'anime', 'anilist_studio', '21', 'Studio Ghibli — Spirited Away, Princess Mononoke, Howl''s Moving Castle', NULL),
  ('hbo', 'HBO', 'streaming', 'network', '49', 'HBO and Max originals', NULL),
  ('hulu', 'Hulu', 'streaming', 'watch_provider', '15', 'Hulu originals', NULL),
  ('kyoto-animation', 'Kyoto Animation', 'anime', 'anilist_studio', '2', 'KyoAni — Violet Evergarden, A Silent Voice, Clannad', NULL),
  ('madhouse', 'Madhouse', 'anime', 'anilist_studio', '11', 'Madhouse — Hunter x Hunter, Death Note, One Punch Man S1', NULL),
  ('mappa', 'MAPPA', 'anime', 'anilist_studio', '569', 'MAPPA — Attack on Titan Final Season, Jujutsu Kaisen, Chainsaw Man', NULL),
  ('marvel-studios', 'Marvel Studios', 'production', 'company', '420', 'Marvel Studios films', NULL),
  ('nbc', 'NBC', 'network', 'network', '6', 'NBC originals', NULL),
  ('netflix', 'Netflix', 'streaming', 'watch_provider', '8', 'Netflix Originals and exclusives', NULL),
  ('paramount', 'Paramount', 'production', 'company', '4', 'Paramount Pictures', NULL),
  ('paramount-plus', 'Paramount+', 'streaming', 'watch_provider', '531', 'Paramount+ originals', NULL),
  ('peacock', 'Peacock', 'streaming', 'watch_provider', '386', 'Peacock originals', NULL),
  ('pixar', 'Pixar', 'production', 'company', '3', 'Pixar Animation Studios', NULL),
  ('showtime', 'Showtime', 'network', 'network', '67', 'Showtime originals', NULL),
  ('sony-pictures', 'Sony Pictures', 'production', 'company', '5', 'Sony Pictures films', NULL),
  ('starz', 'Starz', 'network', 'network', '318', 'Starz originals', NULL),
  ('sunrise', 'Sunrise', 'anime', 'anilist_studio', '35', 'Sunrise — Gundam, Code Geass, Love Live', NULL),
  ('toei-animation', 'Toei Animation', 'anime', 'anilist_studio', '18', 'Toei — One Piece, Dragon Ball, Sailor Moon', NULL),
  ('ufotable', 'Ufotable', 'anime', 'anilist_studio', '43', 'Ufotable — Demon Slayer, Fate/Zero, Tales of series', NULL),
  ('universal', 'Universal', 'production', 'company', '33', 'Universal Pictures', NULL),
  ('warner-bros', 'Warner Bros.', 'production', 'company', '174', 'Warner Bros. films', NULL),
  ('wit-studio', 'WIT Studio', 'anime', 'anilist_studio', '561', 'WIT Studio — Attack on Titan (S1-3), Vinland Saga, Spy x Family', NULL)
ON CONFLICT (spun_studio_id) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  query_type = EXCLUDED.query_type,
  query_value = EXCLUDED.query_value,
  description = EXCLUDED.description,
  logo_url = EXCLUDED.logo_url;

COMMIT;
