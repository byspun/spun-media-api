# Spün Media API Content-Provider Integration Plan

**Planning status:** Design only; no provider implementation, database migration, commit, or deployment was performed as part of this rundown.

**Date:** 16 August 2026

## 1. Executive summary

The metadata layer is considered operationally complete: the Worker provides unified movie, TV, and anime identity, Kitsu-backed anime episodic metadata, cross-identifier resolution, cache management, homepage snapshots, and shared consumer-facing error contracts. The next milestone is the content-provider layer for streaming, downloads, subtitles, and regional catalogue enrichment.

The provider layer will remain an internal infrastructure tier behind the Spün Media API. Consumers should see only Spün-owned endpoints, normalized response objects, Spün-owned error states, and—where proxying is required—Spün-owned capability URLs. Provider names, upstream hosts, internal deployment choices, raw provider identifiers, and provider-specific failure messages must not appear in public responses.

The agreed high-level split is:

| Capability | Primary decision | Fallback or secondary behavior |
|---|---|---|
| Movie and TV streaming | Nuvio’s MovieBox adapter, because one call can return multiple audio/language variants | Daratech, then the approved Castle, NetMirror, StreamFlix, and Vidlink tiers |
| Movie and TV downloads | The user-built Spün MovieBox API, using its MovieBox subject ID | Previously selected download-capable fallbacks may be added in their approved order |
| Anime streaming | Anikoto | KAA, AnimeGG, Reanime, AnimeDunya, AniNeko, AniDB App, and Anibd |
| Anime downloads | The user-built Spün MovieBox API through validated AniList/TMDB/MovieBox reconciliation | No Anikoto fallback initially; its Kiwi links were intermediary HTML pages, not direct downloads |
| Subtitle discovery | Existing subtitle discovery and conversion pipeline, with bundled provider subtitles preferred | Subtitle catalogue fallback, then the existing encrypted subtitle proxy |
| HLS delivery | Format-based Spün HLS proxy | MP4 and DASH are returned as-is when already approved and playable |
| Nollywood metadata | The user-built MovieBox API as an additional regional source | TMDB remains the general movie/TV metadata authority |
| Shorts | Excluded for now | Revisit only after a dedicated shorts provider is selected |

## 2. Architecture and boundaries

The system has two cooperating layers. The Cloudflare Worker is the public gateway and metadata layer. It validates the public request, resolves the Spün title, calls the internal provider backend, normalizes the result, applies the delivery policy, and returns the public contract. The provider backend is the internal orchestration layer where adapters, fallbacks, provider-specific mappings, header requirements, URL extraction, health records, and retries live.

```text
Consumer
   ↓
Spün Media API public Worker
   ├── validates type, spun_id, season, episode, quality, audio
   ├── reads media_titles and identifier mappings
   ├── calls internal provider backend
   ├── normalizes streams/downloads/subtitles
   ├── proxies HLS only when format requires it
   └── returns Spün-owned response or shared error
        ↓ authenticated internal request
Provider backend
   ├── universal mapper.ts
   ├── movie/TV adapters
   ├── anime adapters
   ├── download orchestration
   ├── provider fallback order
   ├── URL and header handling
   └── internal provider health records
```

The provider backend’s internal types already distinguish `RawStream`, `RawDownload`, `ProviderResult`, movie/TV/anime inputs, stream formats, qualities, subtitles, and provider health records. Provider identity is an internal field and must be stripped before a result leaves the Worker.

The shared error registry remains the single source of truth for both the Worker and provider backend. It explicitly follows the black-box rule: third-party provider names and internal infrastructure details must not be exposed in consumer-facing errors.

## 3. Selected provider lineup

### 3.1 Movie and TV streaming

Nuvio’s MovieBox provider is the preferred movie and TV streaming adapter because its result can expose multiple audio and language variants in a single call. This is materially better for consumers than calling a provider repeatedly for separate audio modes.

Daratech is a streaming fallback only. It must not appear in the download chain. It is followed by the selected streaming fallbacks from the provider tests:

| Order | Internal adapter | Scope | Role |
|---:|---|---|---|
| 1 | MovieBox through Nuvio | Movie, TV | Primary multilingual stream source |
| 2 | Daratech | Movie, TV | Primary streaming fallback |
| 3 | Castle | Movie, TV | Streaming fallback; tested HLS and bundled subtitle behavior |
| 4 | NetMirror | Movie, TV | Lightweight HLS/adaptive fallback |
| 5 | StreamFlix | Movie, TV | Additional streaming/download-capable fallback, used according to the selected capability |
| 6 | Vidlink | Movie, TV | Final approved streaming fallback; commonly MP4-oriented |

The adapter must not infer delivery behavior from this order. Every returned stream is evaluated from its normalized format and URL state.

### 3.2 Movie and TV downloads

The user-built MovieBox API is the preferred movie and TV download source. Its API returns structured batch packs grouped by season, episode, and quality, and its relay already turns upstream MovieBox resources into signed relay-backed media URLs. The consumer should receive normalized results rather than the MovieBox API’s native response shape.

The previously tested download-capable fallbacks are retained as possible later tiers:

| Order | Internal adapter | Scope | Role |
|---:|---|---|---|
| 1 | User-built MovieBox API | Movie, TV | Primary download source |
| 2 | 4KHDHub | Movie | Approved 4K/download fallback |
| 3 | DVDPlay | Movie | Approved download fallback |
| 4 | StreamFlix | Movie, TV where supported | Approved download fallback |

Daratech is intentionally absent from this list.

### 3.3 Anime streaming

The anime streaming order is based on the previously tested Anivexa results:

| Order | Internal adapter | Role |
|---:|---|---|
| 1 | Anikoto | Primary anime stream source; sub/dub and bundled download-like entries are exposed internally, but its download links were not direct files |
| 2 | KAA / KickassAnime | HLS fallback |
| 3 | AnimeGG | Direct-MP4 fallback where valid |
| 4 | Reanime | HLS/decrypted-stream fallback |
| 5 | AnimeDunya | Sub-only HLS fallback |
| 6 | AniNeko | Direct-stream fallback; embeds must be filtered |
| 7 | AniDB App | HLS fallback |
| 8 | Anibd | Final anime stream fallback |

The tested but non-selected or partial providers are not part of the initial production order. They may be revisited later after independent verification.

### 3.4 Anime downloads

Anikoto was tested separately for downloads. It returned entries labeled `Kiwi`, but representative URLs returned HTTP 200 with `text/html` and an HTML document body rather than a direct media file. Therefore, Anikoto is not an acceptable transparent download provider at this stage.

The user-built MovieBox API is now the preferred anime download source as well, provided the AniList-to-MovieBox mapping is strictly validated. The initial anime download policy is:

> Use MovieBox for anime downloads after identity and episode-structure validation. Do not expose Anikoto intermediary pages, embeds, or ordinary HLS stream URLs as downloads.

## 4. MovieBox API integration

### 4.1 Internal MovieBox API endpoints

The user-built MovieBox API is available at `https://moviebox.byspun.xyz` and requires the internal `X-Worker-Secret` authentication header. The secret is an internal deployment secret and must never appear in public responses or source code.

The documented internal endpoints are:

| Method | Internal path | Purpose |
|---|---|---|
| `GET` | `/` | API information and route listing |
| `GET` | `/health` | MovieBox API health check |
| `POST` | `/search` | Search movies, TV, and supported MovieBox subjects; body includes `keyword`, optional `page`, and optional `perPage` |
| `GET` | `/info/:subjectId` | Retrieve MovieBox-native subject metadata |
| `GET` | `/season/:subjectId` | Retrieve season, episode, and resolution availability |
| `GET` | `/stream/:subjectId?se=X&ep=Y` | Retrieve streams for a movie or selected episode |
| `GET` | `/stream/:subjectId/all` | Retrieve all streams grouped by season and episode |
| `GET` | `/download/:subjectId` | Retrieve a complete download pack grouped by season, episode, and quality |
| `GET` | `/home` | Retrieve the full MovieBox homepage feed |
| `GET` | `/home/rows` | Discover current homepage row titles and dynamic operation IDs |
| `GET` | `/home/subjects?opId=X` | Retrieve subjects for a discovered homepage row |

The live tests confirmed that the API is healthy, its search endpoint returns MovieBox subject IDs, its detail and season routes work, and its batch download route returns MP4 results through signed relay URLs.

The currently deployed version tested did **not** expose a single-episode path at `/download/:subjectId/:season/:episode`; that route returned HTTP 404. The planned Spün API may still expose a single-episode public route by filtering a batch response internally, and the MovieBox API can add a native single-resource route later if desired.

### 4.2 MovieBox subject-ID persistence

A nullable unique `moviebox_id BIGINT` column should be added to `media_titles`. This is appropriate because every MovieBox subject is treated as a distinct catalogue entry when it represents a separate language variant or edition. For example, `Avatar` and `Avatar [Hindi]` are separate MovieBox subjects and may legitimately have separate Spün rows and separate Spün IDs.

The planned schema change is:

```sql
ALTER TABLE media_titles ADD COLUMN IF NOT EXISTS moviebox_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS media_titles_moviebox_id_unique_idx
  ON media_titles (moviebox_id)
  WHERE moviebox_id IS NOT NULL;
```

This migration has not been applied yet. The live database currently contains `kitsu_id` and its unique partial index, but not `moviebox_id`.

The important rule is mapping enrichment rather than ID replacement. If a MovieBox-only row is created first and TMDB later identifies the ordinary version of that title, the existing `spun_id` remains stable and the stronger identifier is attached to the correct row. Rows must not be deleted and recreated merely because another provider identifier becomes available.

### 4.3 AniList-to-TMDB-to-MovieBox anime mapping

AniList remains the anime catalogue authority. TMDB is a useful bridge and metadata fallback, but the MovieBox download flow must not become dependent on TMDB being present for every anime.

The recommended flow is:

```text
AniList row
   ↓
Use existing tmdb_id if available
   ↓
Otherwise find a compatible TMDB anime record when possible
   ↓
Build MovieBox search candidates from AniList titles, synonyms, year, and TMDB title
   ↓
Search MovieBox
   ↓
Validate each candidate with MovieBox info and season data
   ↓
Accept only one unambiguous compatible subject
   ↓
Persist moviebox_id on the reconciled media_titles row
```

Candidate acceptance requires compatible content type, title evidence, year evidence, anime classification, and plausible episode structure. A MovieBox candidate must not be attached merely because its title is similar.

The test run validated the following MovieBox anime subjects:

| AniList title | MovieBox subject | Result |
|---|---:|---|
| One Piece | `2867356962868579120` | TV subject; one season, 500 episodes, MP4 downloads |
| Attack on Titan | `1975770531236301600` | TV subject; six seasons, 88 episodes, MP4 downloads up to 1080p |
| Oshi no Ko | `7860603822497221336` | TV subject; three seasons, 35 episodes, MP4 downloads up to 1080p |

The test also exposed a season-specific mapping issue. AniList ID `166531` is Oshi no Ko Season 2, while the MovieBox search produced a whole-series TV subject and a separate movie-like `Oshi No Ko Season 2` subject with no resources. The whole-series subject must not be attached blindly to the season-specific AniList row. A parent-series or season-aware mapping policy is required.

### 4.4 MovieBox metadata role

MovieBox should not replace the general metadata authorities. Its metadata roles are limited to:

| Role | Decision |
|---|---|
| Ordinary movie/TV metadata | TMDB remains primary when a TMDB identifier exists |
| Anime metadata | AniList remains primary; Kitsu remains episodic primary; TMDB remains episodic fallback |
| Playback mapping | MovieBox subject ID is used internally by the provider adapters |
| Download mapping | MovieBox subject ID is used to request batch or targeted downloads |
| Nollywood discovery | MovieBox contributes regional subjects for the Made in Naija row and MovieBox-only entries |

When both `tmdb_id` and `moviebox_id` are present on a row, the info endpoint uses TMDB first because it provides richer public metadata. MovieBox can fill permitted missing fields, but it must not replace non-empty canonical TMDB values.

## 5. Search reconciliation and duplicate prevention

Search should query TMDB, AniList, and MovieBox concurrently. MovieBox results are candidates, not trusted catalogue records, because its search response can contain unrelated titles, language variants, sequels, and results surfaced from broad upstream searches.

The precedence rules are:

1. If a title is identified by AniList as anime, treat it as anime regardless of whether the candidate came from TMDB or MovieBox.
2. If a non-anime title exists in both TMDB and MovieBox, TMDB wins as the public catalogue result.
3. If a MovieBox result is a language or edition variant, such as `Avatar [Hindi]`, preserve it as a distinct entry when it is not represented by TMDB or AniList.
4. Keep a MovieBox result only when the title is not represented by TMDB or AniList, or when it is a validated explicit variant.
5. Before assigning any new Spün ID, batch-reconcile surviving MovieBox results against existing `media_titles` rows.
6. If an existing row has the same compatible content type and a sufficiently strong title/year match, attach `moviebox_id` to that row.
7. Only after the batch has been reconciled should unmatched candidates receive new Spün IDs.

The matching hierarchy is:

| Level | Conditions | Action |
|---|---|---|
| 1 | Existing TMDB, AniList, IMDb, TVDB, or other canonical identifier confirms the match | Attach MovieBox ID to that row |
| 2 | Same content type, exact normalized title, and compatible year | Attach MovieBox ID |
| 3 | Exact explicit language/edition variant with compatible type and year | Attach to the separate variant row |
| 4 | Same title but conflicting year or multiple candidates | Do not attach automatically |
| 5 | No database match and no stronger catalogue match | Create a new MovieBox-backed row after reconciliation |

Language and edition markers must not be stripped before the final identity decision. Base-title comparison can detect a possible relationship, but markers such as `[Hindi]`, `[Tamil]`, `[Telugu]`, `[English]`, `[CAM]`, or edition labels remain part of the variant identity.

## 6. Made in Naija homepage row

Shorts are excluded from this phase. The regional MovieBox homepage feature is limited to Nollywood content.

The public row name is **Made in Naija**. It must appear in both the general homepage and the movie homepage, positioned in the middle of the movie-oriented rows rather than at the beginning or end.

The row population flow is:

```text
Call MovieBox /home/rows
   ↓
Find the current Nollywood row dynamically
   ↓
Read its current opId
   ↓
Call /home/subjects?opId=...
   ↓
Filter to movie subjects
   ↓
Batch-reconcile subjects against media_titles
   ↓
Normalize cards using TMDB-first metadata where available
   ↓
Emit Made in Naija row
```

The MovieBox `opId` must not be hardcoded because the upstream homepage row identifiers can change. If discovery, authentication, population, or normalization fails, the row must still be emitted with an empty content array:

```json
{
  "title": "Made in Naija",
  "items": []
}
```

A failed regional row must not fail the entire homepage build and must not cause the row to disappear.

## 7. Streaming endpoint contracts

The planned public stream endpoints are:

```text
GET /v1/stream/:type/:id
GET /v1/stream/:type/:id/:season/:episode
```

The `:type` values are `movie`, `tv`, and `anime`. A movie uses internal season `0` and episode `0`. TV and anime use explicit season and episode parameters for a single episode. Anime defaults to season `1` internally when no season mapping exists, but a single-episode request should still require an episode number.

The no-season/no-episode route is best treated as an available-stream or full-pack response rather than silently assuming episode 1.

A normalized stream object is:

```json
{
  "quality": "1080p",
  "resolution": 1080,
  "format": "hls",
  "audio": "English",
  "url": "https://media.byspun.xyz/v1/proxy/stream?t=...",
  "subtitles": []
}
```

Every stream object must contain a `subtitles` array. When the provider supplies no bundled subtitle tracks, the field is `[]`. Provider names, raw provider headers, upstream URLs, and internal provider IDs are excluded.

### Format-based delivery policy

The delivery policy is determined from the normalized stream format, never from the provider name or historical provider behavior:

| Format | Public delivery |
|---|---|
| HLS or `.m3u8` | Proxy through `/v1/proxy/stream` using an encrypted expiring token that contains the upstream URL and required headers |
| MP4 | Return as-is when it is already a valid approved relay URL or otherwise meets the delivery policy |
| DASH or `.mpd` | Return as-is when it is already playable and approved |
| MKV or other download-oriented format | Do not treat as a stream unless the consumer contract explicitly supports it |
| Missing/unknown format | Reject during normalization; do not guess based on provider identity |

The user-built MovieBox API already proxies MovieBox resources and returns signed relay-backed media URLs. These should not be double-proxied. The adapter should recognize already-approved Spün MovieBox relay URLs. HLS streams from providers that are not already relayed must use the Spün HLS proxy.

## 8. Download endpoint contracts

The planned public download endpoints are:

```text
GET /v1/download/:type/:id
GET /v1/download/:type/:id/:season/:episode
```

The batch endpoint returns all available downloads grouped by season, episode, quality, audio, and format. The targeted endpoint returns only the requested episode’s available download choices. The consumer should not need to understand any provider-native batch format.

A normalized batch response is:

```json
{
  "spun_id": "attack-on-titan-696710",
  "type": "anime",
  "seasons": [
    {
      "season": 1,
      "episodes": [
        {
          "episode": 1,
          "downloads": [
            {
              "quality": "1080p",
              "format": "mp4",
              "audio": "Japanese",
              "url": "https://media.byspun.xyz/v1/proxy/download?t=...",
              "filename": "Attack_on_Titan_S01E01_1080p.mp4",
              "size": "341 MB",
              "subtitles": []
            }
          ]
        }
      ]
    }
  ]
}
```

The batch route is the preferred consumer UI contract because it allows a download selector to be built with one request. The targeted route is an optimization for consumers that need one episode only. Until the MovieBox API’s native single-episode route exists, the provider backend can retrieve the complete pack and filter it internally.

The user-built MovieBox API already returns signed relay-backed MP4 download URLs, so no additional upstream download proxy is required for those URLs. If strict public black-box delivery requires that consumers see only `media.byspun.xyz`, the Worker may still wrap or re-sign the already-relayed URL in a Spün download capability token.

## 9. Subtitle behavior

Subtitle handling has three levels:

1. Use bundled subtitle tracks returned by the stream provider when present.
2. If no bundled tracks exist, the stream response includes `subtitles: []`; the consumer may use the separate subtitle discovery endpoint.
3. Subtitle discovery uses the existing subtitle provider and proxy pipeline, which fetches archives, extracts subtitle files, converts SRT to WebVTT, and returns encrypted Spün-owned URLs.

The existing public subtitle endpoint remains conceptually:

```text
GET /v1/subtitles/:spun_id
GET /v1/subtitles/:spun_id?season=:season&episode=:episode
```

The public subtitle items contain language, language code, format, URL, and expiry metadata. Raw subtitle-provider URLs and API keys remain hidden.

The proxy boundary remains:

```text
GET /v1/proxy/subtitles?t=<encrypted-token>
```

The stream and subtitle tokens should use separate token kinds and validation rules. A subtitle token must not be accepted by the stream proxy, and a stream token must not be accepted by the subtitle proxy.

## 10. HLS stream proxy

The HLS proxy is a delivery boundary, not a provider adapter. It receives an opaque signed capability token, validates its expiry and signature, retrieves the upstream manifest with the required headers, rewrites nested playlist, segment, and encryption-key references, and preserves the required request headers for every downstream fetch.

The public proxy endpoint is:

```text
GET /v1/proxy/stream?t=<encrypted-expiring-token>
```

The token payload should contain the upstream URL, required request headers, token kind, expiry, and a nonce or equivalent replay-control value. The upstream URL and headers must not be visible to consumers.

MP4 and DASH do not automatically pass through this HLS proxy. They are returned as-is when they are already approved and playable. This rule is based on format, not provider.

## 11. Health and operational monitoring

The public health endpoint now checks the metadata services, including Kitsu, and reports an aggregate status. The provider backend should maintain internal health records with provider ID, content category, status, last success, last failure, consecutive failures, last error, and check time.

Public responses should expose only an aggregate content-service state or a generic service state if the strict black-box principle is enforced. Internal dashboards and logs may retain provider-specific details for diagnosis.

Provider health behavior should include:

| Situation | Internal action | Public result |
|---|---|---|
| Provider returns a valid normalized result | Record success and reset consecutive failures | Return the result |
| Provider returns no usable result | Record a soft failure and try the next tier | Continue fallback chain |
| Provider times out | Record timeout and try the next tier | Continue fallback chain unless all tiers fail |
| Provider returns a blocked/region response | Record restricted access and try the next tier | Continue fallback chain or return restriction state if all sources are restricted |
| All tiers fail | Record aggregate failure | Return shared content-unavailable or service-offline state |
| Provider is under maintenance | Suppress it temporarily according to health policy | Continue with fallback tiers |

## 12. Shared error-code design

Every public error uses this exact shape:

```json
{
  "code": "ERROR_CODE",
  "error": "Short consumer-facing error",
  "description": "Why it happened",
  "action": "What the consumer should do"
}
```

The existing shared registry already contains the following codes:

| Code | Meaning |
|---|---|
| `INVALID_ID` | The requested Spün ID does not exist |
| `ROUTE_NOT_FOUND` | The endpoint does not exist |
| `MISSING_QUERY` | A required search query is absent or too short |
| `BAD_REQUEST` | Parameters are malformed or incomplete |
| `UNAUTHORIZED` | Authentication is required or invalid |
| `FORBIDDEN` | The caller lacks permission for the resource |
| `SERVICE_OFFLINE` | A Spün infrastructure component is unreachable |
| `CONTENT_UNAVAILABLE` | No playable source was found after the fallback chain |
| `REGION_RESTRICTED` | Content is unavailable in the caller’s region |
| `SECURE_LINK_ERROR` | A source handshake or secure-link step failed |
| `GATEWAY_TIMEOUT` | The request exceeded the processing time limit |
| `RATE_LIMIT` | The caller exceeded the request limit |
| `MAINTENANCE` | The API or service is under scheduled maintenance |
| `METHOD_NOT_ALLOWED` | The HTTP method is unsupported |
| `SUBTITLE_UNAVAILABLE` | Subtitle retrieval failed |
| `SUBTITLE_ARCHIVE_INVALID` | The subtitle archive is corrupt or unsupported |
| `SUBTITLE_TRACK_NOT_FOUND` | No usable track exists for the requested language |
| `SUBTITLE_CONVERSION_FAILED` | SRT or another subtitle track could not be converted to WebVTT |
| `RESOLVE_NAMESPACE_UNSUPPORTED` | The requested identifier namespace is unsupported |
| `RESOLVE_IDENTIFIER_REQUIRED` | The `id` query parameter is missing |
| `RESOLVE_IDENTIFIER_INVALID` | The identifier has an invalid format |
| `RESOLVE_NAMESPACE_TYPE_MISMATCH` | The resolved content type does not match the requested namespace/type |
| `RESOLVE_CONTENT_NOT_FOUND` | No title matches the identifier |
| `RESOLVE_AMBIGUOUS` | Multiple matches prevent safe resolution |
| `RESOLVE_METADATA_UNAVAILABLE` | Metadata needed for resolution is temporarily unavailable |
| `RESOLVE_METADATA_TIMEOUT` | Metadata resolution timed out |
| `RESOLVE_REGISTRATION_FAILED` | A discovered title could not be registered |
| `RESOLVE_CONFLICT` | A concurrent catalogue operation conflicted with resolution |
| `RESOLVE_UNSUPPORTED_RESULT` | The result could not be normalized into the supported content model |
| `INTERNAL_ERROR` | An unexpected internal failure occurred |

### Provider-layer additions recommended for approval

The following codes are not yet part of the current registry but would make stream/download behavior more precise while remaining provider-neutral:

| Proposed code | Use |
|---|---|
| `STREAMS_UNAVAILABLE` | No usable streams were found after all approved streaming tiers |
| `DOWNLOADS_UNAVAILABLE` | No usable downloads were found after all approved download tiers |
| `EPISODE_UNAVAILABLE` | The requested season/episode has no available result |
| `QUALITY_UNAVAILABLE` | The requested quality is not available, while other qualities may exist |
| `AUDIO_UNAVAILABLE` | The requested audio/language variant is not available |
| `SOURCE_RESPONSE_INVALID` | A source responded but its payload could not be normalized |
| `SOURCE_TIMEOUT` | A source request exceeded its timeout; use only internally or map publicly to `GATEWAY_TIMEOUT` |
| `SOURCE_ACCESS_DENIED` | A source rejected the request; map publicly to `SERVICE_OFFLINE`, `REGION_RESTRICTED`, or `SECURE_LINK_ERROR` as appropriate |
| `PROXY_TOKEN_INVALID` | The proxy token is malformed or has the wrong token kind |
| `PROXY_TOKEN_EXPIRED` | The proxy capability has expired |
| `PROXY_UPSTREAM_UNAVAILABLE` | The proxy could not fetch the approved upstream media resource |
| `PROXY_FORMAT_UNSUPPORTED` | The requested proxy endpoint cannot handle the media format |
| `DOWNLOAD_LINK_INVALID` | A returned download link failed structural validation |
| `MAPPING_NOT_FOUND` | No provider mapping exists for the requested capability |
| `MAPPING_AMBIGUOUS` | Multiple provider subjects match and cannot be safely selected |
| `MAPPING_TYPE_MISMATCH` | The provider subject’s content type conflicts with the Spün row |

The public response should not expose internal provider names even when these codes are produced. For example, a provider timeout should not say “Anikoto timed out”; it should map to a generic timeout or availability error.

## 13. Current and planned public endpoint inventory

The following are the main existing or established public Worker endpoints relevant to this integration:

### Core and utility

```text
GET /v1
GET /v1/health
GET /v1/utility/health
GET /v1/resolve
GET /v1/resolve/:namespace
GET /v1/utility/resolve
GET /v1/utility/resolve/:namespace
```

Supported resolver namespaces include the approved metadata identifier namespaces such as TMDB, IMDb, TVDB, AniList, MAL, Kitsu, and the namespaces currently registered by the Worker. The response is a normalized `ContentItem`; provider names are not exposed as upstream data sources.

### Search

```text
GET /v1/search?q=:query&page=:page&type=:type
GET /v1/search/movie?q=:query&page=:page
GET /v1/search/tv?q=:query&page=:page
GET /v1/search/anime?q=:query&page=:page
GET /v1/search/suggestions?q=:query
```

The provider integration will extend search orchestration so TMDB, AniList, and MovieBox candidates can be reconciled before public results receive or reuse Spün IDs.

### Information and anime episodes

```text
GET /v1/info/:spun_id
GET /v1/info/:spun_id/episodes
GET /v1/info/:spun_id/episodes?season=:season
GET /v1/info/:spun_id/related
GET /v1/anime/:spun_id/episodes
```

The info route uses TMDB-first metadata when a TMDB identifier exists, AniList-first catalogue data for anime, Kitsu-first anime episodic data, and TMDB episodic fallback.

### Discovery and relationships

```text
GET /v1/discover/trending
GET /v1/discover/popular
GET /v1/discover/new
GET /v1/discover/genres
GET /v1/discover/studios
GET /v1/discover/studio/:id
GET /v1/discover/:type
GET /v1/trending
GET /v1/popular
GET /v1/new
GET /v1/genres
GET /v1/studios
GET /v1/similar/:spun_id
GET /v1/franchise
GET /v1/franchise/:id-or-title
POST /v1/franchise/register
```

MovieBox regional rows are not a replacement for discovery routes. Made in Naija is a curated homepage/movie-row feature with its own reconciliation and empty-row resilience rules.

### Home and cache management

```text
GET /v1/home
GET /v1/home/movie
GET /v1/home/tv
GET /v1/home/anime
GET /v1/home/status
GET /v1/home/build?type=all|movie|tv|anime
GET /v1/home/build?type=...&wait=true
POST /v1/home/backfill?limit=:limit
GET /v1/cache/clear
```

`/v1/home/build` and `/v1/cache/clear` require the internal management header. Made in Naija must be emitted as an empty row when its MovieBox population fails.

### Planned content delivery endpoints

```text
GET /v1/stream/movie/:id
GET /v1/stream/movie/:id/:season/:episode
GET /v1/stream/tv/:id
GET /v1/stream/tv/:id/:season/:episode
GET /v1/stream/anime/:id
GET /v1/stream/anime/:id/:season/:episode

GET /v1/download/movie/:id
GET /v1/download/movie/:id/:season/:episode
GET /v1/download/tv/:id
GET /v1/download/tv/:id/:season/:episode
GET /v1/download/anime/:id
GET /v1/download/anime/:id/:season/:episode
```

The exact behavior of the no-season/no-episode TV and anime routes should be finalized before implementation. The recommended interpretation is an available-stream or complete-pack response, while the single-episode route always requires an episode number.

### Subtitle and media proxy endpoints

```text
GET /v1/subtitles/:spun_id
GET /v1/subtitles/:spun_id?season=:season&episode=:episode
GET /v1/proxy/subtitles?t=:encrypted-token
GET /v1/proxy/stream?t=:encrypted-token
```

The legacy `/v1/subtitle-proxy` alias is intentionally removed. Stream and subtitle proxy tokens are separate and expiring.

## 14. Caching and persistence decisions

Provider metadata and mapping results should be cached, but signed stream and download URLs must not be treated as permanent assets. Cache identity and mapping data can have longer TTLs; media links should honor the upstream expiry and be refreshed when necessary.

Recommended persisted information includes:

| Data | Persistence decision |
|---|---|
| `moviebox_id` | Store on `media_titles` as nullable unique BIGINT after migration approval |
| Kitsu episode IDs | Do not store in `media_titles`; cache episodic data by Spün ID and season |
| Stream URLs | Do not persist as permanent rows; return fresh or short-lived capabilities |
| Download URLs | Do not treat as permanent; refresh according to MovieBox relay expiry |
| Provider health records | Store internally or in a bounded operational store, never expose provider details publicly |
| MovieBox homepage opIds | Discover dynamically; cache briefly if desired, but do not hardcode |
| Made in Naija row | Always build the row; allow empty items on failure |

## 15. Implementation sequence after approval

The recommended implementation order is:

1. Add and apply the `moviebox_id` migration.
2. Extend the shared row type and identity resolver with MovieBox lookup, attachment, and conflict handling.
3. Add the universal `mapper.ts` for movie, TV, and anime provider inputs.
4. Implement MovieBox subject search, info, season, batch download, and stream adapters.
5. Implement strict AniList/TMDB/MovieBox anime candidate validation.
6. Implement the Nuvio MovieBox multilingual streaming adapter.
7. Implement the Daratech, Castle, NetMirror, StreamFlix, and Vidlink streaming fallback order.
8. Implement the selected anime streaming fallback order.
9. Implement the MovieBox movie/TV/anime download orchestration.
10. Add format-based HLS proxy selection and preserve MovieBox’s already-relayed URLs without double-proxying.
11. Add bundled subtitle normalization to stream responses.
12. Add Made in Naija discovery, reconciliation, homepage insertion, and empty-row fallback.
13. Add provider health records, circuit-breaker behavior, and aggregate health reporting.
14. Add the provider-layer error codes and map internal failures to black-box public responses.
15. Run unit, contract, integration, and production smoke tests before deployment.

## 16. Decisions explicitly deferred

The following items remain open and should not be implemented until separately approved:

| Decision | Current position |
|---|---|
| Shorts content type | Deferred until a proper shorts provider is selected |
| Multiple MovieBox IDs for sub/dub anime variants | Add a variant mapping structure only if real tests prove one canonical anime row needs multiple MovieBox subjects |
| Native MovieBox single-episode download route | Current deployed API returns 404; use batch filtering until the route exists |
| Additional download fallbacks | Keep the approved fallback candidates available, but verify their current reliability before enabling them |
| Public provider names in health responses | Current health response has metadata-service labels; the black-box-compatible future design should prefer generic public service status |
| Whether already-relayed MovieBox URLs need a second Spün capability wrapper | Avoid double-proxying; decide whether strict host hiding requires a lightweight Worker wrapper |

## Final position

The content-provider design is now centered on four principles:

> **Nuvio MovieBox is the multilingual movie/TV streaming source.**

> **The user-built MovieBox API is the structured movie/TV/anime download source and the regional MovieBox metadata source.**

> **HLS proxying is decided by media format, never by provider identity.**

> **All provider search results are candidates until reconciled against the Spün catalogue and validated for type, title, year, and episode structure.**

This design preserves the black-box consumer experience, supports multiple audio variants, prevents duplicate Spün IDs, keeps TMDB and AniList metadata priorities intact, gives download UIs complete batch data, and allows the provider layer to fail over without exposing its internal composition.

### References

[1]: https://github.com/paregi12/nuvio-providers "Nuvio providers repository"

[2]: https://github.com/walterwhite-69/Anivexa-API "Anivexa API repository"

[3]: https://github.com/heisdanny64/spun-moviebox-api "Spün MovieBox API repository"

[4]: https://github.com/heisdanny64/spun-media-api/blob/main/shared/errors.ts "Spün shared error registry"

[5]: https://github.com/heisdanny64/spun-media-api/blob/main/providers/shared/types.ts "Spün provider shared types"
