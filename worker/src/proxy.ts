// worker/src/proxy.ts
// HLS stream proxy — ported from StreamRelay.
// Rewrites M3U8 manifests so all segment/key URLs route back through this proxy.
// Handles: master playlists, media playlists, TS segments, encryption keys.
//
// Usage: GET /proxy?url=<encoded-stream-url>
//   - M3U8 files: rewrite all relative + absolute URLs through proxy
//   - Everything else: stream through with correct headers (Range support)

// ─── Determine if a URL is an M3U8 manifest ──────────────────────────────────

function isM3u8(url: string, contentType: string): boolean {
  const lower = url.toLowerCase().split('?')[0];
  return (
    lower.endsWith('.m3u8') ||
    contentType.includes('mpegurl') ||
    contentType.includes('x-mpegurl')
  );
}

// ─── Resolve a relative URL against a base URL ───────────────────────────────

function resolveUrl(base: string, relative: string): string {
  if (relative.startsWith('http://') || relative.startsWith('https://')) {
    return relative;
  }
  try {
    return new URL(relative, base).toString();
  } catch {
    return relative;
  }
}

// ─── Build a proxied URL ──────────────────────────────────────────────────────

function proxyUrl(requestUrl: URL, targetUrl: string): string {
  const base = `${requestUrl.origin}${requestUrl.pathname}`;
  return `${base}?url=${encodeURIComponent(targetUrl)}`;
}

// ─── Rewrite M3U8 manifest ────────────────────────────────────────────────────
// Walks every line and rewrites:
//   - Media segment URIs (non-comment, non-tag lines)
//   - URI="..." inside EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA tags
//   - Variant stream URIs in master playlists

function rewriteM3u8(body: string, baseUrl: string, requestUrl: URL): string {
  const lines  = body.split('\n');
  const output: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Empty line
    if (!line) { output.push(''); continue; }

    // Tag lines with URI attribute — rewrite URI="..."
    if (line.startsWith('#') && line.includes('URI="')) {
      const rewritten = line.replace(/URI="([^"]+)"/g, (_match, uri) => {
        const absolute = resolveUrl(baseUrl, uri);
        return `URI="${proxyUrl(requestUrl, absolute)}"`;
      });
      output.push(rewritten);
      continue;
    }

    // Pure tag line (no URI) — pass through
    if (line.startsWith('#')) {
      output.push(line);
      continue;
    }

    // Segment / variant URI line — resolve and proxy
    const absolute = resolveUrl(baseUrl, line);
    output.push(proxyUrl(requestUrl, absolute));
  }

  return output.join('\n');
}

// ─── Main proxy handler ───────────────────────────────────────────────────────

export async function proxyHls(request: Request, _env: unknown): Promise<Response> {
  const reqUrl    = new URL(request.url);
  const targetRaw = reqUrl.searchParams.get('url');

  if (!targetRaw) {
    return new Response(
      JSON.stringify({ error: { code: 'MISSING_URL', message: 'Missing url param.' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let targetUrl: string;
  try {
    targetUrl = decodeURIComponent(targetRaw);
    new URL(targetUrl); // validate
  } catch {
    return new Response(
      JSON.stringify({ error: { code: 'INVALID_URL', message: 'Invalid stream URL.' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const targetOrigin = new URL(targetUrl).origin;

  // ── Build upstream request headers ──────────────────────────────────────────
  const upstreamHeaders = new Headers({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer':    targetOrigin + '/',
    'Origin':     targetOrigin,
    'Accept':     '*/*',
  });

  // Forward Range header for seeking
  const rangeHeader = request.headers.get('Range');
  if (rangeHeader) upstreamHeaders.set('Range', rangeHeader);

  // ── Fetch from upstream ──────────────────────────────────────────────────────
  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(targetUrl, {
      headers: upstreamHeaders,
      redirect: 'follow',
    });
  } catch {
    return new Response(
      JSON.stringify({ error: { code: 'FETCH_ERROR', message: 'Failed to fetch stream.' } }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!upstreamRes.ok && upstreamRes.status !== 206) {
    return new Response(null, { status: upstreamRes.status });
  }

  const contentType = upstreamRes.headers.get('Content-Type') ?? '';

  // ── CORS + passthrough headers ───────────────────────────────────────────────
  const responseHeaders = new Headers({
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
  });

  // Forward relevant upstream headers
  for (const h of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']) {
    const val = upstreamRes.headers.get(h);
    if (val) responseHeaders.set(h, val);
  }

  // ── M3U8: rewrite and return ─────────────────────────────────────────────────
  if (isM3u8(targetUrl, contentType)) {
    const body      = await upstreamRes.text();
    const rewritten = rewriteM3u8(body, targetUrl, reqUrl);

    responseHeaders.set('Content-Type',  'application/vnd.apple.mpegurl');
    responseHeaders.set('Cache-Control', 'no-cache, no-store');

    return new Response(rewritten, {
      status:  200,
      headers: responseHeaders,
    });
  }

  // ── Everything else: stream through ──────────────────────────────────────────
  responseHeaders.set('Cache-Control', 'public, max-age=3600');

  return new Response(upstreamRes.body, {
    status:  upstreamRes.status,
    headers: responseHeaders,
  });
}
