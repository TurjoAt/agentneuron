import { posix } from 'node:path';

const MD_EXT = /\.(md|mdc|markdown|txt)$/i;

/** Split content into lines flagged with fence state (fence delimiter lines are flagged too). */
export function scanLines(content) {
  const lines = String(content).split(/\r?\n/);
  const out = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(t);
    let inFence = fence !== null;
    if (m) {
      if (fence === null) { fence = m[1][0]; inFence = true; }
      else if (m[1][0] === fence) { fence = null; inFence = true; }
    }
    out.push({ n: i + 1, text: t, inFence });
  }
  return out;
}

/** Blank out inline code spans (same length). */
export function blankInlineCode(s) {
  return s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (m) => ' '.repeat(m.length));
}

function resolveRel(fromPath, target) {
  const dir = posix.dirname(fromPath);
  let t = target;
  if (t.startsWith('/')) t = t.slice(1);
  else t = posix.join(dir === '.' ? '' : dir, t);
  t = posix.normalize(t);
  if (t.startsWith('../') || t === '..') return null;
  return t.replace(/^\.\//, '');
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function isUrl(s) {
  return /^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//');
}

// Per path-set indexes, built once per graph rebuild instead of once per file (callers never mutate the set).
const indexes = new WeakMap();
function indexOf(allPaths) {
  let x = indexes.get(allPaths);
  if (x) return x;
  const base = new Map(), order = new Map(), odd = [];
  for (const p of [...allPaths].sort()) {
    const b = posix.basename(p).replace(/\.[^.]+$/, '').toLowerCase();
    if (!base.has(b)) base.set(b, []);
    base.get(b).push(p);
  }
  for (const p of allPaths) { order.set(p, order.size); if (!/^[\w./-]+$/.test(p)) odd.push(p); }
  x = { base, order, odd };
  indexes.set(allPaths, x);
  return x;
}

export function extractLinks(path, content, allPaths) {
  const links = [];
  const seen = new Set();
  const add = (to, type, line, raw, broken) => {
    const key = `${line}|${to}`;
    if (seen.has(key) && type !== 'wiki') return;
    seen.add(key);
    links.push({ from: path, to, type, line, broken, raw });
  };
  const lines = scanLines(content);

  const getBaseIdx = () => indexOf(allPaths).base;

  const mdTarget = (raw0, line, raw) => {
    let t = raw0.trim();
    if (t.startsWith('<')) { const e = t.indexOf('>'); t = e > 0 ? t.slice(1, e) : t.slice(1); }
    else t = t.split(/\s+/)[0];
    if (!t || t.startsWith('#') || isUrl(t)) return;
    t = t.split('#')[0].split('?')[0];
    if (!t) return;
    t = safeDecode(t);
    const r = resolveRel(path, t);
    if (r === null) { if (MD_EXT.test(t)) add(t, 'md-link', line, raw, true); return; }
    if (r === path) return;
    if (allPaths.has(r)) add(r, 'md-link', line, raw, false);
    else if (MD_EXT.test(r)) add(r, 'md-link', line, raw, true);
  };

  for (const { n, text, inFence } of lines) {
    if (inFence) continue;
    const s = blankInlineCode(text);
    // inline links / images
    for (const m of s.matchAll(/!?\[(?:[^\]\\]|\\.)*\]\(\s*(<[^>]*>|[^()\s]*(?:\([^()]*\)[^()\s]*)*)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g)) {
      mdTarget(m[1], n, m[0]);
    }
    // reference definitions
    const rd = /^\s{0,3}\[[^\]]+\]:\s*(\S+)/.exec(s);
    if (rd) mdTarget(rd[1], n, rd[0].trim());
    // wiki links
    for (const m of s.matchAll(/\[\[([^\]\n|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
      const name = m[1].trim();
      if (!name) continue;
      let hit = null;
      const asPath = name.includes('/') ? [name, name + '.md'].map((x) => x.replace(/^\//, '')) : [];
      for (const c of asPath) if (allPaths.has(c)) { hit = c; break; }
      if (!hit) {
        const cands = getBaseIdx().get(posix.basename(name).replace(/\.[^.]+$/, '').toLowerCase()) || [];
        const dir = posix.dirname(path);
        hit = cands.find((c) => posix.dirname(c) === dir && c !== path) || cands.find((c) => c !== path) || null;
      }
      if (hit) { if (hit !== path) add(hit, 'wiki', n, m[0], false); }
      else add(name, 'wiki', n, m[0], true);
    }
    // @imports
    for (const m of s.matchAll(/(?<![\w@./~`:\\-])@([A-Za-z0-9_.\-/]+)/g)) {
      let t = m[1].replace(/[.,;:)\]]+$/, '');
      if (!t || (!t.includes('/') && !/\.[A-Za-z0-9]+$/.test(t))) continue;
      if (/^\d/.test(t) && !t.includes('/') ) continue;
      const r = resolveRel(path, t);
      if (r === null) { if (MD_EXT.test(t)) add(t, 'import', n, '@' + m[1], true); continue; }
      if (r === path) continue;
      if (allPaths.has(r)) add(r, 'import', n, '@' + m[1], false);
      else if (MD_EXT.test(r)) add(r, 'import', n, '@' + m[1], true);
    }
  }

  // plain mentions of existing paths. A mention starts a maximal run of [\w./-] chars, so only
  // run prefixes are looked up (O(text) per file instead of scanning the text once per path).
  const idx = indexOf(allPaths);
  const hits = new Map(); // path -> line numbers (first qualifying occurrence per line)
  const hit = (p, n) => { const l = hits.get(p); if (!l) hits.set(p, [n]); else if (l[l.length - 1] !== n) l.push(n); };
  const text = String(content);
  for (const { n, text: lt, inFence } of lines) {
    if (inFence) continue;
    for (const m of lt.matchAll(/[\w./-]+/g)) {
      const R = m[0], i = m.index;
      if (R !== path && allPaths.has(R)) hit(R, n);
      for (let k = R.indexOf('.'); k > 0; k = R.indexOf('.', k + 1)) {
        if (/\w/.test(lt[i + k + 1] || '')) continue;
        const p = R.slice(0, k);
        if (p !== path && allPaths.has(p)) hit(p, n);
      }
    }
  }
  for (const p of idx.odd) { // paths with other characters (spaces, non-ASCII): direct scan
    if (p === path || !text.includes(p)) continue;
    for (const { n, text: lt, inFence } of lines) {
      if (inFence) continue;
      let from = 0;
      for (;;) {
        const i = lt.indexOf(p, from);
        if (i === -1) break;
        from = i + p.length;
        const before = lt[i - 1];
        const after = lt[i + p.length];
        if (before !== undefined && /[\w/.\-]/.test(before)) continue;
        if (after !== undefined && /[\w/\-]/.test(after)) continue;
        if (after === '.' && /\w/.test(lt[i + p.length + 1] || '')) continue;
        hit(p, n);
        break;
      }
    }
  }
  for (const p of [...hits.keys()].sort((a, b) => idx.order.get(a) - idx.order.get(b))) {
    for (const n of hits.get(p).sort((a, b) => a - b)) add(p, 'mention', n, p, false);
  }
  return links;
}
