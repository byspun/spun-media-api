# Provider Additions — Tested & Verified

**Test date:** 2026-11-08
**Source:** 39 providers from three repos — Nuvio (`all-in-one-nuvio`), Anivexa (`anivexa-api`), Varomine (`varomine-Anime-Scraper-API`, `varomine-hanime.tv-api`)
**Verification method:** Byte-level URL verification — HLS `#EXTM3U`, DASH `<MPD`, MP4 `Range→206`, flixcloud `base64(XOR)` decryption, curl-subprocess fallback for Cloudflare TLS-fingerprint blocks (403/401/503), referer-gated CDNs.
**Raw results:** `/root/provider-eval-scripts/stream39-results.json`

**Overall:** 14 unique providers returned valid, playable streams (11 anime + 3 movies/TV). 8 of those also returned subtitles.

---

## ✅ Providers Worth Adding (stream-ok)

### Movies & TV — 3

| Provider | Source | Repo file path | Stream | Subs | Proxy |
|---|---|---|---|---|---|
| **playimdb** | nuvio | `all-in-one-nuvio/providers/playimdb.js` | HLS (`seiryuu.vid-cdn.xyz`) | 0 | direct |
| **moviesdrive** | nuvio | `all-in-one-nuvio/providers/moviesdrive.js` | MP4 (Range 206) | 0 | direct (Google CDN links timeout occasionally) |
| **mkissa** | anivexa | `anivexa-api/providers/mkissa.js` | HLS (clock.json → wixstatic) | 0 | direct |

### Anime — 11

| Provider | Source | Repo file path | Stream | Subs | Proxy / notes |
|---|---|---|---|---|---|
| **anizone** | nuvio | `all-in-one-nuvio/providers/anizone.js` | HLS (`seiryuu.vid-cdn.xyz`) | 2 (.srt) | direct |
| **reanime** | anivexa | `anivexa-api/providers/reanime.js` | HLS (flixcloud, XOR-decrypted) | 60 | direct (see flixcloud block below) |
| **anikoto** | anivexa | `anivexa-api/providers/anikoto.js` | HLS (`fetch.nexabloom.top`) | 24 (.vtt) | Referer `megaplay.buzz` |
| **anizone** | anivexa | `anivexa-api/providers/anizone.js` | HLS (`seiryuu.vid-cdn.xyz`) | 16 (.ass) | direct |
| **animegg** | anivexa | `anivexa-api/providers/animegg.js` | MP4 (`animegg.org/play/…/video.mp4`) | 0 | Referer `animegg.org` (vidcache 500 without) |
| **kickassanime (kaa)** | anivexa | `anivexa-api/providers/kickassanime.js` | HLS (`hls.krussdomi.com`) | 0 | Referer `kaa.lt` |
| **animeonsen** | anivexa | `anivexa-api/providers/animeonsen.js` | DASH (MPD) | 1 (API .vtt) | Referer `animeonsen.xyz` |
| **anipm** | anivexa | `anivexa-api/providers/anipm.js` | HLS (`media.settlar.io`) | 9 (inline) | **curl-only** — 403 on Node/undici; curl subprocess passes |
| **hanime** | varomine | `varomine-hanime.tv-api/src/{preamble,vendor,index}.ts` | HLS (`hanime.tv/hls/{id}/{token}`) | 0 | via `streamrelay.sapis.workers.dev` |
| **anikage** | varomine | `varomine-Anime-Scraper-API/src/scraper.ts` | HLS via `og.bakayaro.live` | 2 | live server ids `koto`/`kite` (not `pahe`) |
| **reanime-api** | varomine | `varomine-Anime-Scraper-API` (same backend as anivexa reanime) | HLS (flixcloud) | 6 | direct (XOR-decrypted) |

### Subtitle-bearing providers (subset of above)

| Provider | Subs | Format |
|---|---|---|
| anivexa/reanime | 60 | .srt, .sup, .ass |
| anivexa/anikoto | 24 | .vtt |
| anivexa/anizone | 16 | .ass |
| anivexa/anipm | 9 | inline token URLs |
| varomine/reanime-api | 6 | flixcloud-extracted |
| varomine/anikage | 2 | via proxy |
| nuvio/anizone | 2 | .srt |
| anivexa/animeonsen | 1 | API .vtt |

---

## ❌ Rejected / Limited

| Provider | Verdict | Reason |
|---|---|---|
| **dead** | | |
| movieblast (nuvio) | dead | 4× 404 on all probes |
| animenosub (anivexa) | error | "match not found for AniList 16498" |
| **page-only** (HTML/embed, no direct media) | | |
| desiflix (nuvio) | page-only | RRR probe → 1×page + 3×dead; page link points to `songokubro1-fd83b0d307bb.herokuapp.com/dl/…mkv` (404) |
| 1shows (nuvio) | page-only | page fetch times out (cold start) |
| uhdmovies (nuvio) | page-only | 4× page |
| vidrock (nuvio) | page-only | dead + 2×page + invalid |
| reanime (nuvio) | page-only | flixcloud embed → page; token API 410 on reuse — retrying fresh gives a stream |
| aniwaves (anivexa) | page-only | playmogo/mfw09 embeds are JS-driven players (50KB HTML, zero iframes/media links) |
| **no-stream** (empty or config-gated) | | |
| gramcinema, showbox (nuvio) | no-stream | require settings tokens not provided |
| allmovieland, dahmermovies, kurage, hindmoviez, moonflix, movieshunt, vegamovies, vidfast, xpass, allwish, anime-sama, animesalt, animeworld, einthusan, hdhub4u (nuvio) | no-stream | empty `getStreams` results |

---

## 🔧 Technical Implementation Notes

### Flixcloud XOR-encrypted playlists (reanime, reanime-api)
`master.m3u8` body = `base64(plaintext XOR repeating keyBytes)` where the key is the extractor's `playlist_key` (base64, 32 bytes). Decryption yields a valid `#EXTM3U`.
`★ Insight`
**This is the same primitive we already have in the repo** (`providers/anime/reanime.ts:decryptEmbed()` uses PBKDF2/AES-CBC — check which key the flixcloud extractor returns; the playlist key is what XORs the playlist, the stream URL token is separate).
`─────────────────────────────────────────────────`
- Flixcloud token API is **single-use** — token returns 410 `invalid_or_used_token` on reuse. Fetch a fresh embed (`?v=2`) for each new request.
- Extractor: `anivexa-api/extractors/flixcloud.js`, `extractFlixcloud(embedHtml, {apiBase:'https://flixcloud.cc', headers, referer})` → `{url, key, playlist_key, subtitles, thumbnails_vtt, intro_chapter, outro_chapter}`.

### Cloudflare TLS-fingerprint blocks (anipm)
`media.settlar.io` and `playmogo.com` return 403 "Just a moment" to **any** Node `fetch`/undici request regardless of headers. `curl` subprocess passes because it uses a different HTTP stack.
`★ Insight`
**Proxying in our metadata Worker does NOT help here** — the block is on TLS fingerprinting, and our proxy forwards the upstream response body. This is a source-side problem: the provider code itself must use a browser client (the anivexa `anipm.js` uses a wreq browser session, which is why the Anivexa worker got HLS — plain Node `fetch` in our adapter would 403).
`─────────────────────────────────────────────────`
- `anipm.js` uses `core/wreq.js` (browser automation session `anipm`, chrome_149 / windows) via env `ANIPM_WREQ_BROWSER` / `ANIPM_WREQ_OS`.

### Referer-gated CDNs
Four hosts reject requests without the correct Referer:
| Host | Referer | Provider |
|---|---|---|
| `hls.krussdomi.com` | `https://kaa.lt/` | kickassanime |
| `cdn.animeonsen.xyz` | `https://www.animeonsen.xyz/` | animeonsen |
| `fetch.nexabloom.top` | `https://megaplay.buzz/` | anikoto |
| `www.animegg.org` (mp4) | `https://www.animegg.org/` | animegg |

`★ Insight`
**Do NOT set referers at the normalizer level.** Our `metadata/src/proxy.ts` already auto-forwards Referer/Origin from the token and follows Range. The clean approach: each provider's stream object carries `{ url, type:'mp4', headers:{Referer:'...'} }`, and our `shouldProxyStream()` passes them through to the proxy fetch. That's exactly why animegg currently returns **raw** URLs — the provider creates streams with `safeStream({url, quality, type})` and no headers, so it falls into the passthrough branch and the browser fails on vidcache (500 "bad hand off"). Add the Referer in the provider file, not the adapter.
`─────────────────────────────────────────────────`

### Anikage proxy moved + stale server id
The SPA chunk `c283.js` defines `PUBLIC_PROXY_URL || 'https://og.bakayaro.live'`. Old `prox.anikage.cc` 404s for stream paths. Live provider ids: **`koto`** and **`kite`** — `pahe` is stale.
- Browse/episodes/servers flow: `https://anikage.cc/api/media/anime/{slug}/episodes/{ep}/servers`, then `/api/media/anime/{slug}/episodes/{ep}/sources?provider=koto&lang=sub` → `{sources:[{url}]}` where `url` is a short token → proxy as `og.bakayaro.live/m3u8/{token}` (m3u8) or `/stream/{token}` (mp4).

### Hanime worker (varomine)
Requires special load order: `preamble.ts` sets `globalThis.process = undefined`, then `vendor.js`, then `index.ts` — restore `process` after each import. Landing shape `{sections:[{videos:[{slug}]}]}`; search `nbHits` is 0 for queries (use landing "Trending" or a specific slug). Stream URLs are long-token `hanime.tv/hls/{id}/{token}` (work direct and via `streamrelay.sapis.workers.dev/proxy?url=`).

### mkissa one-hop API
Returns `{sources:[{url:"https://allanime.day/apivtwo/clock.json?id=…"}]}`. Resolve the clock.json → `{links:[{link:"wixstatic/.../master.m3u8",hls:true}]}`. This needs one extra fetch in the adapter (or wrap it like the verify harness does).

### Reanime (anivexa & varomine) is the same backend
`anivexa-pages.dev/watch/{route}/{anilist}/sub/{route}-{ep}` and `reanime.to/api/flix/{anilist}/{ep}` hit the same servers. Reanime provides `stream_url` + `streams:[{url, type:'hls', embed, key, playlist_key, subtitles, thumbnails_vtt, intro_chapter, outro_chapter}]` — map `embed`→`key`/`playlist_key`, pass `subtitles` array into the stream object.

### Nuvio scrapers
`getStreams(tmdbId, mediaType, seasonNum, episodeNum)` — TMDB key is hardcoded in each file. They return `[{url, quality, title, name, provider}]` or bare URL strings; both normalize to `{url, quality, type}`. Only 3 of 26 produced streams: playimdb, moviesdrive, anizone. Many are config-gated (gramcinema/showbox need tokens) or dead.

### Anivexa — endpoint contracts
- Route: `anivexa.pages.dev/watch/{route}/{anilistId}/sub/{route}-{ep}`.
- **reanime:** `streams:[{server, audio, index, url, type:'hls', embed, key, playlist_key, subtitles, thumbnails_vtt, intro_chapter, outro_chapter}]` plus `allServers`/`failedServers`. Iterate the full `streams` array — one embed can fail while others decrypt.
- **mkissa:** `{sources:[{url:"https://allanime.day/apivtwo/clock.json?id=…"}]}` → resolve `clock.json` → `{links:[{link:"wixstatic/…/master.m3u8", hls:true}]}`. One extra hop in the adapter.
- **Variants:** some providers return a top-level `stream_url` plus `streams`; others return only `sources`. Walk `stream_url`, `streams[].url`, and `sources[].url`.

### Varomine — endpoints
- **anikage (scraper.ts):** browse `/api/media/anime/browse?q=…` → detail `/{slug}/__data.json` → episodes `/{slug}/episodes` → servers `/{slug}/episodes/{n}/servers` → sources `/{slug}/episodes/{n}/sources?provider=koto&lang=sub` → `{sources:[{streamUrl: <short-token>}]}` → proxy `og.bakayaro.live/m3u8/{token}` (or `/stream/{token}`).
- **hanime (worker):** landing `{sections:[{title, videos:[{slug}]}]}` (search returns `nbHits:0`); video `/{slug}` → `sources:[{url:"hanime.tv/hls/{id}/{token}"}]` → proxied via `streamrelay.sapis.workers.dev/proxy?url=`.
- **reanime-api:** same Flixcloud backend as anivexa reanime — `reanime.to/api/flix/{anilistId}/{ep}`.

---

## Repo Links

| Repo | URL |
|---|---|
| Nuvio | https://github.com/NuvioPlugin/All-in-One-Nuvio |
| Anivexa API | https://github.com/walterwhite-69/Anivexa-API |
| Anivexa Proxy | https://github.com/walterwhite-69/Anivexa-Proxy |
| Moviebox API | https://github.com/walterwhite-69/Moviebox-API |
| Varomine Anime Scraper | https://anime-streaming-api.pages.dev/ (source: `varomine-Anime-Scraper-API`) |
| Varomine hanime | `varomine-hanime.tv-api` |

Local mirrors: `/root/provider-eval/all-in-one-nuvio/providers`, `/root/provider-eval/anivexa-api`, `/root/provider-eval/varomine-Anime-Scraper-API`, `/root/provider-eval/varomine-hanime.tv-api/src`

## How to add a provider (adapter contract)

`providers/` is **flat** — new modules go next to `reanime.ts` (e.g. `providers/anizone.ts`), not under subfolders.

1. **Module.** Implement `providers/<name>.ts` exporting `get<Name>Streams` (anime/movies/series) or `get<Name>Downloads`. Input: `AnimeProviderInput | MovieProviderInput | TvProviderInput` (contains the resolved external IDs); output: `RawStream[]` / `RawDownload[]`.
2. **Manifest.** Add one entry to `providers/manifest.json`: `{name, module, enabled:true, type:["anime"|"movies"|"series"], capabilities:["streaming"|"downloading"], supportedIds:["anilist"|"tmdb"|"imdb"|"mal"|"moviebox"|""], priority_stream:N}`.
3. **Nothing else.** The registry dynamically imports the module at startup; the manifest is the single source of truth.

`★ Insight ─────────────────────────────────────`
`supportedIds` determines **how the metadata layer calls you**: if you claim `anilist`, the registry passes the AniList ID and expects your module to look the show up itself (title search → episode list → stream). If you claim `tmdb`, it passes the TMDB ID. Providers with `supportedIds: []` are pure title/fuzzy search. Your provider module owns the *lookup*; it does not do ID translation — that stays with the metadata layer.
`─────────────────────────────────────────────────`

**Return shape:** `RawStream` = `{ url, quality, type }` plus optional `subtitles`, `headers` (set Referer for referer-gated hosts), `type: "hls"|"mp4"|"dash"`. If `type` is `mp4` with no headers, our proxy passthrough sends it raw (that's why the existing animegg adapter returns raw URLs and fails in-browser on vidcache).

**Priority:** lower `priority_stream` = tried first. Don't reuse a priority already assigned for that `type:capability` combo — the registry warns and skips ALL providers sharing it for that operation.

---

## Suggested Priority

**Phase 1 — Anime (highest quality):**
1. **anivexa reanime** — 60 subs, 4 stream mirrors, already has an adapter (`providers/anime/reanime.ts` exists)
2. **anivexa anizone** — 16 subs, direct
3. **anivexa anikoto** — 24 subs, referer one-liner
4. **anivexa mkissa** — one-hop clock resolver
5. **anivexa kickassanime** — referer one-liner
6. **anivexa animegg** — add headers + proxy flag (already partially wired)
7. **anizone (anivexa)** — 16 subs (.ass), direct. New file `anizone.ts`.
8. **mkissa (anivexa)** — clock.json one-hop resolver. New file `mkissa.ts`.
9. **kickassanime/kaa (anivexa)** — referer `kaa.lt`. **Adapter already exists** (`kaa.ts`) — verify Referer handling.
10. **animegg (anivexa)** — already partially wired; add Referer headers + proxy flag (vidcache fails without). Existing adapter `animegg.ts`.
11. **animeonsen (anivexa)** — DASH support, referer `animeonsen.xyz`. New file `animeonsen.ts`.
12. **anikage (varomine)** — proxy + live server ids `koto`/`kite` (not `pahe`). New file.
13. **hanime (varomine)** — streamrelay proxy, hentai category. New file.
14. **reanime-api (varomine)** — flixcloud path (same backend as anivexa reanime, 6 subs). Reuse `reanime.ts`.

**Phase 2 — Movies/TV (new files):**
15. **playimdb** — HLS. `providers/playimdb.ts`, `supportedIds:["tmdb"], type:["movies"]`.
16. **moviesdrive** — MP4 (watch for occasional Google-CDN timeouts). `providers/moviesdrive.ts`, `supportedIds:["tmdb"], type:["movies"]`.

**Adapter status:** existing adapters that need review/extension — `reanime.ts` (flixcloud XOR), `anikoto.ts`, `kaa.ts` (both need Referer headers), `animegg.ts` (needs headers + proxy flag). New adapters to write — `anizone.ts`, `mkissa.ts`, `animeonsen.ts`, `anikage.ts`, `hanime.ts`, `playimdb.ts`, `moviesdrive.ts`.

**Handle with care (curl-only or one-hop):** anipm (curl-only; browser session via `core/wreq.js`), mkissa (clock.json hop), hanime (isolated worker + streamrelay proxy).

---

*Source notes compiled from `tests/summary_08112026.md` and live repo inspection. No production code changed.*
