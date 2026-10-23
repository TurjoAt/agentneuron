import { prefersReducedMotion } from 'svelte/motion';

/** Duration helper that collapses to 0 when the user prefers reduced motion. */
export const dur = (ms) => (prefersReducedMotion.current ? 0 : ms);
export const reduced = () => prefersReducedMotion.current;
