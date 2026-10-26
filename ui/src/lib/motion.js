import { prefersReducedMotion } from 'svelte/motion';

/** Shared durations (ms) for Svelte transitions; CSS uses --dur-fast / --dur / --dur-slow. */
export const DUR = { fast: 150, base: 240, slow: 400 };

/** Duration helper that collapses to 0 when the user prefers reduced motion. */
export const dur = (ms) => (prefersReducedMotion.current ? 0 : ms);
export const reduced = () => prefersReducedMotion.current;
