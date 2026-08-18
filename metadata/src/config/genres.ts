// metadata/src/config/genres.ts
// Genre definitions for the Spün Media API.
// IDs are plain slugs — no G-codes.
// Each genre maps to TMDB genre IDs (movie + TV) and AniList genre strings.
// Only the public-facing fields (id, name, description, content_types) are
// ever returned in API responses. The mapping fields are internal only.

import type { SpunGenre } from '../types/index.js';

export const GENRES: SpunGenre[] = [
  // ─── Action & Adventure ───────────────────────────────────────────────────
  {
    id:            'action',
    name:          'Action',
    description:   'High-octane sequences, combat, and physical conflict.',
    content_types: ['movie', 'tv', 'anime'],
    tmdb_movie_genre_ids: [28],
    tmdb_tv_genre_ids:    [10759],
    anilist_genres:       ['Action'],
  },
  {
    id:            'adventure',
    name:          'Adventure',
    description:   'Journeys, exploration, and discovery.',
    content_types: ['movie', 'tv', 'anime'],
    tmdb_movie_genre_ids: [12],
    tmdb_tv_genre_ids:    [10759],
    anilist_genres:       ['Adventure'],
  },

  // ─── Comedy ──────────────────────────────────────────────────────────────
  {
    id:            'comedy',
    name:          'Comedy',
    description:   'Humour, wit, and lighthearted storytelling.',
    content_types: ['movie', 'tv', 'anime'],
    tmdb_movie_genre_ids: [35],
    tmdb_tv_genre_ids:    [35],
    anilist_genres:       ['Comedy'],
  },
  {
    id:            'slice-of-life',
    name:          'Slice of Life',
    description:   'Everyday moments and ordinary characters.',
    content_types: ['anime'],
    anilist_genres: ['Slice of Life'],
  },

  // ─── Drama ───────────────────────────────────────────────────────────────
  {
    id:            'drama',
    name:          'Drama',
    description:   'Character-driven emotional storytelling.',
    content_types: ['movie', 'tv', 'anime'],
    tmdb_movie_genre_ids: [18],
    tmdb_tv_genre_ids:    [18],
    anilist_genres:       ['Drama'],
  },
  {
    id:            'romance',
    name:          'Romance',
    description:   'Love stories and relationship arcs.',
    content_types: ['movie', 'tv', 'anime'],
    tmdb_movie_genre_ids: [10749],
    tmdb_tv_genre_ids:    [10749],
    anilist_genres:       ['Romance'],
  },

  // ─── Genre Fiction ───────────────────────────────────────────────────────
  {
    id:            'sci-fi',
    name:          'Sci-Fi',
    description:   'Science, technology, and speculative futures.',
    content_types: ['movie', 'tv', 'anime'],
    tmdb_movie_genre_ids: [878],
    tmdb_tv_genre_ids:    [10765],
    anilist_genres:       ['Sci-Fi'],
  },
  {
    id:            'fantasy',
    name:          'Fantasy',
    description:   'Magic, myth, and worlds beyond reality.',
    content_types: ['movie', 'tv', 'anime'],
    tmdb_movie_genre_ids: [14],
    tmdb_tv_genre_ids:    [10765],
    anilist_genres:       ['Fantasy'],
  },
  {
    id:            'horror',
    name:          'Horror',
    description:   'Fear, dread, and the supernatural.',
    content_types: ['movie', 'tv', 'anime'],
    tmdb_movie_genre_ids: [27],
    tmdb_tv_genre_ids:    [27],
    anilist_genres:       ['Horror'],
  },
  {
    id:            'thriller',
    name:          'Thriller',
    description:   'Tension, suspense, and psychological edge.',
    content_types: ['movie', 'tv', 'anime'],
    tmdb_movie_genre_ids: [53],
    tmdb_tv_genre_ids:    [9648],
    anilist_genres:       ['Thriller'],
  },
  {
    id:            'mystery',
    name:          'Mystery',
    description:   'Puzzles, secrets, and investigative plots.',
    content_types: ['movie', 'tv', 'anime'],
    tmdb_movie_genre_ids: [9648],
    tmdb_tv_genre_ids:    [9648],
    anilist_genres:       ['Mystery'],
  },
  {
    id:            'crime',
    name:          'Crime',
    description:   'Criminal underworlds, heists, and investigations.',
    content_types: ['movie', 'tv'],
    tmdb_movie_genre_ids: [80],
    tmdb_tv_genre_ids:    [80],
  },

  // ─── Anime-specific ───────────────────────────────────────────────────────
  {
    id:            'mecha',
    name:          'Mecha',
    description:   'Giant robots, mechanical suits, and tech warfare.',
    content_types: ['anime'],
    anilist_genres: ['Mecha'],
  },
  {
    id:            'isekai',
    name:          'Isekai',
    description:   'Transported to another world.',
    content_types: ['anime'],
    anilist_genres: ['Isekai'],
    anilist_tags:   ['Isekai'],
  },
  {
    id:            'supernatural',
    name:          'Supernatural',
    description:   'Powers, spirits, and phenomena beyond the natural.',
    content_types: ['movie', 'tv', 'anime'],
    tmdb_movie_genre_ids: [],
    tmdb_tv_genre_ids:    [10765],
    anilist_genres:       ['Supernatural'],
  },
  {
    id:            'psychological',
    name:          'Psychological',
    description:   'Mind games, unreliable realities, and mental exploration.',
    content_types: ['movie', 'tv', 'anime'],
    anilist_genres: ['Psychological'],
  },
  {
    id:            'ecchi',
    name:          'Ecchi',
    description:   'Suggestive but non-explicit content.',
    content_types: ['anime'],
    anilist_genres: ['Ecchi'],
  },
  {
    id:            'harem',
    name:          'Harem',
    description:   'One protagonist surrounded by multiple love interests.',
    content_types: ['anime'],
    anilist_tags:  ['Harem'],
  },
  {
    id:            'sports',
    name:          'Sports',
    description:   'Athletic competition and team dynamics.',
    content_types: ['movie', 'tv', 'anime'],
    tmdb_movie_genre_ids: [],
    tmdb_tv_genre_ids:    [],
    anilist_genres:       ['Sports'],
  },
  {
    id:            'music',
    name:          'Music',
    description:   'Musical performances, bands, and the arts.',
    content_types: ['movie', 'tv', 'anime'],
    tmdb_movie_genre_ids: [10402],
    tmdb_tv_genre_ids:    [10402],
    anilist_genres:       ['Music'],
  },
  {
    id:            'school',
    name:          'School',
    description:   'Student life, academic settings, and coming-of-age.',
    content_types: ['anime'],
    anilist_tags:  ['School', 'High School'],
  },
  {
    id:            'martial-arts',
    name:          'Martial Arts',
    description:   'Combat disciplines, dojos, and fighting mastery.',
    content_types: ['movie', 'tv', 'anime'],
    anilist_genres: ['Martial Arts'],
  },
  {
    id:            'military',
    name:          'Military',
    description:   'Armed forces, warfare, and strategy.',
    content_types: ['movie', 'tv', 'anime'],
    tmdb_movie_genre_ids: [10752],
    tmdb_tv_genre_ids:    [10768],
    anilist_genres:       ['Military'],
  },
  {
    id:            'historical',
    name:          'Historical',
    description:   'Set in or inspired by real historical periods.',
    content_types: ['movie', 'tv', 'anime'],
    tmdb_movie_genre_ids: [36],
    tmdb_tv_genre_ids:    [36],
    anilist_genres:       ['Historical'],
  },

  // ─── Broad categories ─────────────────────────────────────────────────────
  {
    id:            'animation',
    name:          'Animation',
    description:   'Animated films and series (non-anime).',
    content_types: ['movie', 'tv'],
    tmdb_movie_genre_ids: [16],
    tmdb_tv_genre_ids:    [16],
  },
  {
    id:            'documentary',
    name:          'Documentary',
    description:   'Non-fiction storytelling and real-world subjects.',
    content_types: ['movie', 'tv'],
    tmdb_movie_genre_ids: [99],
    tmdb_tv_genre_ids:    [99],
  },
  {
    id:            'family',
    name:          'Family',
    description:   'All-ages stories with broad appeal.',
    content_types: ['movie', 'tv'],
    tmdb_movie_genre_ids: [10751],
    tmdb_tv_genre_ids:    [10751],
  },
  {
    id:            'kids',
    name:          'Kids',
    description:   'Content made for younger audiences.',
    content_types: ['tv'],
    tmdb_tv_genre_ids: [10762],
  },
  {
    id:            'western',
    name:          'Western',
    description:   'The American frontier, outlaws, and dust.',
    content_types: ['movie', 'tv'],
    tmdb_movie_genre_ids: [37],
    tmdb_tv_genre_ids:    [37],
  },
  {
    id:            'war',
    name:          'War',
    description:   'Conflict on the front lines and its human cost.',
    content_types: ['movie', 'tv'],
    tmdb_movie_genre_ids: [10752],
    tmdb_tv_genre_ids:    [10768],
  },
  {
    id:            'biography',
    name:          'Biography',
    description:   'True stories of real people.',
    content_types: ['movie', 'tv'],
    tmdb_movie_genre_ids: [36],
  },
];

// ─── Genre groups — for /genres endpoint ─────────────────────────────────────

export const GENRE_GROUPS: Array<{ id: string; label: string; genreIds: string[] }> = [
  {
    id:       'action-adventure',
    label:    'Action & Adventure',
    genreIds: ['action', 'adventure', 'martial-arts', 'military'],
  },
  {
    id:       'comedy-drama',
    label:    'Comedy & Drama',
    genreIds: ['comedy', 'drama', 'romance', 'slice-of-life', 'school'],
  },
  {
    id:       'genre-fiction',
    label:    'Genre Fiction',
    genreIds: ['sci-fi', 'fantasy', 'supernatural', 'isekai', 'mecha'],
  },
  {
    id:       'dark-thriller',
    label:    'Dark & Thriller',
    genreIds: ['horror', 'thriller', 'mystery', 'crime', 'psychological'],
  },
  {
    id:       'lifestyle',
    label:    'Lifestyle & Culture',
    genreIds: ['sports', 'music', 'historical', 'biography', 'documentary'],
  },
  {
    id:       'family-kids',
    label:    'Family & Kids',
    genreIds: ['family', 'kids', 'animation'],
  },
  {
    id:       'more',
    label:    'More',
    genreIds: ['western', 'war', 'harem', 'ecchi'],
  },
];

// ─── Lookup helpers ───────────────────────────────────────────────────────────

export function getGenreById(id: string): SpunGenre | null {
  return GENRES.find((g) => g.id === id) ?? null;
}

export function getGenresByContentType(type: 'movie' | 'tv' | 'anime'): SpunGenre[] {
  return GENRES.filter((g) => g.content_types.includes(type));
}
