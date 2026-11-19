import { fetchJson, fetchWithTimeout } from './internal/http.js';
import { isSafeHttpUrl, detectFormat, normalizeQuality } from './internal/utils.js';
import type { MovieProviderInput, TvProviderInput, RawDownload } from './internal/types.js';

const MAIN_URL = 'https://new4.moviesdrive.christmas';
const DOMAINS_URL = 'https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'max-age=0',
  'Connection': 'keep-alive',
};

let cachedMainUrl: string | null = null;

async function getMainUrl(): Promise<string> {
  if (cachedMainUrl) return cachedMainUrl;
  try {
    const response = await fetch(DOMAINS_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await response.json() as { moviesdrive?: string };
    cachedMainUrl = data.moviesdrive || MAIN_URL;
    return cachedMainUrl;
  } catch {
    return MAIN_URL;
  }
}

function getQuality(str: string): number {
  if (!str) return 1080;
  const match = str.match(/(\d{3,4})[pP]/);
  if (match) return parseInt(match[1]);
  if (str.toUpperCase().includes('4K') || str.toUpperCase().includes('2160P') || str.toUpperCase().includes('UHD')) return 2160;
  return 1080;
}

async function extractMdrive(url: string, referer: string): Promise<string[]> {
  if (!url) return [];
  const regex = /hubcloud|gdflix|gdlink/i;

  try {
    const res = await fetchWithTimeout(url, {
      headers: { ...HEADERS, 'Referer': referer, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 15_000,
    });
    const html = await res.text().catch(() => '');

    if (url.includes('search-recover.php')) {
      const qMatch = html.match(/const\s+Q_INITIAL\s*=\s*["']([^"']+)["']/);
      const tokenMatch = html.match(/const\s+FROM_AC_TOKEN\s*=\s*["']([^"']+)["']/);
      if (qMatch && tokenMatch) {
        const apiBase = url.split('/drive/')[0];
        const searchParams = new URLSearchParams({ api: 'search', q: qMatch[1], page: '1', from_ac: tokenMatch[1] });
        const apiRes = await fetchWithTimeout(`${apiBase}/drive/search-recover.php?${searchParams.toString()}`, {
          headers: { ...HEADERS, 'Accept': 'application/json', 'Referer': url, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: 15_000,
        });
        let data: { hits?: Array<{ url: string }> } = { hits: [] };
        try { data = await apiRes.json() as { hits?: Array<{ url: string }> }; } catch { data = { hits: [] }; }
        if (data.hits) return data.hits.map((h) => h.url).filter(Boolean);
      }
    }

    // Simple link extraction without cheerio
    const linkRegex = /href=["']([^"']+)["']/g;
    const links: string[] = [];
    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = linkRegex.exec(html)) !== null) {
      const href = linkMatch[1];
      if (regex.test(href)) links.push(href);
    }
    return links;
  } catch {
    return [];
  }
}

async function hubCloudExtractor(url: string, referer: string): Promise<Array<{ name: string; quality: number; url: string; size: string }>> {
  try {
    let currentUrl = url;
    const pageResponse = await fetchWithTimeout(currentUrl, {
      headers: { ...HEADERS, 'Referer': referer },
      timeout: 15_000,
    });
    let pageData = await pageResponse.text().catch(() => '');
    let finalUrl = currentUrl;

    if (!currentUrl.includes('hubcloud.php')) {
      let nextHref = '';
      const phpLinkMatch = pageData.match(/<a[^>]*href=["']([^"']*hubcloud\.php[^"']*)["']/i);
      if (phpLinkMatch) nextHref = phpLinkMatch[1];
      else {
        const downloadBtnMatch = pageData.match(/id=["']download["'][^>]*href=["']([^"']+)["']/i);
        if (downloadBtnMatch) nextHref = downloadBtnMatch[1];
        else {
          const scriptUrlMatch = pageData.match(/var\s+url\s*=\s*["']([^"']+)["']/i);
          if (scriptUrlMatch) nextHref = scriptUrlMatch[1];
        }
      }
      if (nextHref) {
        if (!nextHref.startsWith('http')) {
          const urlObj = new URL(currentUrl);
          nextHref = `${urlObj.protocol}//${urlObj.hostname}/${nextHref.replace(/^\//, '')}`;
        }
        finalUrl = nextHref;
        const secondResponse = await fetchWithTimeout(finalUrl, {
          headers: { ...HEADERS, 'Referer': currentUrl },
          timeout: 15_000,
        });
        pageData = await secondResponse.text().catch(() => '');
      }
    }

    const sizeMatch = pageData.match(/<i[^>]*id=["']size["'][^>]*>([^<]+)<\/i>/i);
    const size = sizeMatch?.[1]?.trim() || '';
    const headerMatch = pageData.match(/<div[^>]*class=["']card-header["'][^>]*>([^<]+)<\/div>/i);
    const quality = getQuality(headerMatch?.[1] || '');
    const pxlMatch = pageData.match(/var\s+pxl\s*=\s*["']([^"']+)["']/i);

    const links: Array<{ name: string; quality: number; url: string; size: string }> = [];
    // Capture everything up to </a> (including nested tags like <i> icons), then strip tags
    const linkRegex = /<a\s+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const blocked = ['tinyurl', 'telegram', 'hubcloud.cx/tg', 'hubcloud.foo/tg'];

    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = linkRegex.exec(pageData)) !== null) {
      let link = linkMatch[1];
      const rawText = linkMatch[2] || '';
      // Strip nested HTML tags to get the visible text
      const text = rawText.replace(/<[^>]+>/g, '').toLowerCase().trim();
      if (!link || blocked.some(b => link.includes(b))) continue;

      if (link.includes('negn6f') && pxlMatch) link = pxlMatch[1];

      if (text.includes('fslv2')) links.push({ name: 'HubCloud - FSLv2', quality, url: link, size });
      else if (text.includes('fsl server') || (text.includes('fsl') && !text.includes('v2'))) links.push({ name: 'HubCloud - FSL Server', quality, url: link, size });
      else if (text.includes('download file') || text.includes('instant download') || text.includes('instant') || text.includes('10gbps')) {
        let streamUrl = link;
        if (streamUrl.includes('link=')) streamUrl = streamUrl.split('link=')[1];
        else {
          try {
            const res = await fetchWithTimeout(link, { headers: { ...HEADERS, 'Referer': finalUrl }, redirect: 'follow', timeout: 15_000 });
            if (res.url && typeof res.url === 'string' && res.url.startsWith('http')) {
              streamUrl = res.url;
              if (streamUrl.includes('link=')) streamUrl = streamUrl.split('link=')[1];
            }
          } catch {}
        }
        if (streamUrl && typeof streamUrl === 'string' && streamUrl.startsWith('http')) links.push({ name: 'HubCloud - Instant', quality, url: streamUrl, size });
      } else if (text.includes('pixeldra') || text.includes('pixelserver') || text.includes('pixeldrain') || link.includes('pixeldrain')) {
        let pUrl = link;
        if (pUrl.includes('/u/')) {
          const fileId = pUrl.split('/u/')[1].split('?')[0].replace('/', '');
          pUrl = `https://pixeldrain.dev/api/file/${fileId}?download`;
        }
        links.push({ name: 'HubCloud - Pixeldrain', quality, url: pUrl, size });
      } else if (text.includes('buzzserver') || text.includes('buzz server') || text.includes('buzz') || text.includes('fuckingfast')) {
        try {
          const dlRes = await fetchWithTimeout(link, { headers: { 'User-Agent': HEADERS['User-Agent'], 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }, timeout: 15_000 });
          const dlHtml = await dlRes.text().catch(() => '');
          const copyMatch = dlHtml.match(/copyDownloadLink\(['"]([^'"]+)['"]\)/);
          const dlPath = copyMatch ? copyMatch[1].replace(/\\\//g, '/') : null;
          const base = new URL(link).origin;
          const dlUrl = dlPath ? (dlPath.startsWith('http') ? dlPath : `${base}${dlPath}`) : (link.endsWith('/download') ? link : `${link}/download`);
          const resp = await fetchWithTimeout(dlUrl, { headers: { 'User-Agent': HEADERS['User-Agent'], 'Referer': link, 'HX-Request': 'true' }, redirect: 'manual', timeout: 15_000 });
          const dlink = resp.headers.get('hx-redirect') || resp.headers.get('location');
          if (dlink) links.push({ name: 'HubCloud - BuzzServer', quality, url: dlink, size });
        } catch {}
      } else if (text.includes('s3 server')) links.push({ name: 'HubCloud - S3', quality, url: link, size });
      else if (text.includes('mega server')) links.push({ name: 'HubCloud - Mega', quality, url: link, size });
      else if (link.includes('r2.dev')) links.push({ name: 'Direct R2', quality, url: link, size });
      else if (link.includes('workers.dev')) links.push({ name: 'ZipDisk Server', quality, url: link, size });
    }
    return links;
  } catch {
    return [];
  }
}

async function loadExtractor(url: string, referer: string): Promise<Array<{ name: string; quality: number; url: string; size: string }>> {
  try {
    const hostname = new URL(url).hostname;
    if (hostname.includes('hubcloud')) return hubCloudExtractor(url, referer);
    if (hostname.includes('gdflix') || hostname.includes('gdlink')) return [{ name: 'GDFlix', quality: 1080, url, size: '' }];
    return [];
  } catch {
    return [];
  }
}

function getTmdbMetadata(tmdbId: number, mediaType: 'movie' | 'tv', tmdbApiKey: string, season?: number, episode?: number): Promise<{ name: string; year: string; duration: string }> {
  return (async () => {
    if (!tmdbApiKey) return { name: 'Unknown Title', year: 'N/A', duration: mediaType === 'movie' ? 'N/A' : '45 min' };
    try {
      const type = mediaType === 'movie' ? 'movie' : 'tv';
      const url = `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${encodeURIComponent(tmdbApiKey)}`;
      const res = await fetchWithTimeout(url, { headers: { 'User-Agent': HEADERS['User-Agent'], 'Accept': 'application/json' }, timeout: 10_000 });
      if (!res.ok) return { name: 'Unknown Title', year: 'N/A', duration: mediaType === 'movie' ? 'N/A' : '45 min' };
      const data = await res.json() as { title?: string; name?: string; runtime?: number; release_date?: string; first_air_date?: string; episode_run_time?: number[] };
      let duration = mediaType === 'movie' ? 'N/A' : '45 min';
      if (mediaType === 'movie' && data.runtime) duration = `${data.runtime} min`;
      else if (mediaType === 'tv' && season && episode) {
        const epUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}/episode/${episode}?api_key=${encodeURIComponent(tmdbApiKey)}`;
        const epRes = await fetchWithTimeout(epUrl, { headers: { 'User-Agent': HEADERS['User-Agent'], 'Accept': 'application/json' }, timeout: 10_000 });
        if (epRes.ok) {
          const epData = await epRes.json() as { runtime?: number };
          if (epData.runtime) duration = `${epData.runtime} min`;
          else if (data.episode_run_time?.[0]) duration = `${data.episode_run_time[0]} min`;
        }
      }
      return {
        name: data.title || data.name || 'Unknown Title',
        year: (data.release_date || data.first_air_date || '').split('-')[0] || 'N/A',
        duration,
      };
    } catch {
      return { name: 'Unknown Title', year: 'N/A', duration: mediaType === 'movie' ? 'N/A' : '45 min' };
    }
  })();
}

async function findMatch(hits: any[], mediaType: 'movie' | 'tv', cleanTitle: string, imdbId: string | undefined, seasonNum?: number): Promise<any | null> {
  if (!hits?.length) return null;

  if (mediaType === 'tv') {
    const sSlug = String(seasonNum).padStart(2, '0');
    const seasonPatterns = [
      new RegExp(`\\bseason\\s*0?${seasonNum}\\b`, 'i'),
      new RegExp(`\\bs0?${seasonNum}\\b`, 'i'),
      new RegExp(`\\bseason\\s*${sSlug}\\b`, 'i'),
    ];
    return hits.find((doc) => {
      const postTitle = (doc.post_title || '').toLowerCase();
      const permalink = (doc.permalink || '').toLowerCase();
      const normDocTitle = postTitle.replace(/[^a-z0-9]/g, '');
      const normTitle = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
      const titleMatches = normDocTitle.includes(normTitle) || postTitle.includes(cleanTitle.toLowerCase()) || permalink.includes(cleanTitle.toLowerCase().replace(/ /g, '-'));
      const seasonMatches = seasonPatterns.some(pat => pat.test(postTitle) || pat.test(permalink));
      return titleMatches && seasonMatches;
    });
  } else {
    return hits.find((d) => imdbId && d.imdb_id === imdbId) || hits.find((doc) => {
      const postTitle = (doc.post_title || '').toLowerCase();
      const permalink = (doc.permalink || '').toLowerCase();
      const normDocTitle = postTitle.replace(/[^a-z0-9]/g, '');
      const normTitle = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
      return normDocTitle.includes(normTitle) || postTitle.includes(cleanTitle.toLowerCase()) || permalink.includes(cleanTitle.toLowerCase().replace(/ /g, '-'));
    }) || hits[0];
  }
}

export async function getMoviesdriveDownloads(input: MovieProviderInput | TvProviderInput, tmdbApiKey: string): Promise<RawDownload[]> {
  const downloads: RawDownload[] = [];

  try {
    console.log(`[MoviesDrive] Querying for TMDB: ${input.tmdb_id}, Type: ${'season' in input ? 'tv' : 'movie'}`);
    const isTv = 'season' in input;
    const mediaType = isTv ? 'tv' : 'movie';
    const tmdbMeta = await getTmdbMetadata(input.tmdb_id, mediaType, tmdbApiKey, isTv ? input.season : undefined, isTv ? input.episode : undefined);
    const cleanTitle = tmdbMeta.name;
    const imdbId = (input as any).imdb_id || undefined;

    const mainUrl = await getMainUrl();
    let match: any = null;

    // Try IMDB search first (more reliable than title), then title search
    if (imdbId) {
      try {
        const searchUrl = `${mainUrl}/search.php?q=${encodeURIComponent(imdbId)}&page=1`;
        const searchRes = await fetchWithTimeout(searchUrl, { headers: HEADERS, timeout: 15_000 });
        if (searchRes.ok) {
          const searchData = await searchRes.json() as { hits?: Array<{ document: any }> };
          match = await findMatch((searchData.hits || []).map((h) => h.document), mediaType, cleanTitle, imdbId, isTv ? input.season : undefined);
        }
      } catch {}
    }

    if (!match && cleanTitle) {
      try {
        const searchUrl = `${mainUrl}/search.php?q=${encodeURIComponent(cleanTitle)}&page=1`;
        const searchRes = await fetchWithTimeout(searchUrl, { headers: HEADERS, timeout: 15_000 });
        if (searchRes.ok) {
          const searchData = await searchRes.json() as { hits?: Array<{ document: any }> };
          match = await findMatch((searchData.hits || []).map((h) => h.document), mediaType, cleanTitle, imdbId, isTv ? input.season : undefined);
        }
      } catch {}
    }

    if (!match) {
      console.log('[MoviesDrive] No matching post found');
      return [];
    }

    const permalink = match.permalink;
    if (!permalink || typeof permalink !== 'string') {
      console.log('[MoviesDrive] Match has no permalink');
      return [];
    }
    const href = permalink.startsWith('http') ? permalink : `${mainUrl}${permalink}`;

    const pageRes = await fetchWithTimeout(href, { headers: HEADERS, timeout: 15_000 });
    const pageHtml = await pageRes.text().catch(() => '');

    // Simple extraction without cheerio
    const linkRegex = /<h5[^>]*>\s*<a\s+href=["']([^"']+)["']/gi;
    const allLinks: string[] = [];
    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = linkRegex.exec(pageHtml)) !== null) {
      if (linkMatch[1]) allLinks.push(linkMatch[1]);
    }

    for (const link of [...new Set(allLinks)]) {
      const extracted = await extractMdrive(link, href);
      for (const server of extracted) {
        const streams = await loadExtractor(server, href);
        for (const stream of streams) {
          if (!isSafeHttpUrl(stream.url)) continue;
          const qualityLabel = `${stream.quality}p`;
          downloads.push({
            url: stream.url,
            format: detectFormat(stream.url, stream.url.includes('.m3u8') ? 'hls' : 'mp4') as 'mp4' | 'mkv' | 'dash',
            quality: normalizeQuality(qualityLabel),
            size: stream.size || null,
            filename: `${cleanTitle} - ${stream.name} [${qualityLabel}].mkv`,
            provider: 'moviesdrive',
            season: isTv ? input.season : undefined,
            episode: isTv ? input.episode : undefined,
          });
        }
      }
    }

    // Also handle TV episodes specifically
    if (isTv) {
      const sSlug = String(input.season).padStart(2, '0');
      const stag = `Season ${input.season}|S${sSlug}`;
      const sepRegex = new RegExp(`\\b(?:ep|episode|e)\\s*0?${input.episode}\\b|s0?${input.season}\\s*e0?${input.episode}\\b`, 'i');

      const h5Regex = /<h5[^>]*>([^<]*)<\/h5>/gi;
      const entries: { text: string; index: number }[] = [];
      let h5Match: RegExpExecArray | null;
      while ((h5Match = h5Regex.exec(pageHtml)) !== null) {
        if (new RegExp(stag, 'i').test(h5Match[1])) {
          entries.push({ text: h5Match[1], index: h5Match.index });
        }
      }

      for (const entry of entries) {
        // Find next href after this h5
        const afterHtml = pageHtml.slice(entry.index + entry.text.length);
        const nextLinkMatch = afterHtml.match(/<a\s+href=["']([^"']+)["']/i);
        if (!nextLinkMatch) continue;

        const nextHref = nextLinkMatch[1];
        const epPageRes = await fetchWithTimeout(nextHref, { headers: HEADERS, timeout: 15_000 });
        const epPageHtml = await epPageRes.text().catch(() => '');

        // Find episode links
        const epLinkRegex = /<h5[^>]*>([^<]*)<\/h5>/gi;
        let epH5Match: RegExpExecArray | null;
        const epLinks: string[] = [];
        while ((epH5Match = epLinkRegex.exec(epPageHtml)) !== null) {
          if (sepRegex.test(epH5Match[1])) {
            // Get links following this h5
            const afterEpHtml = epPageHtml.slice(epH5Match.index + epH5Match[0].length);
            const epLinkMatch2 = afterEpHtml.match(/<a\s+href=["']([^"']+)["']/gi);
            if (epLinkMatch2) {
              for (const m of epLinkMatch2) {
                const linkMatch = m.match(/href=["']([^"']+)["']/i);
                if (linkMatch?.[1]) epLinks.push(linkMatch[1]);
              }
            }
            break;
          }
        }

        for (const epLink of [...new Set(epLinks)]) {
          const extracted = await extractMdrive(epLink, nextHref);
          for (const server of extracted) {
            const streams = await loadExtractor(server, nextHref);
            for (const stream of streams) {
              if (!isSafeHttpUrl(stream.url)) continue;
              const qualityLabel = `${stream.quality}p`;
              downloads.push({
                url: stream.url,
                format: detectFormat(stream.url, stream.url.includes('.m3u8') ? 'hls' : 'mp4') as 'mp4' | 'mkv' | 'dash',
                quality: normalizeQuality(qualityLabel),
                size: stream.size || null,
                filename: `${cleanTitle} S${input.season}E${input.episode} - ${stream.name} [${qualityLabel}].mkv`,
                provider: 'moviesdrive',
                season: input.season,
                episode: input.episode,
              });
            }
          }
        }
      }
    }
  } catch (error) {
    console.error(`[MoviesDrive] Error: ${String(error)}`);
  }

  return downloads;
}