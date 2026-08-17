import { uniqueBy, isSafeHttpUrl, normalizeQuality } from './mapper.js';
const SUBTITLE_META = Symbol('provider-subtitles');
type WithSubtitleMeta = { [SUBTITLE_META]?: RawSubtitle[] };

import type {
  ProviderCategory,
  PublicDownloadGroup,
  PublicDownloadItem,
  PublicDownloadResponse,
  PublicStreamResponse,
  PublicStreamItem,
  PublicSubtitle,
  RawDownload,
  RawStream,
  RawSubtitle,
} from './shared/types.js';

export function attachSubtitles<T extends RawStream[] | RawDownload[]>(values: T, subtitles: RawSubtitle[]): T {
  Object.defineProperty(values, SUBTITLE_META, { value: subtitles, enumerable: false, configurable: true });
  return values;
}

export function attachedSubtitles(values: RawStream[] | RawDownload[]): RawSubtitle[] {
  return ((values as (RawStream[] | RawDownload[]) & WithSubtitleMeta)[SUBTITLE_META] ?? []);
}

export function mergeSubtitles(values: RawSubtitle[]): PublicSubtitle[] {
  return uniqueBy(
    values.filter((item) => isSafeHttpUrl(item.url) && item.language_code),
    (item) => item.language_code.toLowerCase(),
  ).map((item) => ({
    url: item.url,
    language: item.language,
    language_code: item.language_code.toLowerCase(),
    format: item.format,
  }));
}

export function normalizeStreams(values: RawStream[]): PublicStreamItem[] {
  return uniqueBy(values.filter((item) => isSafeHttpUrl(item.url)), (item) => `${item.url}:${item.quality}:${item.audio}`)
    .map((item) => ({
      quality: normalizeQuality(item.quality),
      format: item.format,
      audio: item.audio || 'Original',
      url: item.url,
    }));
}

export function normalizeDownloads(values: RawDownload[]): PublicDownloadItem[] {
  return uniqueBy(values.filter((item) => isSafeHttpUrl(item.url)), (item) => `${item.url}:${item.quality}:${item.filename ?? ''}`)
    .map((item) => ({
      quality: normalizeQuality(item.quality),
      format: item.format,
      audio: 'Original',
      url: item.url,
      filename: item.filename,
      size: item.size,
    }));
}

export function buildStreamResponse(
  spunId: string,
  title: string,
  type: ProviderCategory,
  streams: RawStream[],
  subtitles: RawSubtitle[],
): PublicStreamResponse {
  return { spun_id: spunId, title, type, streams: normalizeStreams(streams), subtitles: mergeSubtitles(subtitles) };
}

export function buildDownloadResponse(
  spunId: string,
  title: string,
  type: ProviderCategory,
  downloads: RawDownload[],
  subtitles: RawSubtitle[],
  batch: boolean,
): PublicDownloadResponse {
  const grouped = new Map<string, RawDownload[]>();
  for (const item of downloads) {
    const id = `${item.season ?? 0}:${item.episode ?? 0}`;
    const list = grouped.get(id) ?? [];
    list.push(item);
    grouped.set(id, list);
  }

  const flat = normalizeDownloads(downloads);
  const groupedOutput: PublicDownloadGroup[] = [...grouped.entries()]
    .filter(([id]) => id !== '0:0')
    .map(([id, items]) => {
      const [season, episode] = id.split(':').map(Number);
      return { season, episode, options: normalizeDownloads(items) };
    })
    .filter((group) => group.options.length);

  return {
    spun_id: spunId,
    title,
    type,
    downloads: batch && type !== 'movie' && groupedOutput.length ? groupedOutput : flat,
    subtitles: mergeSubtitles(subtitles),
  };
}
