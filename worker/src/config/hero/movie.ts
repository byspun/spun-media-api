// worker/src/config/hero/movie.ts
// Manual override for the /home/movie hero carousel.
// Items here appear FIRST in the hero, in this exact order.
// Algorithmic picks fill remaining slots up to a max of 7.
// Leave empty for fully algorithmic.

export const movieHero: Array<{ spun_id: string; note: string | null }> = [
  // { spun_id: 'your-movie-xxxxxx', note: 'New release — pin for launch week' },
];
