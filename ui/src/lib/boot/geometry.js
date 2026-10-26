// Shared layout for the pre-JS splash (ui/index.html) and the Svelte boot screen.
// The splash copies these numbers in its inline CSS so the mark never jumps between the two layers.

/** Step id → colour token and angle (degrees, 0 = right, clockwise) on the outer ring. */
export const NODE = {
  connect: { color: 'var(--accent)', angle: -90 },
  auth: { color: 'var(--info)', angle: -18 },
  files: { color: 'var(--tool-claude)', angle: 54 },
  context: { color: 'var(--ok)', angle: 126 },
  agents: { color: 'var(--tool-codex)', angle: 198 },
};

export const R_INNER = 64;
export const R_OUTER = 108;
export const R_SAT = 138;

const rad = (d) => (d * Math.PI) / 180;
export const polar = (r, deg) => [Math.cos(rad(deg)) * r, Math.sin(rad(deg)) * r];

/** Deterministic ambient nodes (background "neurons"). */
export function ambient(n = 16, seed = 7) {
  let s = seed;
  const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  return Array.from({ length: n }, (_, i) => {
    const [x, y] = polar(40 + r() * 112, r() * 360);
    return { id: i, x, y, size: 1 + r() * 1.6, delay: r() * 4, dur: 3 + r() * 4 };
  });
}
