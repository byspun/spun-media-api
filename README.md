<div align="center">

# 🎬 Spün Media API

**A universal media provider for modern media applications.**

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat&logo=cloudflare&logoColor=white)][cloudflare-workers]
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat&logo=typescript&logoColor=white)][typescript]
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=flat&logo=node.js&logoColor=white)][nodejs]
[![API](https://img.shields.io/badge/API-v1.0.0-7c3aed?style=flat)][api-docs]
[![Status](https://img.shields.io/badge/Status-Stable-brightgreen?style=flat)][api-docs]
[![Self-Hosted](https://img.shields.io/badge/Deployment-Self--Hosted-f59e0b?style=flat)][self-hosting]
[![CLI](https://img.shields.io/badge/CLI-spn-111827?style=flat)][spn-cli]

[Official Website][official-site] · [Hosted API][hosted-api] · [API Documentation][api-docs] · [Public Endpoint Inventory][docs/endpoints.md]

</div>

## Introduction

Spün Media API is a universal media provider designed to simplify how developers build media applications. It unifies content, metadata, discovery, and media delivery from multiple sources behind a single, consistent API, eliminating the need to integrate and maintain multiple providers independently.

Built to power media applications of any scale, Spün handles the complexity of provider integration, metadata normalization, content mapping, and media delivery so developers can focus on building the experience. A single API key gives full access to every endpoint — no juggling or moderating multiple providers.

This is **v1.0.0** of the Spün Media API. The official Spün website is at [byspun.xyz][official-site].

## Table of contents

- [Self-hosting](#self-hosting)
- [What Spün provides](#what-spün-provides)
- [Repository structure](#repository-structure)
- [Public API](#public-api)
- [Authentication model](#authentication-model)
- [Deployment](#deployment)
- [Environment variables](#environment-variables)
- [Administration API](#administration-api)
- [Internal service API](#internal-service-api)
- [Response formats](#response-formats)
- [spn CLI](#spn-cli)

## Self-hosting

This repository contains the source code for **self-hosting Spün Media API**. Deploy the metadata layer as a **Cloudflare Worker**, and the providers layer on any hosting service of your choice — **except Vercel**.

The public Spün instance at `https://media.byspun.xyz` is a hosted reference and optional service; access to it is separate from possession of this source code. A self-hosted installation must use its own Worker URL, providers-service URL, database, credentials, secrets, and cache namespace. Never copy Spün's production secrets or credentials into a self-hosted installation.

## What Spün provides

| Capability | Description |
|---|---|
| Unified metadata | Common media structures for movies, TV, and anime. |
| Search and discovery | Search, trending, popular, new content, genres, studios, schedules, rankings, and related content. |
| Streaming | Provider-independent stream resolution with format-aware proxying. |
| Downloads | Batch and single-episode download responses. |
| Subtitles | Subtitle retrieval, VTT proxy responses, and downloadable subtitle support. |
| Resolver | Conversion of external identifiers into canonical Spün IDs. |
| Provider orchestration | Provider fallback and normalization behind the API boundary. |
| Administration | Homepage builds, cache controls, logs, diagnostics, account records, and API-key management. |
| CLI | Interactive Bash CLI for operating the API without repeatedly writing curl commands. |

## Repository structure

```text
spun-media-api/
├── account/       Account, API-key, plan, subscription, and usage groundwork
├── auth/          Shared authentication helpers
├── cli/           Standalone spn Bash CLI
├── database/      Canonical PostgreSQL schema
├── errors/        Shared error registry
├── logs/          Shared logging support and local archives
├── metadata/      Cloudflare Worker metadata and gateway layer
├── providers/     Node.js provider service
├── render.yaml    Example Render deployment manifest
└── README.md
```

## Public API

For live testing, complete response formats, request examples, and interactive documentation, visit:

**[API Documentation][api-docs]**

For a quick table of public endpoints and their parameters, see:

**[Endpoints Documentation][docs/endpoints.md]**

## Authentication model

The API has three separate trust layers.

| Trust layer | Header | Used for |
|---|---|---|
| Public consumer | `X-User-Key` | Protected public `/v1/*` media and metadata routes. |
| Operator/admin | `X-Admin-Key` | `/v1/admin/*` operations and operator testing of public Worker routes. |
| Internal service | `X-Internals-Key` | Worker-to-provider and other trusted internal calls. |

Health endpoints remain unauthenticated. Do not send the admin key and internals key together. Do not expose the internals key to browser clients.

```bash
# Public request
curl "https://your-worker.example/v1/search?q=matrix" \
  -H "X-User-Key: spn_your_user_key"

# Operator request
curl "https://your-worker.example/v1/search?q=matrix" \
  -H "X-Admin-Key: your_admin_key"
```

## Deployment

### Prerequisites

| Requirement | Purpose |
|---|---|
| Git, Node.js, npm | Clone and build the metadata and providers layers. |
| Cloudflare account | Run the metadata Worker and KV cache. |
| Any host except Vercel (Render, Railway, Fly.io, VPS, Docker, etc.) | Run the Node.js providers service. |
| Neon or compatible PostgreSQL | Store catalogue, episode, health, log, and account data. |
| TMDB, Daratech, SubDL, TasteDive credentials | Metadata, streaming fallback, subtitles, and enrichment. |
| Self-hosted [Spün MovieBox API][moviebox-api] | MovieBox metadata/download integration. |
| [Spün AniList/Jikan Proxy][anilist-proxy] (self-hosted or Spün's hosted instance) | Cloudflare Workers can't call AniList directly — this proxy relays anime metadata calls from the metadata layer. |

### Setup

```bash
# Clone and install
git clone https://github.com/heisdanny64/spun-media-api.git
cd spun-media-api
npm install
cd metadata && npm install && cd ../providers && npm install && cd ..

# Apply the database schema
psql "$NEON_DATABASE_URL" -f database/schema.sql

# Configure and deploy the providers layer (any host except Vercel)
cd providers
cp .env.example .env   # fill in your values
npm run build && npm start

# Configure and deploy the metadata Worker (Cloudflare)
cd ../metadata
cp .dev.vars.example .dev.vars   # local dev only
npx wrangler kv namespace create MEDIA_CACHE
npx wrangler secret put TMDB_API_KEY   # repeat for each required secret
npx wrangler deploy
```

Anime metadata calls go through the [Spün AniList/Jikan Proxy][anilist-proxy], since Cloudflare Workers can't call AniList directly. Either deploy your own instance and configure its own `SPUN_PROXY_SECRET`, or point `PROXY_BASE_URL` at Spün's hosted instance and request a secret.

The Worker and providers service must share the same `INTERNALS_KEY` and the same database. Attach your own HTTPS domain to the Worker, then verify:

```bash
curl -L https://your-worker.example/v1/health
curl https://your-providers-host.example/health
```

## Environment variables

### Metadata Worker

| Variable | Required | Purpose |
|---|---:|---|
| `ENVIRONMENT` | Yes | Worker environment name, normally `production`. |
| `MEDIA_CACHE` | Yes | Cloudflare KV namespace binding for metadata and homepage caching. |
| `TMDB_API_KEY` | Yes | TMDB metadata and mapping access. |
| `NEON_DATABASE_URL` | Yes | Pooled PostgreSQL connection string. |
| `RENDER_BACKEND_URL` | Yes | URL of your self-hosted providers service. |
| `INTERNALS_KEY` | Yes | Shared Worker-to-providers trust credential. |
| `ADMIN_KEY` | Yes | Credential for `/v1/admin/*` and operator testing. |
| `LOG_UPLOAD_KEY` | Recommended | Credential accepted by automated provider log uploads. |
| `MOVIEBOX_API_BASE` / `MOVIEBOX_API_SECRET` | Required for MovieBox | Your self-hosted MovieBox API URL and secret. |
| `SUBDL_API_KEY` | Required for subtitles | SubDL subtitle catalogue credential. |
| `SUBTITLE_PROXY_TOKEN_SECRET` / `STREAM_PROXY_TOKEN_SECRET` | Required | Secrets for opaque proxy references. |
| `TASTEDIVE_API_KEY` | Required for enrichment | TasteDive similar-content credential. |
| `PROXY_BASE_URL` / `SPUN_PROXY_SECRET` | Required for anime metadata | URL and secret for the [Spün AniList/Jikan Proxy][anilist-proxy] — self-hosted, or Spün's hosted instance at `https://spun-anilist-proxy.vercel.app` with your own requested secret. |

### Providers service

| Variable | Required | Purpose |
|---|---:|---|
| `PORT` | Platform-dependent | Defaults to `10000`. |
| `INTERNALS_KEY` | Yes | Must match the metadata Worker's internal key. |
| `NEON_DATABASE_URL` | Recommended | Enables persisted provider health and shared database access. |
| `ADMIN_KEY` | Yes | Protects provider diagnostics and log-flush administration. |
| `LOG_UPLOAD_URL` / `LOG_UPLOAD_KEY` | Recommended | Worker log-upload endpoint and matching key. |
| `MOVIEBOX_API_BASE` / `MOVIEBOX_API_SECRET` | Required for MovieBox | Your self-hosted MovieBox API URL and secret. |
| `TMDB_API_KEY` | Required | TMDB credential used by provider integrations. |
| `DARATECH_API_BASE` / `DARATECH_API_KEY` | Required for Daratech | Get credentials from [Daratech Movies API][daratech]. |

Never commit `.env`, `.dev.vars`, or any secret value to Git. Rotate a credential if it is ever exposed.

## Administration API

All Worker administration routes are under `/v1/admin/*` and require `X-Admin-Key`, except the log-upload route, which also accepts `X-Log-Upload-Key`.

| Method | Endpoint | Parameters/body | Purpose |
|---|---|---|---|
| `GET` | `/v1/admin` | None | List administrative endpoints. |
| `POST` | `/v1/admin/home/build` | Query: `type=all\|movie\|tv\|anime`, optional `wait=true` | Build a homepage snapshot. |
| `POST` | `/v1/admin/home/backfill` | Optional query: `limit` (max 100) | Backfill metadata summaries. |
| `POST` | `/v1/admin/home/warm-cache` | Query: `type=all\|movie\|tv\|anime` | Warm homepage cache. |
| `POST` | `/v1/admin/cache/clear` | None | Bump cache version and clear logical cache state. |
| `POST` | `/v1/admin/franchise/register` | Optional query: `id` or `franchise` | Register curated franchises. |
| `GET` | `/v1/admin/diagnostics/:provider/:type` | Query: `title` plus diagnostic fields | Run an allowlisted provider diagnostic. |
| `GET` | `/v1/admin/logs` | Optional: `service`, `from`, `to`, `page`, `limit` | List archived logs with pagination. |
| `GET` | `/v1/admin/logs/:service/:date` | Optional: `level`, `namespace` | Read a daily log archive as text. |
| `POST` | `/v1/admin/logs/upload` | JSON: `service`, `date`, `content` | Store log content (max 5 MiB). |
| `POST` | `/v1/admin/logs/flush` | Optional query: `service`, `date` | Flush/archive current service logs. |
| `GET` | `/v1/admin/keys/list` | Optional: `status`, `account_id`, `page`, `limit` | List masked API keys. |
| `GET` | `/v1/admin/accounts/:accountId/keys/list` | Optional: `status`, `page`, `limit` | List keys belonging to an account. |
| `POST` | `/v1/admin/accounts/create` | JSON account body | Create a local account record. |
| `POST` | `/v1/admin/accounts/:accountId/keys/gen` | JSON: `label`, optional `expires_at` | Generate an API key for an account. |
| `GET` | `/v1/admin/keys/:keyId` | None | Read masked API-key metadata. |
| `POST` | `/v1/admin/keys/:keyId/revoke` | JSON: `reason` | Permanently revoke an API key. |

**Homepage build**

```bash
curl -X POST "https://your-worker.example/v1/admin/home/build?type=movie&wait=true" \
  -H "X-Admin-Key: your_admin_key"
```
```json
{ "success": true, "message": "Homepage build completed for type: movie.", "type": "movie" }
```

**Cache clear**

```bash
curl -X POST https://your-worker.example/v1/admin/cache/clear \
  -H "X-Admin-Key: your_admin_key"
```
```json
{ "success": true, "message": "Cache cleared successfully.", "version": "cache-version-value" }
```

**Logs — list, read, upload**

```bash
curl "https://your-worker.example/v1/admin/logs?service=providers&page=1&limit=25" \
  -H "X-Admin-Key: your_admin_key"
```
```json
{
  "total": 1,
  "logs": [{ "service": "providers", "date": "2026-08-22", "updated_at": "2026-08-22T02:00:00.000Z" }],
  "pagination": { "page": 1, "limit": 25, "total_pages": 1, "has_next": false, "has_previous": false }
}
```

Reading `/v1/admin/logs/:service/:date` returns `text/plain` log content directly.

```bash
curl -X POST https://your-worker.example/v1/admin/logs/upload \
  -H "Content-Type: application/json" \
  -H "X-Log-Upload-Key: your_log_upload_key" \
  -d '{"service":"providers","date":"2026-08-22","content":"[...] service started"}'
```
```json
{ "success": true, "service": "providers", "date": "2026-08-22", "path": "providers/2026/08/2026-08-22.log" }
```

**Account creation**

```bash
curl -X POST https://your-worker.example/v1/admin/accounts/create \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: your_admin_key" \
  -d '{"auth_subject":"dev","email":"user@example.com","name":"Example User","status":"active"}'
```
```json
{
  "success": true,
  "action": "created",
  "account": {
    "id": "account-uuid", "auth_subject": "dev", "email": "user@example.com",
    "name": "Example User", "status": "active",
    "created_at": "2026-08-22T02:00:00.000Z", "updated_at": "2026-08-22T02:00:00.000Z"
  }
}
```

**API-key generation**

```bash
curl -X POST https://your-worker.example/v1/admin/accounts/account-uuid/keys/gen \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: your_admin_key" \
  -d '{"label":"Development Key","expires_at":null}'
```
```json
{
  "success": true,
  "message": "API key generated successfully. Copy it now; it will not be shown again.",
  "api_key": {
    "id": "key-uuid", "account_id": "account-uuid", "key_prefix": "spn_abc123",
    "label": "Development Key", "status": "active", "expires_at": null,
    "created_at": "2026-08-22T02:00:00.000Z", "updated_at": "2026-08-22T02:00:00.000Z",
    "last_used_at": null, "revoked_at": null, "revocation_reason": null,
    "key": "spn_full_value_shown_once"
  }
}
```

The full key is returned only at generation time — store it securely.

**API-key revocation**

```bash
curl -X POST https://your-worker.example/v1/admin/keys/key-uuid/revoke \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: your_admin_key" \
  -d '{"reason":"Development key rotation"}'
```
```json
{
  "success": true,
  "message": "API key revoked successfully.",
  "key": { "id": "key-uuid", "status": "revoked", "revoked_at": "2026-08-22T02:00:00.000Z", "revocation_reason": "Development key rotation" }
}
```

## Internal service API

Internal routes are not consumer-facing; they maintain the trusted boundary between the Worker and the providers service.

### Worker internal routes

| Method | Endpoint | Authentication | Body/query | Purpose |
|---|---|---|---|---|
| `PUT` | `/v1/internal/accounts/:authSubject` | `X-Internals-Key` | JSON: optional `email`, `name`, `status` | Create or update a local account record during account sync. |

```bash
curl -X PUT "https://your-worker.example/v1/internal/accounts/user-subject" \
  -H "Content-Type: application/json" \
  -H "X-Internals-Key: your_internal_key" \
  -d '{"email":"user@example.com","name":"Example User","status":"active"}'
```
```json
{
  "success": true,
  "action": "created",
  "account": { "id": "account-uuid", "auth_subject": "user-subject", "email": "user@example.com", "name": "Example User", "status": "active" }
}
```

### Providers-service routes

Normally called by the metadata Worker, not directly by consumers.

| Method | Endpoint | Authentication | Parameters | Response |
|---|---|---|---|---|
| `GET` | `/health` | None | None | Provider capability and content-resolution status. |
| `GET` | `/stream` | `X-Internals-Key` | Type-specific provider query fields | Normalized stream response or `STREAMS_UNAVAILABLE`. |
| `GET` | `/download` | `X-Internals-Key` | Type-specific provider query fields | Normalized download response or `DOWNLOADS_UNAVAILABLE`. |
| `GET` | `/admin/diagnostics/:provider/:type` | `X-Admin-Key` | `title` and diagnostic fields | Diagnostic result for allowlisted provider/type. |
| `POST` | `/admin/logs/flush` | `X-Admin-Key` | None | Log flush result. |

**Stream request fields** (`/stream`)

| Field | Movie | TV | Anime |
|---|---:|---:|---:|
| `type`, `title` | Required | Required | Required |
| `tmdb_id` | Required unless MovieBox-only | Required unless MovieBox-only | Not used |
| `moviebox_id` / `imdb_id` / `year` | Optional | Optional | Not used |
| `anilist_id` | Not used | Not used | Required |
| `mal_id` | Not used | Not used | Optional |
| `season` | Not used | Required | Defaults to 1 |
| `episode` | Not used | Required | Required, defaults to 1 |
| `audio` | Not used | Not used | Optional `sub`/`dub` |
| `spun_id` | Required for response identity | Required for response identity | Required for response identity |

**Stream response**
```json
{
  "spun_id": "fight-club-828920",
  "title": "Fight Club",
  "type": "movie",
  "streams": [{ "quality": "1080p", "format": "mp4", "audio": "Original", "url": "https://stream.example/video.mp4" }],
  "subtitles": []
}
```

**Download response**
```json
{
  "spun_id": "example-series-123456",
  "title": "Example Series",
  "type": "tv",
  "downloads": [{
    "season": 1, "episode": 1,
    "options": [{ "quality": "1080p", "format": "mp4", "audio": "Original", "url": "https://download.example/file.mp4", "filename": "example-s01e01.mp4", "size": "1.2 GB" }]
  }],
  "subtitles": []
}
```

**Provider health response**
```bash
curl https://your-providers-host.example/health
```
```json
{
  "status": "ok",
  "capabilities": { "streaming": true, "downloads": true, "anime": true },
  "content_resolution": { "status": "healthy", "checked_at": "2026-08-22T02:00:00.000Z" }
}
```

**Provider diagnostics** (currently allowlisted: Daratech, movie/TV)
```bash
curl "https://your-providers-host.example/admin/diagnostics/daratech/movie?title=Fight%20Club" \
  -H "X-Admin-Key: your_provider_admin_key"
```
```json
{ "diagnostic": true, "generated_at": "2026-08-22T02:00:00.000Z", "provider": "daratech", "type": "movie", "result": {} }
```

## Response formats

Public response formats are documented and tested on the frontend documentation site:

**[API Documentation][api-docs]**

Administrative and internal responses follow these conventions:

- **Structured errors:**
  ```json
  { "error": { "code": "ERROR_CODE", "error": "Human-readable error", "description": "Why the operation failed", "action": "What the caller should do next" } }
  ```
- **Lists and pagination:** use `page`, `limit`, `total_pages`, `has_next`, `has_previous` as returned by the specific endpoint.
- **Logs:** archive reads return plain text; list, upload, and flush operations return JSON.
- **API keys:** list/detail responses expose masked metadata only. The full `spn_...` value is returned once, at generation.

## `spn` CLI

The repository includes a standalone Bash CLI at `cli/spn-cli`. It's not a package and requires no framework.

**Install (Termux):**
```bash
pkg install curl jq
chmod +x cli/spn-cli
mkdir -p "$PREFIX/bin"
cp cli/spn-cli "$PREFIX/bin/spn"
chmod +x "$PREFIX/bin/spn"
hash -r
spn help
```

**Configure:**
```bash
spn config
```
Stores local settings in `~/.spn.env` (mode `600`): `SPN_API_BASE_URL`, `SPN_ADMIN_KEY`, `SPN_RENDER_BASE_URL`, `SPN_INTERNALS_KEY`.

**Help navigation:**
```text
spn help
spn help --search
spn help --stream
spn help --admin
spn help --internal
```
Enter `:q` at any prompt to cancel; `Ctrl+C` for an emergency exit.

**Common commands:**
```text
spn health
spn search --movie --params
spn info --cast
spn stream --tv
spn download --tv --all
spn subtitles --tv
spn resolve --tmdb
spn home --movie
spn admin keys --generate
spn admin logs --list --params
```

Required values are prompted automatically; optional query params only with `--params`. Responses are formatted with `jq` when available.

---

[Official Spün Website][official-site] · [Hosted API][hosted-api] · [Public API Docs][api-docs] · [Public Endpoint Inventory][docs/endpoints.md]

[official-site]: https://byspun.xyz
[hosted-api]: https://media.byspun.xyz
[api-docs]: https://media.byspun.xyz/docs
[docs/endpoints.md]: docs/endpoints.md
[moviebox-api]: https://github.com/heisdanny64/spun-moviebox-api
[anilist-proxy]: https://github.com/heisdanny64/spun-anilist-proxy
[daratech]: https://apimovie.runflix.name.ng
[cloudflare-workers]: https://workers.cloudflare.com/
[typescript]: https://www.typescriptlang.org/
[nodejs]: https://nodejs.org/
[self-hosting]: #self-hosting
[spn-cli]: #spn-cli
