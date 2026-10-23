import { posix } from 'node:path';

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function pathDistance(a, b) {
  const sa = posix.dirname(a).split('/').filter((s) => s && s !== '.');
  const sb = posix.dirname(b).split('/').filter((s) => s && s !== '.');
  let i = 0;
  while (i < sa.length && i < sb.length && sa[i] === sb[i]) i++;
  return sa.length - i + (sb.length - i);
}

/** Closest existing files to a (missing) target path. Returns paths, best first. */
export function closestFiles(target, allPaths, { from = '', limit = 3 } = {}) {
  const tb = posix.basename(target).toLowerCase();
  const tbn = tb.replace(/\.[^.]+$/, '');
  const scored = [];
  for (const p of allPaths) {
    if (p === from) continue;
    const b = posix.basename(p).toLowerCase();
    const bn = b.replace(/\.[^.]+$/, '');
    const d = Math.min(levenshtein(b, tb), levenshtein(bn, tbn) + 1);
    const maxLen = Math.max(b.length, tb.length, 1);
    if (d / maxLen > 0.5) continue;
    scored.push({ p, score: d * 3 + pathDistance(target, p) + (target.endsWith(p) || p.endsWith(target) ? -5 : 0) });
  }
  scored.sort((x, y) => x.score - y.score || x.p.localeCompare(y.p));
  return scored.slice(0, limit).map((s) => s.p);
}
