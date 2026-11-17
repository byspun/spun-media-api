// MegaPlay / RapidCloud embed extractor.
// Resolves megaplay.buzz embed URLs to master.m3u8 playlists + subtitle tracks.
// Payloads may arrive AES-256-CBC encrypted (`enc` field), decrypted with the
// static key/IV the host's player uses.
// Ported from ultrasrc src/extractors/megaplay.ts.

import crypto from 'node:crypto';

const KEY_STR = 'i?LMTAx0Q6,:}50U';
const IV_STR = "W0;27ToaUpl_P%'c";
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';

export interface MegaPlayTrack {
  file: string;
  label?: string;
  language?: string;
  kind?: string;
}

export interface MegaPlayResult {
  fileUrl: string;
  tracks: MegaPlayTrack[];
  headers: Record<string, string>;
  intro?: { start: number; end: number };
  outro?: { start: number; end: number };
}

function padKey(str: string, len: number): Uint8Array {
  const enc = new TextEncoder().encode(str);
  const out = new Uint8Array(len);
  out.set(enc.subarray(0, Math.min(len, enc.length)));
  return out;
}

function b64urlDecode(str: string): Buffer {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad) s += '===='.slice(pad);
  return Buffer.from(s, 'base64');
}

export function decryptMegaPlay(enc: string): { file: string } {
  const key = Buffer.from(padKey(KEY_STR, 32));
  const iv = Buffer.from(padKey(IV_STR, 16));
  const ciphertext = b64urlDecode(enc);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(decrypted) as { file: string };
}

/** Extracts the stream id from a MegaPlay embed URL path. */
function extractId(embedUrl: string): string | null {
  let urlObj: URL;
  try {
    urlObj = new URL(embedUrl);
  } catch {
    return null;
  }
  const match =
    /\/stream\/(?:s-\d+\/|videojs\/stream\/)?([^/?#]+)/i.exec(urlObj.pathname) ||
    /\/([^/?#]+)$/.exec(urlObj.pathname);
  return match ? match[1] : null;
}

export async function extractMegaPlay(
  embedUrl: string,
  headers: Record<string, string> = {},
): Promise<MegaPlayResult> {
  const urlObj = new URL(embedUrl);
  const id = extractId(embedUrl);
  if (!id) throw new Error(`megaplay: could not extract id from ${embedUrl}`);

  // Prefer getSourcesNew (modern API), fall back to getSources.
  const endpoints = [
    `${urlObj.origin}/stream/getSourcesNew?id=${encodeURIComponent(id)}`,
    `${urlObj.origin}/stream/getSources?id=${encodeURIComponent(id)}`,
  ];

  let lastError: Error | null = null;
  let payload: any = null;

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        headers: {
          'User-Agent': UA,
          Referer: embedUrl,
          'X-Requested-With': 'XMLHttpRequest',
          ...headers,
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const json = await res.json() as any;
      if (json && (json.enc || json.file || json.sources)) {
        payload = json;
        break;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (!payload) {
    throw new Error(`megaplay: no sources (${lastError?.message ?? 'empty response'})`);
  }

  let fileUrl: string | null = null;
  if (payload.enc) {
    fileUrl = decryptMegaPlay(payload.enc).file;
  } else if (payload.file) {
    fileUrl = String(payload.file);
  } else if (Array.isArray(payload.sources) && payload.sources[0]?.file) {
    fileUrl = String(payload.sources[0].file);
  }

  if (!fileUrl) throw new Error('megaplay: no playable file in response');

  const tracks: MegaPlayTrack[] = [];
  if (Array.isArray(payload.tracks)) {
    for (const track of payload.tracks) {
      if (!track?.file || track.kind === 'thumbnails') continue;
      tracks.push({
        file: String(track.file),
        label: track.label ?? track.language,
        language: track.language ?? track.label,
        kind: track.kind,
      });
    }
  }

  return {
    fileUrl,
    tracks,
    headers: { Referer: `${urlObj.origin}/`, 'User-Agent': UA, ...headers },
    intro: payload.intro,
    outro: payload.outro,
  };
}