// Minimal YAML-frontmatter reader (flat keys, inline/block lists, quoted strings, booleans).
export function parseFrontmatter(text) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text || '');
  if (!m) return { data: {}, body: text || '', has: false };
  const data = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const key = kv[1];
    let raw = kv[2].trim();
    if (raw === '' || raw === '|' || raw === '>' || raw === '|-' || raw === '>-') {
      const items = [];
      const block = [];
      while (i + 1 < lines.length && /^(\s+|-\s)/.test(lines[i + 1]) ) {
        i++;
        const l = lines[i];
        const li = /^\s*-\s+(.*)$/.exec(l);
        if (li) items.push(scalar(li[1]));
        else block.push(l.trim());
      }
      data[key] = items.length ? items : block.length ? block.join(' ') : '';
      continue;
    }
    data[key] = value(raw);
  }
  return { data, body: text.slice(m[0].length), has: true };
}

function scalar(s) {
  s = s.trim();
  const q = /^"((?:[^"\\]|\\.)*)"$/.exec(s);
  if (q) { try { return JSON.parse(`"${q[1]}"`); } catch { return q[1]; } }
  const sq = /^'((?:[^']|'')*)'$/.exec(s);
  if (sq) return sq[1].replace(/''/g, "'");
  if (s === 'true') return true;
  if (s === 'false') return false;
  return s.replace(/\s+#\s.*$/, '');
}

function value(raw) {
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1);
    const out = [];
    const re = /\s*("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,]+)\s*(?:,|$)/g;
    let m;
    while ((m = re.exec(inner)) && m[0] !== '') { out.push(scalar(m[1])); if (re.lastIndex >= inner.length) break; }
    return out;
  }
  return scalar(raw);
}

/** Normalise a frontmatter value into a string list (comma separated string or array). */
export function toList(v) {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return String(v).split(',').map((x) => x.trim()).filter(Boolean);
}
