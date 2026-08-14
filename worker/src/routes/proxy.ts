// worker/src/routes/proxy.ts
// Black Box media proxy routes. Upstream URLs are accepted only inside encrypted,
// expiring capability tokens created by the relevant public API route.

import { Hono } from 'hono';
import { unzipSync } from 'fflate';
import type { Env } from '../types/env.js';
import { errorResponse } from '../normalizer.js';
import { readSubtitleProxyToken } from '../proxy-token.js';
import { srtToVtt } from '../utils/srtToVtt.js';
import { proxyHls } from '../proxy.js';

const proxy = new Hono<{ Bindings: Env }>();

const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 20;
const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;
const ALLOWED_SUBTITLE_HOSTS = ['subdl.com', 'dl.subdl.com'];

function isAllowedSubtitleUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === 'https:' &&
      ALLOWED_SUBTITLE_HOSTS.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    );
  } catch {
    return false;
  }
}

async function fetchArchive(url: string): Promise<Uint8Array | null> {
  if (!isAllowedSubtitleUrl(url)) return null;

  try {
    const response = await fetch(url, { redirect: 'manual' });
    if (!response.ok || !response.body) return null;

    const declaredLength = response.headers.get('Content-Length');
    if (declaredLength && Number(declaredLength) > MAX_ARCHIVE_BYTES) return null;

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > MAX_ARCHIVE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }

    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return output;
  } catch {
    return null;
  }
}

function extractSubtitleFile(
  archiveBytes: Uint8Array,
  languageCode: string,
): Uint8Array | null {
  let entryCount = 0;
  let declaredSubtitleBytes = 0;
  let invalidArchive = false;

  try {
    const archive = unzipSync(archiveBytes, {
      filter: (file) => {
        entryCount++;
        const name = file.name.replace(/\\/g, '/');
        const unsafeName = name.startsWith('/') || name.split('/').includes('..');

        if (
          entryCount > MAX_ARCHIVE_ENTRIES ||
          unsafeName ||
          !Number.isSafeInteger(file.originalSize) ||
          file.originalSize < 1
        ) {
          invalidArchive = true;
          return false;
        }

        if (!name.toLowerCase().endsWith('.srt')) return false;
        if (file.originalSize > MAX_SUBTITLE_BYTES) {
          invalidArchive = true;
          return false;
        }

        declaredSubtitleBytes += file.originalSize;
        if (declaredSubtitleBytes > MAX_SUBTITLE_BYTES) {
          invalidArchive = true;
          return false;
        }

        return true;
      },
    });

    if (invalidArchive || entryCount === 0) return null;

    const entries = Object.entries(archive).filter(([, bytes]) => (
      bytes.byteLength > 0 && bytes.byteLength <= MAX_SUBTITLE_BYTES
    ));
    if (entries.length === 0) return null;

    const normalizedLanguage = languageCode.toLowerCase();
    const preferred = entries.find(([name]) =>
      name.toLowerCase().includes(normalizedLanguage),
    );

    return (preferred ?? entries[0])[1];
  } catch {
    return null;
  }
}

function decodeSubtitle(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }

  return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
}

// GET /v1/proxy/stream?url=<encoded-stream-url>
// Canonical HLS proxy route. Existing MP4/DASH playback remains direct.
proxy.get('/stream', async (c) => proxyHls(c.req.raw, c.env));

// GET /v1/proxy/subtitles?t=<encrypted-token>
// Browser-playable endpoint. It never accepts raw archive URLs.
proxy.get('/subtitles', async (c) => {
  const token = c.req.query('t');
  if (!token) return errorResponse('BAD_REQUEST', 'Missing subtitle reference.', 400);

  const payload = await readSubtitleProxyToken(c.env.SUBTITLE_PROXY_TOKEN_SECRET, token);
  if (!payload) return errorResponse('SECURE_LINK_ERROR', 'Invalid subtitle reference.', 403);

  const archiveBytes = await fetchArchive(payload.archive_url);
  if (!archiveBytes) return errorResponse('SERVICE_OFFLINE', 'Subtitle track unavailable.', 502);

  const subtitleBytes = extractSubtitleFile(archiveBytes, payload.language_code);
  if (!subtitleBytes) return errorResponse('CONTENT_UNAVAILABLE', 'No playable subtitle track found.', 422);

  const srt = decodeSubtitle(subtitleBytes);
  const vtt = srtToVtt(srt);
  if (!vtt.includes('-->')) {
    return errorResponse('CONTENT_UNAVAILABLE', 'Subtitle track could not be prepared.', 422);
  }

  return new Response(vtt, {
    status: 200,
    headers: {
      'Content-Type': 'text/vtt; charset=utf-8',
      'Cache-Control': 'private, max-age=900',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

export default proxy;
