// worker/src/config/hero/anime.ts
// Manual override for the /home/anime hero carousel.
// Items here appear FIRST in the hero, in this exact order.
// Algorithmic picks fill remaining slots up to a max of 7.
// Leave empty for fully algorithmic.
// NOTE: Hero images on /home/anime use AniList banner images ONLY — never TMDB backdrops.

export const animeHero: Array<{ spun_id: string; note: string | null }> = [
  // { spun_id: 'your-anime-xxxxxx', note: null },
];
