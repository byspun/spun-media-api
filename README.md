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

Built to power media applications of any scale, Spün handles the complexity of provider integration, metadata normalization, content mapping, and media delivery so developers can focus on building the experience.

## Table of contents

- [Project status and versioning](#project-status-and-versioning)
- [Self-hosting](#self-hosting)
- [What Spün provides](#what-spün-provides)
- [Architecture](#architecture)
- [Repository structure](#repository-structure)
- [Public API](#public-api)
- [Authentication model](#authentication-model)
- [Deployment prerequisites](#deployment-prerequisites)
- [1. Clone and install](#1-clone-and-install)
- [2. Configure the Neon database](#2-configure-the-neon-database)
- [3. Configure the providers layer](#3-configure-the-providers-layer)
- [4. Deploy the providers layer](#4-deploy-the-providers-layer)
- [5. Configure the metadata Worker](#5-configure-the-metadata-worker)
- [6. Deploy the metadata Worker](#6-deploy-the-metadata-worker)
- [7. Configure the domain](#7-configure-the-domain)
- [8. Deploy and configure the MovieBox service](#8-deploy-and-configure-the-moviebox-service)
- [9. Verify the installation](#9-verify-the-installation)
- [Environment variables and secrets](#environment-variables-and-secrets)
- [Administration API](#administration-api)
- [Internal service API](#internal-service-api)
- [Response formats](#response-formats)
- [spn CLI](#spn-cli)
- [Operations and troubleshooting](#operations-and-troubleshooting)
- [Version roadmap](#version-roadmap)
- [Important third-party service notice](#important-third-party-service-notice)

## Project status and versioning

**Current release: `v1.0.0`**

Spün Media API v1.0.0 is the stable universal media infrastructure release. It includes the metadata Worker, provider service, unified movie/TV/anime catalogue, discovery, resolver, streaming, downloads, subtitles, proxying, health checks, logs, diagnostics, homepage operations, administrative controls, API-key authentication, and the standalone `spn` CLI.

The current source also contains groundwork for the accounts and commercial model, including account records, plans, subscriptions, usage structures, and API-key management. The complete account experience is intentionally scheduled for v1.5.0.

| Version | Scope |
|---|---|
| `v1.0.0` | Stable media infrastructure and operator tooling. |
| `v1.5.0` | Planned complete accounts layer, including the full customer account experience and related commercial functionality. |
| `v2.0.0+` | Future content types, media categories, and broader platform capabilities. |

## Self-hosting

This repository contains the source code for **self-hosting Spün Media API**. If you have obtained this source code, you are expected to deploy and operate your own instance.

The public Spün instance at `https://media.byspun.xyz` is provided as a hosted reference and optional service. Access to the public instance is separate from possession of this source code. A self-hosted installation must use its own Worker URL, provider-service URL, database, credentials, secrets, cache namespace, and external API accounts.

Do not copy Spün’s production secrets, Cloudflare bindings, database connection string, or hosted service credentials into a self-hosted installation. Generate and configure your own values.

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

## Architecture

```text
Consumer application
        │
        ▼
Self-hosted Cloudflare Worker or compatible Worker deployment
(metadata, public routes, authentication, cache, proxy gateway)
        │
        ▼
Self-hosted Node.js providers service
(provider integrations, fallback orchestration, streams, downloads)
        │
        ├── Neon/PostgreSQL
        │   (catalogue, episodes, provider health, logs, accounts, keys)
        │
        └── Cloudflare KV
            (metadata cache and homepage snapshots)
```

The normal consumer only communicates with the metadata API. Provider names and upstream implementation details remain behind the gateway’s black-box boundary.

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

For live testing, complete public response formats, request examples, and interactive documentation, visit:

[API Documentation][api-docs]

For a quick source-code route inventory containing public methods, paths, required values, optional parameters, and authentication requirements, see:

[Endpoints Documentation][docs/endpoints.md]

The public API base URL of the hosted Spün instance is:

```text
https://media.byspun.xyz/v1
```

Self-hosted operators must replace this with their own deployed Worker URL. The public documentation URL is also a reference to Spün’s hosted instance; it is not a requirement that a purchaser continue using that instance.

## Authentication model

The API has three separate trust layers.

| Trust layer | Header | Used for |
|---|---|---|
| Public consumer | `X-User-Key` | Protected public `/v1/*` media and metadata routes. |
| Operator/admin | `X-Admin-Key` | `/v1/admin/*` operations and operator testing of public Worker routes. |
| Internal service | `X-Internals-Key` | Worker-to-provider and other trusted internal calls. |

Health endpoints remain unauthenticated. Do not send the admin key and internals key together. Do not expose the internals key to browser clients.

A normal public request looks like this:

```bash
curl "https://your-worker.example/v1/search?q=matrix" \
  -H "X-User-Key: spn_your_user_key"
```

An operator request looks like this:

```bash
curl "https://your-worker.example/v1/search?q=matrix" \
  -H "X-Admin-Key: your_admin_key"
```

## Deployment prerequisites

A self-hosted installation requires the following:

| Requirement | Purpose |
|---|---|
| Git | Clone and update the source repository. |
| Node.js and npm | Build the metadata and providers layers. |
| Cloudflare account or compatible Worker host | Run the metadata Worker and KV cache. |
| Render, Railway, Fly.io, Heroku, VPS, Docker host, or equivalent | Run the Node.js providers service. |
| Neon or compatible PostgreSQL | Store catalogue, episode, health, log, account, and key data. |
| DNS/TLS-capable domain | Expose the self-hosted Worker over HTTPS. |
| TMDB credentials | Movie and TV metadata and provider mapping. |
| Daratech credentials | Daratech streaming fallback access. |
| Self-hosted Spün MovieBox API | MovieBox metadata/download integration. |
| SubDL credentials | Subtitle catalogue access. |
| TasteDive credentials | Similar-content enrichment. |
| AniList/Jikan proxy deployment | Anime metadata access where the proxy configuration is used. |

All values in the following sections are examples or variable names only. Never commit real secrets to Git.

## 1. Clone and install

```bash
git clone https://github.com/heisdanny64/spun-media-api.git
cd spun-media-api
npm install
cd metadata && npm install
cd ../providers && npm install
cd ..
```

The repository uses npm scripts. The main validation commands are:

```bash
npm run type-check
npm test
cd providers && npm run build
cd ../metadata && npx wrangler deploy --dry-run
```

## 2. Configure the Neon database

Create a Neon project or use another compatible PostgreSQL service. Run the canonical schema against that database:

```bash
psql "$NEON_DATABASE_URL" -f database/schema.sql
```

The schema creates the runtime structures for media titles, episodes, provider health, studios, logs, accounts, plans, subscriptions, API keys, and monthly usage records. It also seeds the curated plans and studio registry.

Verify that the schema completed before deploying either application layer. The Worker and providers service must use the same database when they need to share catalogue, health, log, or account records.

## 3. Configure the providers layer

The providers service is a standalone Node.js application. It is not Render-specific. You can run it on Render, Railway, Fly.io, Heroku, a VPS, a Docker-compatible host, or another service capable of running the project’s Node/npm commands.

Copy the provider environment template into your hosting provider’s environment settings. Do not commit a real `.env` file:

```bash
cd providers
cp .env.example .env
```

For hosted production deployments, enter the variables in the platform’s secret/environment settings instead of creating a committed file.

The providers service should be configured with:

```text
INTERNALS_KEY=<same value configured on the Worker>
NEON_DATABASE_URL=<your pooled Neon connection string>
ADMIN_KEY=<your provider-admin key>
LOG_UPLOAD_URL=<your Worker URL>/v1/admin/logs/upload
LOG_UPLOAD_KEY=<dedicated log upload key>
MOVIEBOX_API_BASE=<your self-hosted MovieBox API URL>
MOVIEBOX_API_SECRET=<your MovieBox API secret>
TMDB_API_KEY=<your TMDB key>
DARATECH_API_BASE=https://apimovie.runflix.name.ng/v1
DARATECH_API_KEY=<your Daratech key>
PORT=<platform-provided port or 10000>
NODE_ENV=production
```

`LOG_UPLOAD_URL` and `LOG_UPLOAD_KEY` enable automatic provider-log archiving into the Worker’s Neon-backed log archive. The service also accepts the optional `LOG_UPLOAD_INTERVAL_MS` setting; its default checkpoint interval is 15 minutes.

## 4. Deploy the providers layer

The generic deployment commands are:

```bash
cd providers
npm ci
npm run build
npm start
```

The process starts `dist/providers/index.js` and listens on the platform’s `PORT` value, defaulting to `10000` when no port is supplied.

### Render example

The included `render.yaml` demonstrates a Render deployment with `providers` as the root directory, `npm install && npm run build` as the build command, `npm start` as the start command, and `/health` as the health-check route.

### Railway, Fly.io, Heroku, VPS, or Docker

Use the same providers directory, build script, start script, and environment-variable names. The platform-specific differences are limited to how the service is created, how the port is exposed, and where environment variables are entered.

After deployment, verify the provider service directly:

```bash
curl https://your-providers-host.example/health
```

The provider service should not be exposed to browser consumers as the public API. The metadata Worker should be the public gateway.

## 5. Configure the metadata Worker

The metadata layer is a Cloudflare Worker located in `metadata/`. Create a private local variables file for development only:

```bash
cd metadata
cp .dev.vars.example .dev.vars
```

For production, configure non-secret variables in the Worker deployment settings and configure secrets using Wrangler or the selected Cloudflare deployment method.

Create your own KV namespace rather than reusing Spün’s production namespace:

```bash
npx wrangler kv namespace create MEDIA_CACHE
```

Place the returned namespace ID in your own `metadata/wrangler.toml`.

The Worker must point to your providers service:

```text
RENDER_BACKEND_URL=https://your-providers-host.example
```

The Worker also needs the same internal credential used by the providers service:

```text
INTERNALS_KEY=<same value configured on the providers service>
```

### Worker secrets

Set the secret values using your deployment system. With Wrangler, the pattern is:

```bash
npx wrangler secret put TMDB_API_KEY
npx wrangler secret put TMDB_BEARER_TOKEN
npx wrangler secret put NEON_DATABASE_URL
npx wrangler secret put RENDER_BACKEND_URL
npx wrangler secret put INTERNALS_KEY
npx wrangler secret put ADMIN_KEY
npx wrangler secret put LOG_UPLOAD_KEY
npx wrangler secret put SUBDL_API_KEY
npx wrangler secret put SUBTITLE_PROXY_TOKEN_SECRET
npx wrangler secret put STREAM_PROXY_TOKEN_SECRET
npx wrangler secret put TASTEDIVE_API_KEY
npx wrangler secret put SPUN_PROXY_SECRET
npx wrangler secret put MOVIEBOX_API_SECRET
```

Only create the optional Spün Auth verification secrets when the real authentication contract is available.

## 6. Deploy the metadata Worker

From the metadata directory:

```bash
cd metadata
npm ci
npx wrangler deploy --dry-run
npx wrangler deploy
```

The Worker’s production configuration should include your own KV namespace, your own providers URL, your own MovieBox URL, your own internal/admin/proxy secrets, and your own external API credentials.

The Worker intentionally preserves wildcard CORS origin `*`. Privileged internal credentials are not browser credentials and must not be placed in frontend code.

## 7. Configure the domain

Attach your own HTTPS domain to the metadata Worker. For example:

```text
https://api.example.com/v1
```

Update the following values after the domain exists:

| Value | Self-hosted setting |
|---|---|
| Public API base URL | `https://api.example.com/v1` |
| Provider log upload URL | `https://api.example.com/v1/admin/logs/upload` |
| Worker-to-provider backend URL | Your providers service URL. |
| MovieBox API base URL | Your self-hosted MovieBox service URL. |
| CLI Worker URL | Your public Worker URL with `/v1`. |

The public Spün domains are references only:

- Official website: [Official Spün Website][official-site]
- Hosted API: [Hosted Spün API][hosted-api]
- Hosted API docs: [API Documentation][api-docs]

## 8. Deploy and configure the MovieBox service

MovieBox integration expects a MovieBox API instance that you control. Deploy the open-source Spün MovieBox project separately:

**[MovieBox API by Spün][moviebox-api]**

Follow that repository’s own README to deploy it on your chosen host. Then configure the resulting URL and secret in both layers where required:

```text
MOVIEBOX_API_BASE=https://your-moviebox-host.example
MOVIEBOX_API_SECRET=<your-moviebox-secret>
```

Do not use Spün’s hosted MovieBox credentials. A self-hosted Spün Media API installation should use a self-hosted MovieBox service and its own secret.

## 9. Verify the installation

Run checks in this order:

```bash
# Public health
curl -L https://your-worker.example/v1/health

# Protected public route without a credential; should return a structured auth error
curl https://your-worker.example/v1/search?q=test

# Protected public route with a user key
curl "https://your-worker.example/v1/search?q=test" \
  -H "X-User-Key: spn_your_user_key"

# Admin index
curl https://your-worker.example/v1/admin \
  -H "X-Admin-Key: your_admin_key"

# Provider health
curl https://your-providers-host.example/health
```

Then test one title through metadata, stream, downloads, subtitles, and the CLI. The expected result for an unavailable provider is a structured API error such as `STREAMS_UNAVAILABLE` or `DOWNLOADS_UNAVAILABLE`; an unavailable individual provider does not necessarily mean the gateway is broken.

## Environment variables and secrets

The exact configuration names are defined by the Worker environment interface, the Worker development template, the providers template, and the deployment manifest. The following tables classify them for self-hosting.

### Metadata Worker variables

| Variable | Required | Purpose |
|---|---:|---|
| `ENVIRONMENT` | Yes | Worker environment name, normally `production`. |
| `MEDIA_CACHE` | Yes | Cloudflare KV namespace binding for metadata and homepage caching. Create your own namespace. |
| `TMDB_API_KEY` | Yes | TMDB metadata and mapping access. |
| `TMDB_BEARER_TOKEN` | Optional | TMDB bearer credential when the selected metadata calls use it. |
| `NEON_DATABASE_URL` | Yes | Pooled PostgreSQL connection string for persistent catalogue and operational data. |
| `RENDER_BACKEND_URL` | Yes | URL of your self-hosted providers service. |
| `INTERNALS_KEY` | Yes | Shared Worker-to-providers trust credential. |
| `ADMIN_KEY` | Yes for administration | Credential for `/v1/admin/*` and operator testing. |
| `LOG_UPLOAD_KEY` | Recommended | Dedicated credential accepted by automated provider log uploads. |
| `MOVIEBOX_API_BASE` | Recommended for MovieBox | URL of your self-hosted Spün MovieBox API. |
| `MOVIEBOX_API_SECRET` | Required when MovieBox is used | Secret for your MovieBox API instance. |
| `SUBDL_API_KEY` | Required for subtitles | SubDL subtitle catalogue credential. |
| `SUBTITLE_PROXY_TOKEN_SECRET` | Required for subtitle proxying | Secret used to issue opaque subtitle proxy references. |
| `STREAM_PROXY_TOKEN_SECRET` | Required for HLS stream proxying | Secret used to issue opaque stream proxy references. |
| `TASTEDIVE_API_KEY` | Required for TasteDive enrichment | TasteDive similar-content credential. |
| `PROXY_BASE_URL` | Required for configured anime proxy flow | URL of the deployed AniList/Jikan proxy service. |
| `SPUN_PROXY_SECRET` | Required with `PROXY_BASE_URL` | Secret sent to the anime proxy service. |
| `SPUN_AUTH_VERIFY_URL` | Optional placeholder | Future Spün Auth verification endpoint. |
| `SPUN_AUTH_VERIFY_KEY` | Optional placeholder | Future Spün Auth verification credential. |

### Providers-service variables

| Variable | Required | Purpose |
|---|---:|---|
| `NODE_ENV` | Recommended | Runtime mode, normally `production`. |
| `PORT` | Platform-dependent | Port exposed by the hosting platform; defaults to `10000`. |
| `INTERNALS_KEY` | Yes | Must match the metadata Worker’s internal key. |
| `NEON_DATABASE_URL` | Recommended | Enables persisted provider health and shared database access. |
| `ADMIN_KEY` | Yes for provider admin routes | Protects provider diagnostics and log-flush administration. |
| `LOG_UPLOAD_URL` | Recommended for automatic archives | Worker `/v1/admin/logs/upload` URL for provider log uploads. |
| `LOG_UPLOAD_KEY` | Recommended with log uploads | Must match the Worker’s accepted log-upload key. |
| `LOG_UPLOAD_INTERVAL_MS` | Optional | Provider log-upload checkpoint interval; defaults safely to 15 minutes. |
| `MOVIEBOX_API_BASE` | Required when MovieBox is used | URL of your self-hosted MovieBox API. |
| `MOVIEBOX_API_SECRET` | Required when MovieBox is used | Secret for your MovieBox API instance. |
| `TMDB_API_KEY` | Required for TMDB-backed providers | TMDB credential used by provider integrations. |
| `DARATECH_API_BASE` | Recommended | Daratech Movies API base URL; the default is `https://apimovie.runflix.name.ng/v1`. |
| `DARATECH_API_KEY` | Required for Daratech | Obtain a credential from [Daratech Movies API][daratech]. |

### Feature switches and future commercial controls

These switches are disabled by default in the current v1 configuration. They are groundwork for later releases and should not be enabled without implementing and testing the corresponding production controls.

| Variable | Default | Meaning |
|---|---|---|
| `BILLING_ENABLED` | `false` | Billing enforcement switch. |
| `SUBSCRIPTIONS_ENABLED` | `false` | Subscription enforcement switch. |
| `PLANS_ENABLED` | `false` | Plan-policy enforcement switch. |
| `QUOTA_MODE` | `off` | Usage-quota mode: `off`, `observe`, or `enforce`. |
| `RATE_LIMIT_MODE` | `off` | Rate-limit mode: `off`, `observe`, or `enforce`. |

### Secret-handling rules

Never commit `.env`, `.dev.vars`, Wrangler secret values, database connection strings, API keys, proxy secrets, or admin credentials. Use your hosting provider’s secret manager or environment settings. Rotate a credential if it is exposed.

The following values are especially sensitive:

```text
ADMIN_KEY
INTERNALS_KEY
LOG_UPLOAD_KEY
MOVIEBOX_API_SECRET
STREAM_PROXY_TOKEN_SECRET
SUBTITLE_PROXY_TOKEN_SECRET
SPUN_PROXY_SECRET
SPUN_AUTH_VERIFY_KEY
NEON_DATABASE_URL
TMDB_API_KEY
DARATECH_API_KEY
SUBDL_API_KEY
TASTEDIVE_API_KEY
```

## Administration API

All Worker administration routes are under `/v1/admin/*` and require `X-Admin-Key`, except that the log-upload route also accepts its dedicated `X-Log-Upload-Key`. The admin index is available at:

```text
GET /v1/admin
```

### Admin endpoint index

| Method | Endpoint | Parameters/body | Purpose |
|---|---|---|---|
| `GET` | `/v1/admin` | None | List administrative endpoints. |
| `POST` | `/v1/admin/home/build` | Query: `type=all\|movie\|tv\|anime`, optional `wait=true` | Build a homepage snapshot. |
| `POST` | `/v1/admin/home/backfill` | Optional query: `limit`, maximum 100 | Backfill metadata summaries. |
| `POST` | `/v1/admin/home/warm-cache` | Query: `type=all\|movie\|tv\|anime` | Warm homepage cache. |
| `POST` | `/v1/admin/cache/clear` | None | Bump the cache version and clear logical cache state. |
| `POST` | `/v1/admin/franchise/register` | Optional query: `id` or `franchise` | Register curated franchises. |
| `GET` | `/v1/admin/diagnostics/:provider/:type` | Query: `title` plus diagnostic query values | Run an allowlisted provider diagnostic through the providers service. |
| `GET` | `/v1/admin/logs` | Optional: `service`, `from`, `to`, `page`, `limit` | List archived logs with pagination. |
| `GET` | `/v1/admin/logs/:service/:date` | Optional: `level`, `namespace` | Read a daily log archive as text. |
| `POST` | `/v1/admin/logs/upload` | JSON: `service`, `date`, `content` | Store supplied log content; maximum 5 MiB. |
| `POST` | `/v1/admin/logs/flush` | Optional query: `service`, `date` | Flush/archive current service logs. |
| `GET` | `/v1/admin/keys/list` | Optional: `status`, `account_id`, `page`, `limit` | List masked API keys. |
| `GET` | `/v1/admin/accounts/:accountId/keys/list` | Optional: `status`, `page`, `limit` | List keys belonging to an account. |
| `POST` | `/v1/admin/accounts/create` | JSON account body | Create a local account record. |
| `POST` | `/v1/admin/accounts/:accountId/keys/gen` | JSON: `label`, optional `expires_at` | Generate an API key for an account. |
| `GET` | `/v1/admin/keys/:keyId` | None | Read masked API-key metadata. |
| `POST` | `/v1/admin/keys/:keyId/revoke` | JSON: `reason` | Permanently revoke an API key. |

### Admin index response

```json
{
  "name": "Spün Media API Administration",
  "version": "1.0.0",
  "endpoints": [
    {
      "method": "GET",
      "path": "/v1/admin",
      "description": "List administrator endpoints",
      "authentication": "X-Admin-Key"
    }
  ]
}
```

The real response contains the complete administrative endpoint array.

### Homepage build

```bash
curl -X POST "https://your-worker.example/v1/admin/home/build?type=movie&wait=true" \
  -H "X-Admin-Key: your_admin_key"
```

Synchronous success response:

```json
{
  "success": true,
  "message": "Homepage build completed for type: movie.",
  "type": "movie"
}
```

Without `wait=true`, the response is an asynchronous trigger response:

```json
{
  "success": true,
  "message": "Homepage build triggered for type: movie. It will run in the background.",
  "status_url": "/v1/home/status",
  "type": "movie"
}
```

### Cache clear

```bash
curl -X POST https://your-worker.example/v1/admin/cache/clear \
  -H "X-Admin-Key: your_admin_key"
```

```json
{
  "success": true,
  "message": "Cache cleared successfully.",
  "version": "cache-version-value"
}
```

### Logs

List archives:

```bash
curl "https://your-worker.example/v1/admin/logs?service=providers&page=1&limit=25" \
  -H "X-Admin-Key: your_admin_key"
```

Representative response:

```json
{
  "total": 1,
  "logs": [
    {
      "service": "providers",
      "date": "2026-08-22",
      "updated_at": "2026-08-22T02:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 25,
    "total_pages": 1,
    "has_next": false,
    "has_previous": false
  }
}
```

Read an archive:

```bash
curl "https://your-worker.example/v1/admin/logs/providers/2026-08-22" \
  -H "X-Admin-Key: your_admin_key"
```

This returns `text/plain` log content. Upload a log archive:

```bash
curl -X POST https://your-worker.example/v1/admin/logs/upload \
  -H "Content-Type: application/json" \
  -H "X-Log-Upload-Key: your_log_upload_key" \
  -d '{"service":"providers","date":"2026-08-22","content":"[2026-08-22T02:00:00.000Z] [providers] [startup] [INFO ] service started"}'
```

Success response:

```json
{
  "success": true,
  "service": "providers",
  "date": "2026-08-22",
  "path": "providers/2026/08/2026-08-22.log"
}
```

### Account creation

```bash
curl -X POST https://your-worker.example/v1/admin/accounts/create \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: your_admin_key" \
  -d '{"auth_subject":"dev","email":"user@example.com","name":"Example User","status":"active"}'
```

Success response:

```json
{
  "success": true,
  "action": "created",
  "account": {
    "id": "account-uuid",
    "auth_subject": "dev",
    "email": "user@example.com",
    "name": "Example User",
    "status": "active",
    "created_at": "2026-08-22T02:00:00.000Z",
    "updated_at": "2026-08-22T02:00:00.000Z"
  }
}
```

### API-key generation

```bash
curl -X POST https://your-worker.example/v1/admin/accounts/account-uuid/keys/gen \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: your_admin_key" \
  -d '{"label":"Development Key","expires_at":null}'
```

With commercial enforcement disabled, `expires_at: null` creates a non-expiring key. When the commercial policy is enabled, newly generated keys receive the configured 30-day default when no explicit future expiry is supplied. Existing non-expiring keys remain grandfathered.

Success response:

```json
{
  "success": true,
  "message": "API key generated successfully. Copy it now; it will not be shown again.",
  "api_key": {
    "id": "key-uuid",
    "account_id": "account-uuid",
    "key_prefix": "spn_abc123",
    "label": "Development Key",
    "status": "active",
    "expires_at": null,
    "created_at": "2026-08-22T02:00:00.000Z",
    "updated_at": "2026-08-22T02:00:00.000Z",
    "last_used_at": null,
    "revoked_at": null,
    "revocation_reason": null,
    "key": "spn_full_value_shown_once"
  }
}
```

The full key is returned only at generation time. Store it securely.

### API-key revocation

```bash
curl -X POST https://your-worker.example/v1/admin/keys/key-uuid/revoke \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: your_admin_key" \
  -d '{"reason":"Development key rotation"}'
```

Success response:

```json
{
  "success": true,
  "message": "API key revoked successfully.",
  "key": {
    "id": "key-uuid",
    "status": "revoked",
    "revoked_at": "2026-08-22T02:00:00.000Z",
    "revocation_reason": "Development key rotation"
  }
}
```

## Internal service API

Internal routes are not consumer-facing. They exist across the Worker and providers service to maintain the trusted service boundary.

### Worker internal routes

| Method | Endpoint | Authentication | Body/query | Purpose |
|---|---|---|---|---|
| `PUT` | `/v1/internal/accounts/:authSubject` | `X-Internals-Key` | JSON: optional `email`, `name`, `status` | Create or update a local account record during account synchronization. |

Example:

```bash
curl -X PUT "https://your-worker.example/v1/internal/accounts/user-subject" \
  -H "Content-Type: application/json" \
  -H "X-Internals-Key: your_internal_key" \
  -d '{"email":"user@example.com","name":"Example User","status":"active"}'
```

Success response when created:

```json
{
  "success": true,
  "action": "created",
  "account": {
    "id": "account-uuid",
    "auth_subject": "user-subject",
    "email": "user@example.com",
    "name": "Example User",
    "status": "active"
  }
}
```

### Providers-service routes

The providers service is normally called by the metadata Worker. Its direct routes are:

| Method | Endpoint | Authentication | Parameters | Response |
|---|---|---|---|---|
| `GET` | `/health` | None | None | Provider capability and content-resolution status. |
| `GET` | `/stream` | `X-Internals-Key` | Type-specific provider query fields. | Normalized stream response or `STREAMS_UNAVAILABLE`. |
| `GET` | `/download` | `X-Internals-Key` | Type-specific provider query fields. | Normalized download response or `DOWNLOADS_UNAVAILABLE`. |
| `GET` | `/admin/diagnostics/:provider/:type` | `X-Admin-Key` | `title` and diagnostic query fields. | Diagnostic result for allowlisted provider/type. |
| `POST` | `/admin/logs/flush` | `X-Admin-Key` | None | Log flush result. |

### Provider stream request fields

The providers service accepts these query fields through its internal `/stream` route:

| Field | Movie | TV | Anime |
|---|---:|---:|---:|
| `type` | Required | Required | Required |
| `title` | Required | Required | Required |
| `tmdb_id` | Required unless MovieBox-only | Required unless MovieBox-only | Not used |
| `moviebox_id` | Optional | Optional | Not used |
| `imdb_id` | Optional | Optional | Not used |
| `year` | Optional | Optional | Not used |
| `anilist_id` | Not used | Not used | Required |
| `mal_id` | Not used | Not used | Optional |
| `season` | Not used | Required | Defaults to 1 where applicable |
| `episode` | Not used | Required | Required, defaulting to 1 at input normalization |
| `audio` | Not used | Not used | Optional `sub`/`dub` selector |
| `spun_id` | Required for response identity | Required for response identity | Required for response identity |

### Internal stream response

```json
{
  "spun_id": "fight-club-828920",
  "title": "Fight Club",
  "type": "movie",
  "streams": [
    {
      "quality": "1080p",
      "format": "mp4",
      "audio": "Original",
      "url": "https://stream.example/video.mp4"
    }
  ],
  "subtitles": []
}
```

### Internal download response

```json
{
  "spun_id": "example-series-123456",
  "title": "Example Series",
  "type": "tv",
  "downloads": [
    {
      "season": 1,
      "episode": 1,
      "options": [
        {
          "quality": "1080p",
          "format": "mp4",
          "audio": "Original",
          "url": "https://download.example/file.mp4",
          "filename": "example-s01e01.mp4",
          "size": "1.2 GB"
        }
      ]
    }
  ],
  "subtitles": []
}
```

### Provider health response

```bash
curl https://your-providers-host.example/health
```

```json
{
  "status": "ok",
  "capabilities": {
    "streaming": true,
    "downloads": true,
    "anime": true
  },
  "content_resolution": {
    "status": "healthy",
    "checked_at": "2026-08-22T02:00:00.000Z"
  }
}
```

The provider health state can become `degraded` when recorded provider failures exist. Capability flags are based on configuration and current health records.

### Provider diagnostics

The current diagnostic allowlist supports Daratech diagnostics for movie and TV requests:

```bash
curl "https://your-providers-host.example/admin/diagnostics/daratech/movie?title=Fight%20Club" \
  -H "X-Admin-Key: your_provider_admin_key"
```

Representative response:

```json
{
  "diagnostic": true,
  "generated_at": "2026-08-22T02:00:00.000Z",
  "provider": "daratech",
  "type": "movie",
  "result": {}
}
```

Diagnostic output is operational information for the service owner. It is not part of the public black-box API.

## Response formats

Public response formats are documented and tested on the frontend documentation site:

**[API Documentation][api-docs]**

Administrative and internal responses use the following conventions.

### Structured errors

```json
{
  "error": {
    "code": "ERROR_CODE",
    "error": "Human-readable error",
    "description": "Why the operation failed",
    "action": "What the caller should do next"
  }
}
```

### Lists and pagination

Administrative list responses generally contain the resource collection and pagination metadata. A caller should use `page`, `limit`, `total_pages`, `has_next`, and `has_previous` as returned by the specific endpoint rather than assuming every response has identical fields.

### Logs

Log archive reads return plain text. Log list, upload, and flush operations return JSON.

### API keys

API-key list and detail responses expose masked metadata. The full `spn_...` value is returned only during successful generation and is never stored in plaintext by the service.

## `spn` CLI

The repository includes a standalone Bash CLI at `cli/spn-cli`. It is not a package and does not require a framework.

### Installation

From the repository directory in Termux:

```bash
pkg install curl jq
chmod +x cli/spn-cli
mkdir -p "$PREFIX/bin"
cp cli/spn-cli "$PREFIX/bin/spn"
chmod +x "$PREFIX/bin/spn"
hash -r
```

Verify it:

```bash
spn help
```

### Configuration

```bash
spn config
```

The interactive menu stores local CLI settings in:

```text
~/.spn.env
```

The four configuration values are:

| Variable | Purpose |
|---|---|
| `SPN_API_BASE_URL` | Your Worker URL ending in `/v1`. |
| `SPN_ADMIN_KEY` | Admin credential for Worker public/admin requests. |
| `SPN_RENDER_BASE_URL` | Your providers-service URL. |
| `SPN_INTERNALS_KEY` | Internal credential for direct providers-service calls. |

The configuration file should remain private and use mode `600`.

### Help navigation

```text
spn help
spn help --search
spn help --stream
spn help --admin
spn help --internal
```

`spn help` shows command groups only. Group help shows commands within that group. Enter `:q` at any active prompt to cancel the current operation. Press `Ctrl+C` for an emergency exit.

### Common commands

```text
spn health
spn search
spn search --movie --params
spn info
spn info --cast
spn info --episodes
spn stream --movie
spn stream --tv
spn stream --anime
spn download --movie
spn download --tv --all
spn subtitles --tv
spn resolve --tmdb
spn home
spn home --movie
spn admin
spn admin keys --generate
spn admin logs --list --params
```

Required values are prompted automatically. Optional URL query parameters are prompted only with `--params`. JSON body fields are prompted directly. Responses are formatted with `jq` when available.

## Operations and troubleshooting

### HTTP 307 from a flat alias

The API intentionally uses redirects for some flat aliases, including health and utility routes. Use `curl -L` when testing manually. The `spn` CLI follows bounded redirects centrally.

### `USER_KEY_REQUIRED`

The route is protected and no valid `X-User-Key` or operator `X-Admin-Key` was supplied.

### `INVALID_ADMIN_KEY` or `UNAUTHORIZED`

Check that the correct admin credential is configured for the layer being called. The Worker admin key and providers-service admin key may be configured separately.

### `INVALID_INTERNAL_KEY`

Check that the Worker’s `INTERNALS_KEY` exactly matches the providers service’s `INTERNALS_KEY`. Do not substitute the admin key.

### `SERVICE_OFFLINE`

Check the service URL, TLS certificate, host status, and required environment variables. Verify the providers service `/health` route directly.

### `STREAMS_UNAVAILABLE` or `DOWNLOADS_UNAVAILABLE`

The gateway completed its fallback process but did not receive a usable result. Check provider health, provider credentials, content mapping, and the requested title identifiers.

### Provider health shows `unknown`

The Worker may not have a fresh persisted provider-health record yet. Confirm that the providers service has `NEON_DATABASE_URL` configured and that provider requests are reaching the database.

### Provider logs are not appearing in the Worker archive

Check `LOG_UPLOAD_URL`, `LOG_UPLOAD_KEY`, the Worker’s accepted log-upload key, the 5 MiB upload limit, and the provider service’s outbound network access.

### MovieBox integration fails

Confirm that the MovieBox service is self-hosted, reachable over HTTPS, and configured with the matching `MOVIEBOX_API_BASE` and `MOVIEBOX_API_SECRET` values in every layer that uses it.

### Daratech integration fails

Confirm that `DARATECH_API_BASE` points to the Daratech API base and that `DARATECH_API_KEY` is valid. Credentials are obtained from [Daratech Movies API](https://apimovie.runflix.name.ng).

## Version roadmap

### v1.0.0

Stable universal media infrastructure release. This is the current release documented by this README.

### v1.5.0

Planned full accounts-layer release. It will complete the customer account experience and activate the broader commercial model when the required Spün Auth, billing, subscription, quota, and rate-limit integrations are ready.

### v2.0.0 and beyond

Future releases may introduce new content types, new media categories, and additional universal-provider capabilities.

## Important third-party service notice

Spün Media API integrates with external APIs and services. A self-hosted operator is responsible for obtaining and configuring their own credentials, complying with the relevant provider terms, and confirming that their deployment and use are permitted. This repository does not include Spün’s production credentials or grant access to Spün’s hosted services.

For MovieBox integration, deploy your own instance of [MovieBox API by Spün][moviebox-api]. For Daratech access, visit [Daratech Movies API][daratech].

---

[Official Spün Website][official-site] · [Hosted API][hosted-api] · [Public API Docs][api-docs] · [Public Endpoint Inventory][docs/endpoints.md]

[official-site]: https://byspun.xyz
[hosted-api]: https://media.byspun.xyz
[api-docs]: https://media.byspun.xyz/docs
[docs/endpoints.md]: docs/endpoints.md
[moviebox-api]: https://github.com/heisdanny64/spun-moviebox-api
[daratech]: https://apimovie.runflix.name.ng
[cloudflare-workers]: https://workers.cloudflare.com/
[typescript]: https://www.typescriptlang.org/
[nodejs]: https://nodejs.org/
[self-hosting]: #self-hosting
[spn-cli]: #spn-cli
