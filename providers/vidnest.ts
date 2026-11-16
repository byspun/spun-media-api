// VidNest movie/TV provider — direct HLS + MKV streams via AES-GCM encrypted API.
// Upstream: new.vidnest.fun (5 server paths: ophim, yflix, rogflix, onehd, vidzee).
// Each request carries a random nonce (_n); responses are AES-256-GCM encrypted
// ({ v: 2, d: base64, n: nonce }) with a key derived from SHA-256(nonce|secret).
// Some servers wrap direct HLS in a Cloudflare-Worker proxy with a base64 inner
// URL (/hls/{b64}/master.m3u8), which we unwrap back to the origin stream.
// Ported faithfully from ultrasrc src/providers/movies/vidnest.ts.

import { attachSubtitles } from './internal/normalizer.js';
import { detectFormat, isSafeHttpUrl, normalizeQuality, uniqueBy } from './internal/utils.js';
import type { MovieProviderInput, TvProviderInput, RawStream, RawSubtitle } from './internal/types.js';

const API_BASE = 'https://new.vidnest.fun';
const BASE_URL = 'https://vidnest.fun';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// VidNest uses this fixed secret for AES-GCM key derivation — it ships in the
// public player bundle and is required to decrypt every server response.
const VIDNEST_SECRET = 'K3p8vQ2mX9rL5wZ0fN7bG1sH4tJ6dC9_y8S3wM1nQ5pL2';

const SERVERS = [
  { id: 'ophim', name: 'Lamda', path: 'ophim' },
  { id: 'yflix', name: 'Catflix', path: 'yflix' },
  { id: 'rogflix', name: 'Filxer', path: 'rogflix' },
  { id: 'onehd', name: 'Alfa', path: 'onehd' },
  { id: 'vidzee', name: 'Gama', path: 'vidzee' },
] as const;

// Fallback hosts for server responses that return only a relative path.
const WORKER_FALLBACKS = [
  'https://long-night-d802.streamed-5.workers.dev',
  'https://blue-bush-5977.streamed-7.workers.dev',
  'https://rapid-heart-03c8.streamed-4.workers.dev',
  'https://super-flower-9c85.streamed-2.workers.dev',
  'https://flat-sky-cf20.streamed-850.workers.dev',
  'https://vidrift-cf.streamed-8.workers.dev',
];

/** Appends a fresh base64url nonce to a VidNest API URL. */
function withNonce(url: string): { url: string; nonce: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  const nonce = btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sep = url.includes('?') ? '&' : '?';
  return { url: `${url}${sep}_n=${encodeURIComponent(nonce)}`, nonce };
}

/** Decrypts an AES-256-GCM VidNest payload. Returns the parsed JSON, or null on failure. */
async function decryptPayload(dataB64: string, nonce: string): Promise<any> {
  try {
    const enc = new TextEncoder().encode(`${nonce}|${VIDNEST_SECRET}`);
    const hash = await crypto.subtle.digest('SHA-256', enc);
    const key = await crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['decrypt']);

    let b64 = dataB64.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    const iv = bytes.slice(0, 12);
    const ciphertext = bytes.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    const text = new TextDecoder().decode(decrypted);
    try { return JSON.parse(text); } catch { return text; }
  } catch {
    return null;
  }
}

/**
 * Unwraps a worker-proxied HLS URL back to the origin stream. VidNest's own
 * workers wrap direct streams as /hls/{base64(JSON{u: origin})}/master.m3u8.
 */
function unwrapWorkerUrl(url: string): string {
  const m = /\/hls\/([a-zA-Z0-9_\-\+\/=]+)\/master\.m3u8/i.exec(url);
  if (m) {
    try {
      let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4 !== 0) b64 += '=';
      const parsed = JSON.parse(atob(b64));
      if (parsed?.u && /^https?:\/\//i.test(parsed.u)) return parsed.u;
    } catch { /* keep original */ }
  }
  return url;
}

/** Maps a server response to absolute stream URLs (relative paths get a fallback worker host). */
function collectServerUrls(rawUrl: string, qualityHint?: string): { url: string; quality?: string }[] {
  const out: { url: string; quality?: string }[] = [];
  const push = (u: string, q?: string) => {
    let streamUrl = unwrapWorkerUrl(u);
    if (streamUrl.startsWith('/')) {
      const host = WORKER_FALLBACKS[Math.floor(Math.random() * WORKER_FALLBACKS.length)];
      streamUrl = `${host}${streamUrl}`;
    }
    if (!isSafeHttpUrl(streamUrl)) return;
    out.push({ url: streamUrl, quality: q });
  };

  // Case A: direct url (e.g. yflix, rogflix, flixhq)
  if (typeof rawUrl === 'string' && rawUrl.length > 0) {
    push(rawUrl, qualityHint ?? '1080p');
  }
  return out;
}

function isTvInput(input: MovieProviderInput | TvProviderInput): input is TvProviderInput {
  return 'season' in input && 'episode' in input;
}

/** Fetches + decrypts one VidNest server response. */
async function fetchServer(
  serverPath: string,
  tmdbId: number,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number,
): Promise<any | null> {
  try {
    const endpoint = type === 'tv'
      ? `${serverPath}/tv/${tmdbId}/${season}/${episode}`
      : `${serverPath}/movie/${tmdbId}`;
    const { url: signedUrl, nonce } = withNonce(`${API_BASE}/${endpoint}`);

    const res = await fetch(signedUrl, {
      headers: {
        'User-Agent': UA,
        Referer: `${BASE_URL}/`,
        Origin: BASE_URL,
        Accept: 'application/json, text/plain, */*',
      },
      signal: AbortSignal.timeout(9_000),
    });
    if (!res.ok) return null;

    const json = await res.json() as any;
    // Encrypted response: { v: 2, d: base64, n: nonce }
    if (json && json.v === 2 && json.d && json.n) {
      return await decryptPayload(json.d, json.n);
    }
    return json;
  } catch {
    return null;
  }
}

/** Fetches external subtitles when a server payload carries none. */
async function fetchExternalSubtitles(
  tmdbId: number,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number,
): Promise<RawSubtitle[]> {
  const subtitles: RawSubtitle[] = [];

  // 1. Try Wyzie subtitles
  try {
    let url = `https://sub.wyzie.io/search?id=${tmdbId}&key=wyzie-bdc33980f1590134693cda293930eade`;
    if (type === 'tv' && season != null && episode != null) url += `&season=${season}&episode=${episode}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(4_000),
    });
    if (res.ok) {
      const items = await res.json() as Array<{ url?: string; display?: string; language?: string }>;
      if (Array.isArray(items)) {
        for (const item of items) {
          const subUrl = item.url;
          if (!subUrl || !isSafeHttpUrl(subUrl)) continue;
          subtitles.push({
            url: subUrl,
            language: item.display || item.language || 'English',
            language_code: String(item.language || 'en').slice(0, 2).toLowerCase(),
            format: 'vtt',
            provider: 'vidnest',
          });
        }
      }
    }
  } catch { /* non-critical */ }

  // 2. Fallback to VDRK subtitles
  if (subtitles.length === 0) {
    try {
      const url = type === 'tv'
        ? `https://sub.vdrk.site/v2/tv/${tmdbId}/${season}/${episode}`
        : `https://sub.vdrk.site/v2/movie/${tmdbId}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(4_000),
      });
      if (res.ok) {
        const items = await res.json() as Array<{ file?: string; url?: string; label?: string; language?: string }>;
        if (Array.isArray(items)) {
          for (const item of items) {
            const subUrl = item.file || item.url;
            if (!subUrl || !isSafeHttpUrl(subUrl)) continue;
            subtitles.push({
              url: subUrl,
              language: item.label || item.language || 'English',
              language_code: String(item.language || 'en').slice(0, 2).toLowerCase(),
              format: /\.srt($|[?#])/i.test(subUrl) ? 'srt' : 'vtt',
              provider: 'vidnest',
            });
          }
        }
      }
    } catch { /* non-critical */ }
  }

  return uniqueBy(subtitles, s => s.url);
}

export async function getVidnestStreams(input: MovieProviderInput | TvProviderInput): Promise<RawStream[]> {
  try {
    const isTv = isTvInput(input);
    const type = isTv ? 'tv' : 'movie';

    if (!input.tmdb_id) return [];

    // Query all servers in parallel
    const results = await Promise.allSettled(
      SERVERS.map(s => fetchServer(
        s.path, input.tmdb_id, type,
        isTv ? input.season : undefined,
        isTv ? input.episode : undefined,
      )),
    );

    const streams: RawStream[] = [];
    const subtitles: RawSubtitle[] = [];
    const seenUrls = new Set<string>();
    const seenSubUrls = new Set<string>();

    for (const r of results) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      const data = r.value;

      // Case A: data.url is a direct stream URL
      if (typeof data.url === 'string' && data.url.length > 0) {
        for (const src of collectServerUrls(data.url, data.quality)) {
          if (seenUrls.has(src.url)) continue;
          seenUrls.add(src.url);
          const format = detectFormat(src.url, data.type === 'mp4' ? 'mp4' : undefined);
          if (format === 'unknown') continue;
          streams.push({
            url: src.url,
            format,
            quality: normalizeQuality(src.quality),
            audio: 'Original',
            provider: 'vidnest',
            headers: { 'User-Agent': UA, Referer: `${BASE_URL}/`, Origin: BASE_URL },
          });
        }
      }

      // Case B: data.streams array (e.g. ophim, vidzee, onehd)
      if (Array.isArray(data.streams)) {
        for (const st of data.streams) {
          const streamUrl = st?.url ?? st?.file;
          if (typeof streamUrl !== 'string' || !streamUrl) continue;
          if (seenUrls.has(streamUrl)) continue;
          seenUrls.add(streamUrl);

          const finalUrl = isSafeHttpUrl(streamUrl) ? unwrapWorkerUrl(streamUrl) : streamUrl;
          if (streamUrl.startsWith('/')) {
            const host = WORKER_FALLBACKS[Math.floor(Math.random() * WORKER_FALLBACKS.length)];
            if (!isSafeHttpUrl(finalUrl)) continue;
            streams.push({
              url: unwrapWorkerUrl(`${host}${streamUrl}`),
              format: detectFormat(finalUrl, st?.type) as RawStream['format'],
              quality: normalizeQuality(st?.quality ?? st?.label ?? 'auto'),
              audio: 'Original',
              provider: 'vidnest',
              headers: { 'User-Agent': UA, Referer: `${BASE_URL}/`, Origin: BASE_URL },
            });
            continue;
          }
          if (!isSafeHttpUrl(finalUrl)) continue;
          const format = detectFormat(finalUrl, st?.type);
          if (format === 'unknown') continue;
          streams.push({
            url: finalUrl,
            format,
            quality: normalizeQuality(st?.quality ?? st?.label ?? 'auto'),
            audio: 'Original',
            provider: 'vidnest',
            headers: { 'User-Agent': UA, Referer: `${BASE_URL}/`, Origin: BASE_URL },
          });
        }
      }

      // Subtitles embedded in the server payload
      if (Array.isArray(data.subtitles)) {
        for (const sub of data.subtitles) {
          const subUrl = sub?.url ?? sub?.file;
          if (typeof subUrl !== 'string' || !isSafeHttpUrl(subUrl)) continue;
          if (seenSubUrls.has(subUrl)) continue;
          seenSubUrls.add(subUrl);
          subtitles.push({
            url: subUrl,
            language: sub?.label ?? sub?.lang ?? 'English',
            language_code: String(sub?.lang ?? 'en').slice(0, 2).toLowerCase(),
            format: /\.srt($|[?#])/i.test(subUrl) ? 'srt' : 'vtt',
            provider: 'vidnest',
          });
        }
      }
    }

    // Fetch external subtitles only when no server attached any
    let allSubs = subtitles;
    if (allSubs.length === 0) {
      allSubs = await fetchExternalSubtitles(input.tmdb_id, type, isTv ? input.season : undefined, isTv ? input.episode : undefined);
    }

    return attachSubtitles(uniqueBy(streams, s => `${s.url}:${s.quality}`), allSubs);
  } catch (error) {
    console.error(`VidNest error: ${String(error)}`);
    return [];
  }
}
