// Small, dependency-free formatting + path helpers.

export function timeAgo(ts, now = Date.now()) {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

export function fmtNum(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n));
}

export function fmtBytes(b) {
  if (b == null) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1).replace(/\.0$/, '')} KB`;
  return `${(b / 1024 / 1024).toFixed(1).replace(/\.0$/, '')} MB`;
}

export function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function fmtDay(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts ?? '');
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Accept ms numbers, ISO strings, or unix seconds. */
export function toMs(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

export const basename = (p = '') => p.slice(p.lastIndexOf('/') + 1);
export const dirname = (p = '') => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** Resolve a relative link against a project-relative dir → normalized posix path. */
export function resolvePath(fromDir, target) {
  const parts = target.startsWith('/') ? [] : (fromDir ? fromDir.split('/') : []);
  for (const seg of target.replace(/^\/+/, '').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

export function plural(n, word, pl = word + 's') {
  return `${fmtNum(n)} ${n === 1 ? word : pl}`;
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Tiny fuzzy scorer: subsequence match with bonuses for contiguity & word starts. */
export function fuzzy(query, text) {
  if (!query) return { score: 1, idx: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) {
    const idx = Array.from({ length: q.length }, (_, i) => direct + i);
    const bonus = direct === 0 || '/._- '.includes(t[direct - 1]) ? 40 : 20;
    return { score: 100 + bonus - t.length * 0.1, idx };
  }
  let ti = 0, score = 0, last = -2;
  const idx = [];
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    score += found === last + 1 ? 6 : 1;
    if (found === 0 || '/._- '.includes(t[found - 1])) score += 4;
    idx.push(found);
    last = found;
    ti = found + 1;
  }
  return { score: score - t.length * 0.05, idx };
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Wrap matched character indices in <mark>. Returns safe HTML. */
export function highlight(text, idx = []) {
  if (!idx.length) return escapeHtml(text);
  const set = new Set(idx);
  let out = '';
  let open = false;
  for (let i = 0; i < text.length; i++) {
    const m = set.has(i);
    if (m && !open) { out += '<mark>'; open = true; }
    if (!m && open) { out += '</mark>'; open = false; }
    out += escapeHtml(text[i]);
  }
  if (open) out += '</mark>';
  return out;
}
