// Tiny version-range reader (npm, composer, PEP 440 subsets) for the truth check. Returns null when unsure.

const parse = (v) => {
  const m = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?/.exec(String(v).trim());
  if (!m) return null;
  const n = (s) => (s == null || /[xX*]/.test(s) ? null : Number(s));
  return { major: n(m[1]), minor: n(m[2]), patch: n(m[3]) };
};
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Compile a range into OR-sets of [op, [maj,min,pat]] comparators; null if not a plain version range. */
export function compileRange(range) {
  let r = String(range || '').trim();
  if (!r || /^(\*|x|latest|next|lts.*|stable|dev-.*|workspace:.*|file:.*|link:.*|git.*|https?:.*|npm:.*|catalog:.*)$/i.test(r) || /[/#]/.test(r)) return null;
  r = r.replace(/\s*,\s*/g, ' ').replace(/(^|[^|])\|(?!\|)/g, '$1||').replace(/==/g, '=').replace(/~=/g, '^').replace(/@\w+$/, '');
  const sets = [];
  for (const part of r.split('||')) {
    const p = part.trim().replace(/([<>=^~]+)\s+/g, '$1');
    if (!p) return null;
    const out = [];
    const hy = /^(\S+)\s+-\s+(\S+)$/.exec(p);
    const items = hy ? [`>=${hy[1]}`, `<=${hy[2]}`] : p.split(/\s+/);
    for (const it of items) {
      const m = /^(>=|<=|>|<|=|\^|~)?(.+)$/.exec(it);
      const op = m[1] || '';
      const v = parse(m[2]);
      if (!v || v.major == null) { if (/^[*xX]$/.test(m[2])) continue; return null; }
      const lo = [v.major, v.minor ?? 0, v.patch ?? 0];
      if (op === '^') {
        out.push(['>=', lo]);
        out.push(['<', v.major > 0 || v.minor == null ? [v.major + 1, 0, 0] : [0, v.minor + 1, 0]]);
      } else if (op === '~') {
        out.push(['>=', lo]);
        out.push(['<', v.minor == null ? [v.major + 1, 0, 0] : [v.major, v.minor + 1, 0]]);
      } else if (op === '' || op === '=') {
        out.push(['>=', lo]);
        out.push(['<', v.minor == null ? [v.major + 1, 0, 0] : v.patch == null ? [v.major, v.minor + 1, 0] : [v.major, v.minor, v.patch + 1]]);
      } else out.push([op, lo]);
    }
    sets.push(out);
  }
  return sets.length ? sets : null;
}

function inSet(set, v) {
  for (const [op, b] of set) {
    const c = cmp(v, b);
    if ((op === '>=' && c < 0) || (op === '>' && c <= 0) || (op === '<' && c >= 0) || (op === '<=' && c > 0)) return false;
  }
  return true;
}

/** Lowest version a range allows (approx.: the largest lower bound of the lowest set). */
export function rangeFloor(range) {
  const sets = compileRange(range);
  if (!sets) return null;
  let best = null;
  for (const s of sets) {
    let lo = [0, 0, 0];
    for (const [op, b] of s) if ((op === '>=' || op === '>') && cmp(b, lo) > 0) lo = b;
    if (!best || cmp(lo, best) < 0) best = lo;
  }
  return best ? { major: best[0], minor: best[1], patch: best[2] } : null;
}

/**
 * Does `range` agree with a claim like "React 18", "PHP 8.2" or "Node 18+" (atLeast)?
 * true / false, or null when the range cannot be read.
 */
export function claimMatches(range, { major, minor = null, atLeast = false }) {
  const sets = compileRange(range);
  if (!sets) return null;
  const floor = rangeFloor(range);
  if (atLeast) {
    // "Node 20+" is wrong only when it understates the requirement (agents would use a too-old runtime)
    if (!floor) return null;
    return major > floor.major || (major === floor.major && (minor == null || minor >= floor.minor));
  }
  const probes = [[major, minor ?? 0, 0], [major, minor ?? 999, 999]];
  if (floor && floor.major === major && (minor == null || floor.minor === minor)) probes.push([floor.major, floor.minor, floor.patch]);
  return probes.some((v) => sets.some((s) => inSet(s, v)));
}

/** "20.11.1" / "v20" / "20" pin vs claim. null when the pin is not numeric (lts/*, system...). */
export function pinMatches(pin, { major, minor = null, atLeast = false }) {
  const v = parse(pin);
  if (!v || v.major == null) return null;
  if (atLeast) return v.major > major || (v.major === major && (minor == null || (v.minor ?? 0) >= minor));
  return v.major === major && (minor == null || v.minor == null || v.minor === minor);
}

export const versionOf = parse;
