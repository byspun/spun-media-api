import type { Env } from '../types/env.js';
import type { MediaTitleRow } from '../types/index.js';

export interface MovieBoxInfo {
  subjectId: string;
  subjectType?: number | null;
  type?: string | null;
  title: string;
  description?: string | null;
  releaseDate?: string | null;
  poster?: string | null;
  rating?: number | null;
  runtime?: number | null;
  genre?: string | null;
  country?: string | null;
  language?: string | null;
}

export async function getMovieboxInfo(env: Env, row: MediaTitleRow): Promise<MovieBoxInfo | null> {
  if (!env.RENDER_BACKEND_URL || row.moviebox_id == null) return null;
  try {
    const response = await fetch(`${env.RENDER_BACKEND_URL.replace(/\/$/, '')}/catalog/info?moviebox_id=${encodeURIComponent(String(row.moviebox_id))}`, {
      headers: { 'X-Spun-Secret': env.X_SPUN_SECRET, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { item?: MovieBoxInfo };
    return payload.item ?? null;
  } catch {
    return null;
  }
}
