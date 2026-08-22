# Spün Media API v1 Public Endpoints

This file is a quick source-code inventory of the public Spün Media API v1 routes. It lists methods, paths, required values, optional parameters, and authentication requirements without duplicating public response formats.

For live testing, complete request/response examples, and public response documentation, visit [API Documentation][api-docs].

The hosted Spün API base URL is `https://media.byspun.xyz/v1`. For a self-hosted installation, replace it with the URL of your own metadata Worker.

## Authentication legend

| Label | Requirement |
|---|---|
| `None` | No authentication header is required. |
| `X-User-Key` | Send a valid `X-User-Key: spn_...` header. |
| `X-User-Key` / `X-Admin-Key` | Consumers may use a user key; the operator may use the admin key for private testing. |

Health remains unauthenticated. Administrative and internal routes are documented in the root [README](../README.md), not in this public inventory.

## Health and utility

| Method | Endpoint | Required values | Optional query parameters | Auth |
|---|---|---|---|---|
| `GET` | `/v1/utility/health` | None | None | `None` |
| `GET` | `/v1/utility/resolve` | None | None | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/utility/resolve/:namespace` | `namespace` | `id` required; `type` optional | `X-User-Key` / `X-Admin-Key` |

The resolver `namespace` must be one of the namespaces advertised by the API. The `id` query parameter is required for a namespace resolution request, while `type` may be supplied when the identifier needs a content-type constraint.

## Search

| Method | Endpoint | Required values | Optional query parameters | Auth |
|---|---|---|---|---|
| `GET` | `/v1/search` | `q` | `page`, `type=all\|movie\|tv\|anime` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/search/suggestions` | `q` | None | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/search/movie` | `q` | `page` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/search/tv` | `q` | `page` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/search/anime` | `q` | `page` | `X-User-Key` / `X-Admin-Key` |

`q` is the search text. The CLI and clients should URL-encode spaces and punctuation when constructing the request.

## Metadata and information

| Method | Endpoint | Required values | Optional query parameters | Auth |
|---|---|---|---|---|
| `GET` | `/v1/info/:spunId` | `spunId` | None | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/info/:spunId/episodes` | `spunId` | `season` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/info/:spunId/cast` | `spunId` | None | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/info/:spunId/related` | `spunId` | None | `X-User-Key` / `X-Admin-Key` |

## Discovery

| Method | Endpoint | Required values | Optional query parameters | Auth |
|---|---|---|---|---|
| `GET` | `/v1/discover/trending` | None | `type=all\|movie\|tv\|anime`, `page` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/discover/popular` | None | `type=all\|movie\|tv\|anime`, `page` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/discover/new` | None | `type=all\|movie\|tv\|anime`, `page` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/discover/genres` | None | `type=movie\|tv\|anime` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/discover/studios` | None | `category` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/discover/studio/:studioId` | `studioId` | `page` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/discover/:type` | `type=movie\|tv\|anime` | `genre`, `studio`, `page` | `X-User-Key` / `X-Admin-Key` |

For the generic discovery route, `genre` and `studio` are optional filters. `page` must be a positive integer.

## Anime catalogue

| Method | Endpoint | Required values | Optional query parameters | Auth |
|---|---|---|---|---|
| `GET` | `/v1/anime/seasons` | None | `page` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/anime/seasons/:year/:season` | `year`, `season` | `page` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/anime/schedule` | None | None | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/anime/rankings/alltime` | None | `page` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/anime/rankings/popular` | None | `page` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/anime/rankings/season/:year/:season` | `year`, `season` | `page` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/anime/rankings/genre/:genre` | `genre` | `page` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/anime/airing` | None | `page` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/anime/upcoming` | None | `page` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/anime/format/:format` | `format` | `page` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/anime/demographic/:demographic` | `demographic` | `page` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/anime/source/:source` | `source` | `page` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/anime/genre/:genre` | `genre` | `page` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/anime/studios` | None | `q`, `page` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/anime/studio/:studioId` | `studioId` | `page` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/anime/:spunId/themes` | `spunId` | None | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/anime/:spunId/fillers` | `spunId` | `page` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/anime/:spunId/franchise` | `spunId` | None | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/anime/:spunId/characters` | `spunId` | None | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/anime/:spunId/related` | `spunId` | None; redirects to the related metadata route | `X-User-Key` / `X-Admin-Key` |

`year` must be a supported four-digit year, `season` is the supported season name, `studioId` is numeric, and `page` must be positive.

## Similar content

| Method | Endpoint | Required values | Optional query parameters | Auth |
|---|---|---|---|---|
| `GET` | `/v1/similar/movie/:spunId` | `spunId` | None | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/similar/tv/:spunId` | `spunId` | None | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/similar/anime/:spunId` | `spunId` | None | `X-User-Key` / `X-Admin-Key` |

## Streaming

| Method | Endpoint | Required values | Optional query parameters | Auth |
|---|---|---|---|---|
| `GET` | `/v1/stream/:type/:spunId/:season/:episode` | `type`, `spunId`, `season`, `episode` | `quality`, `audio` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/stream/anime/:spunId/:episode` | `spunId`, `episode`; season defaults to `1` | `quality`, `audio` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/stream/:type/:spunId` | `type`, `spunId` | `season`, `episode`, `quality`, `audio` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/stream/:spunId` | `spunId`; type inferred from the catalogue | `season`, `episode`, `quality`, `audio` | `X-User-Key` / `X-Admin-Key` |

Supported `type` values are `movie`, `tv`, and `anime`. TV and anime requests require valid episode references according to the route form. Stream URLs may be direct supported media URLs or opaque proxy URLs depending on the media format and upstream requirements.

## Downloads

| Method | Endpoint | Required values | Optional query parameters | Auth |
|---|---|---|---|---|
| `GET` | `/v1/download/:type/:spunId/:season/:episode` | `type`, `spunId`, `season`, `episode` | `quality`, `lang` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/download/anime/:spunId/:episode` | `spunId`, `episode`; season defaults to `1` | `quality`, `lang` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/download/:type/:spunId` | `type`, `spunId` | `season`, `episode`, `quality`, `lang` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/download/:spunId` | `spunId`; type inferred from the catalogue | `season`, `episode`, `quality`, `lang` | `X-User-Key` / `X-Admin-Key` |

When no season or episode is supplied for TV or anime, the endpoint returns its batch form. Download responses include downloadable subtitle information when available.

## Subtitles

| Method | Endpoint | Required values | Optional query parameters | Auth |
|---|---|---|---|---|
| `GET` | `/v1/subtitles/:spunId` | `spunId` | `season`, `episode`, `lang` | `X-User-Key` / `X-Admin-Key` |

The normal subtitle endpoint returns ready-to-use subtitle proxy URLs. Download responses may contain downloadable subtitle URLs separately.

## Resolver

| Method | Endpoint | Required values | Optional query parameters | Auth |
|---|---|---|---|---|
| `GET` | `/v1/utility/resolve` | None | None | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/utility/resolve/:namespace` | `namespace`, `id` | `type` | `X-User-Key` / `X-Admin-Key` |

The supported namespace list is returned by `/v1/utility/resolve`. The resolver may support namespaces such as TMDB, IMDb, TVDB, AniList, MAL, Kitsu, and MovieBox according to the current deployment configuration.

## Homepages

| Method | Endpoint | Required values | Optional query parameters | Auth |
|---|---|---|---|---|
| `GET` | `/v1/home` | None | None | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/home/movie` | None | None | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/home/tv` | None | None | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/home/anime` | None | None | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/home/status` | None | None | `X-User-Key` / `X-Admin-Key` |

The homepage status route reports the state of the `all`, `movie`, `tv`, and `anime` homepage builds.

## Franchises

| Method | Endpoint | Required values | Optional query parameters | Auth |
|---|---|---|---|---|
| `GET` | `/v1/franchise` | None | None | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/franchise/:reference` | `reference` | None | `X-User-Key` / `X-Admin-Key` |

## Proxy routes

| Method | Endpoint | Required values | Optional query parameters | Auth |
|---|---|---|---|---|
| `GET` | `/v1/proxy/stream` | Query token `t` | None | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/proxy/subtitles` | Query token `t` | None | `X-User-Key` / `X-Admin-Key` |

Proxy tokens are opaque, signed, and expiring references generated by the API. Do not construct them manually or expose upstream credentials in client code.

## Flat convenience aliases

These aliases redirect with HTTP `307` to the canonical route. Clients should follow redirects; the `spn` CLI follows them automatically.

| Method | Alias | Redirect target | Optional query parameters | Auth |
|---|---|---|---|---|
| `GET` | `/v1/health` | `/v1/utility/health` | None | `None` |
| `GET` | `/v1/resolve` | `/v1/utility/resolve` | None | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/resolve/:namespace` | `/v1/utility/resolve/:namespace` | `id`, `type` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/trending` | `/v1/discover/trending` | `type`, `page` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/popular` | `/v1/discover/popular` | `type`, `page` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/new` | `/v1/discover/new` | `type`, `page` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/genres` | `/v1/discover/genres` | `type` | `X-User-Key` / `X-Admin-Key` |
| `GET` | `/v1/studios` | `/v1/discover/studios` | `category` | `X-User-Key` / `X-Admin-Key` |

## Shared validation rules

| Value | Rule |
|---|---|
| `page` | Positive integer. |
| `season` | Positive supported season number where the route requires it. |
| `episode` | Positive supported episode number where the route requires it. |
| `year` | Four-digit supported year, normally between 1900 and 2100. |
| `type` | `movie`, `tv`, or `anime`, unless an endpoint explicitly permits `all`. |
| `spunId` | Canonical Spün identifier returned by search, discovery, resolve, or metadata routes. |
| `q` | Non-empty search text; punctuation and spaces are supported. |

## Error codes

API errors use the standard envelope documented on the live documentation site:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "error": "Human-readable error",
    "description": "Why the error occurred",
    "action": "What the caller should do"
  }
}
```

The following table contains all **95 codes** in the canonical shared error registry.

### General request and service errors

| Code | Meaning or occurrence |
|---|---|
| `BAD_REQUEST` | The request is malformed, incomplete, or contains invalid fields. |
| `NOT_FOUND` | The requested resource or route-associated resource does not exist. |
| `ROUTE_NOT_FOUND` | The requested API endpoint does not exist. |
| `METHOD_NOT_ALLOWED` | The HTTP method is not supported by the endpoint. |
| `MISSING_QUERY` | A required search or diagnostic query value was not supplied. |
| `INVALID_ID` | A supplied Spün ID does not exist in the catalogue. |
| `INVALID_TYPE` | The requested content type is unsupported for the operation. |
| `INVALID_GENRE` | The supplied genre is not available for the operation. |
| `INVALID_STUDIO` | The supplied studio or network is not available. |
| `INVALID_YEAR` | The supplied year is not a valid supported year. |
| `INVALID_SEASON` | The supplied season value is not valid for the endpoint. |
| `INVALID_EPISODE` | The season or episode reference is not a valid positive integer. |
| `UNSUPPORTED_SUBJECT_TYPE` | A subject type other than the supported movie or TV subject types was supplied. |
| `UPSTREAM_ERROR` | A required upstream metadata or content request failed. |
| `SERVICE_OFFLINE` | A required Spün infrastructure component is unreachable or unconfigured. |
| `GATEWAY_TIMEOUT` | The gateway took too long to process a request. |
| `INTERNAL_ERROR` | An unexpected internal failure occurred. |
| `MAINTENANCE` | The API is undergoing scheduled maintenance. |
| `REGION_RESTRICTED` | The requested content is unavailable from the caller’s region. |

### Media and source errors

| Code | Meaning or occurrence |
|---|---|
| `CONTENT_UNAVAILABLE` | No active playable source was found for the title. |
| `STREAMS_UNAVAILABLE` | No usable stream was found after available stream fallbacks. |
| `DOWNLOADS_UNAVAILABLE` | No usable download was found after available download fallbacks. |
| `EPISODE_UNAVAILABLE` | The requested season and episode have no usable source. |
| `QUALITY_UNAVAILABLE` | The requested media quality is not available. |
| `AUDIO_UNAVAILABLE` | The requested audio or language option is not available. |
| `SOURCE_RESPONSE_INVALID` | A source responded with data that could not be normalized for playback. |
| `SOURCE_TIMEOUT` | A source took too long to respond. |
| `SOURCE_ACCESS_DENIED` | A source rejected the access needed to prepare the result. |
| `DOWNLOAD_LINK_INVALID` | A returned download link failed safety or validity checks. |
| `SECURE_LINK_ERROR` | Content was found but a secure source handshake failed. |
| `MAPPING_NOT_FOUND` | No compatible content mapping was found. |
| `MAPPING_AMBIGUOUS` | Multiple possible mappings matched and safe selection was impossible. |
| `MAPPING_TYPE_MISMATCH` | A mapping belongs to a different content type than requested. |

### Proxy errors

| Code | Meaning or occurrence |
|---|---|
| `PROXY_TOKEN_INVALID` | The supplied stream or subtitle proxy reference is invalid. |
| `PROXY_TOKEN_EXPIRED` | The proxy reference has expired. |
| `PROXY_UPSTREAM_UNAVAILABLE` | The approved media source could not be reached by the proxy. |
| `PROXY_UPSTREAM_NOT_ALLOWED` | The upstream URL failed proxy safety validation. |
| `PROXY_FORMAT_UNSUPPORTED` | The requested media format cannot be handled by the proxy. |
| `PROXY_MANIFEST_TOO_LARGE` | An HLS manifest exceeds the proxy’s size limits. |
| `PROXY_MANIFEST_UNSUPPORTED` | An HLS manifest cannot be safely rewritten for proxy delivery. |

### Subtitle errors

| Code | Meaning or occurrence |
|---|---|
| `SUBTITLE_UNAVAILABLE` | A subtitle archive could not be retrieved. |
| `SUBTITLE_ARCHIVE_INVALID` | The retrieved archive is corrupt or unsupported. |
| `SUBTITLE_TRACK_NOT_FOUND` | The archive contains no usable track for the requested language. |
| `SUBTITLE_CONVERSION_FAILED` | A subtitle track could not be converted to the required format. |

### Resolver errors

| Code | Meaning or occurrence |
|---|---|
| `RESOLVE_NAMESPACE_UNSUPPORTED` | The requested identifier namespace is not supported. |
| `RESOLVE_IDENTIFIER_REQUIRED` | No identifier was supplied for resolution. |
| `RESOLVE_IDENTIFIER_INVALID` | The identifier is malformed for its namespace. |
| `RESOLVE_NAMESPACE_TYPE_MISMATCH` | The resolved title does not match the requested content type. |
| `RESOLVE_CONTENT_NOT_FOUND` | The identifier was processed but no matching title was found. |
| `RESOLVE_AMBIGUOUS` | Multiple possible titles matched the identifier. |
| `RESOLVE_METADATA_UNAVAILABLE` | Metadata required for resolution is temporarily unavailable. |
| `RESOLVE_METADATA_TIMEOUT` | Metadata resolution exceeded its time limit. |
| `RESOLVE_REGISTRATION_FAILED` | The title was found but could not be registered in the Spün catalogue. |
| `RESOLVE_CONFLICT` | Another catalogue operation conflicted with the resolution request. |
| `RESOLVE_UNSUPPORTED_RESULT` | The resolved metadata cannot be normalized into the supported model. |

### Authentication and account errors

| Code | Meaning or occurrence |
|---|---|
| `UNAUTHORIZED` | Authentication is missing or invalid for the requested operation. |
| `FORBIDDEN` | The caller is authenticated but lacks permission for the operation. |
| `MULTIPLE_AUTH_METHODS` | Mutually exclusive public credentials were supplied together. |
| `USER_KEY_REQUIRED` | A protected public route requires `X-User-Key`. |
| `INVALID_USER_KEY` | The supplied user key is not recognized. |
| `USER_KEY_REVOKED` | The supplied user key was permanently revoked. |
| `USER_KEY_EXPIRED` | The supplied user key passed its expiry time. |
| `ADMIN_KEY_REQUIRED` | An administrative route requires `X-Admin-Key`. |
| `INVALID_ADMIN_KEY` | The supplied administrator key is missing or invalid. |
| `INVALID_INTERNAL_KEY` | The trusted internal credential is missing or invalid. |
| `USER_AUTH_REQUIRED` | A customer account operation requires a Spün Auth session. |
| `FORBIDDEN_ACCOUNT_ACCESS` | The authenticated caller cannot access the requested account. |
| `ACCOUNT_NOT_FOUND` | The requested account does not exist. |
| `ACCOUNT_ID_INVALID` | The supplied account UUID is invalid. |
| `ACCOUNT_INACTIVE` | The account is not active. |
| `ACCOUNT_ALREADY_CLOSED` | The account has been closed and cannot perform the operation. |
| `AUTH_SUBJECT_REQUIRED` | An account operation lacks its stable authentication subject. |
| `ACCOUNT_EMAIL_INVALID` | The supplied account email does not pass validation. |
| `ACCOUNT_CONFLICT` | The identity could not be linked safely to one account. |
| `ACCOUNT_SYNC_FAILED` | Account synchronization could not create or update the record. |

### API-key and account-management errors

| Code | Meaning or occurrence |
|---|---|
| `ACCOUNT_REQUIRED` | An owning account is required before key creation. |
| `API_KEY_NOT_FOUND` | The requested API-key record does not exist or is not visible. |
| `LABEL_REQUIRED` | An API-key label was not provided. |
| `INVALID_KEY_LABEL` | The key label is empty or exceeds the allowed length. |
| `INVALID_KEY_EXPIRY` | The expiry is malformed or is not in the future. |
| `KEY_ALREADY_REVOKED` | The key is already permanently revoked. |
| `INVALID_REVOCATION_REASON` | A non-empty valid revocation reason is required. |
| `API_KEY_LIMIT_REACHED` | The account has reached its plan-based active-key limit. |
| `INVALID_STATUS_FILTER` | A key-list status filter is not `active` or `revoked`. |
| `INVALID_PAGINATION` | The page or limit is outside the permitted range. |
| `PAYLOAD_TOO_LARGE` | A request body exceeds the endpoint’s maximum accepted size. |

### Subscription, plan, quota, and rate-limit errors

| Code | Meaning or occurrence |
|---|---|
| `SUBSCRIPTION_REQUIRED` | The account has no usable subscription for the operation. |
| `SUBSCRIPTION_NOT_ACTIVE` | The account subscription does not currently permit the operation. |
| `SUBSCRIPTION_EXPIRED` | The account entitlement period has ended. |
| `PLAN_NOT_FOUND` | The referenced account plan cannot be found. |
| `PLAN_NOT_AVAILABLE` | The requested plan is not available for new entitlement. |
| `QUOTA_EXCEEDED` | The account has consumed its allowance for the usage category. |
| `RATE_LIMIT` | A short-window request allowance was exceeded. |
| `RATE_LIMITED` | The account exceeded its configured request rate. |

The plan, subscription, quota, and rate-limit codes are part of the v1 error registry and account-layer groundwork. Commercial enforcement remains disabled by default in v1 until the corresponding v1.5.0 functionality is enabled and configured.

## Documentation links

[← Back to README][readme] · [Open live API documentation][api-docs]

[api-docs]: https://media.byspun.xyz/docs
[readme]: ../README.md
