// Small shared helpers for project detectors (no deps, no shell).
import fs from 'node:fs';
import path from 'node:path';

const binCache = new Map();
/** True if an executable named `bin` exists on PATH (sync, cached 60 s). */
export function hasBinary(bin) {
  const c = binCache.get(bin);
  if (c && Date.now() - c.ts < 60000) return c.ok;
  let ok = false;
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const e of exts) {
      try {
        const p = path.join(dir, bin + e);
        if (fs.statSync(p).isFile()) { fs.accessSync(p, fs.constants.X_OK); ok = true; break; }
      } catch { /* next */ }
    }
    if (ok) break;
  }
  binCache.set(bin, { ok, ts: Date.now() });
  return ok;
}

export function stack(id, name, category, { version = null, confidence = 0.9, source = null } = {}) {
  return { id, name, version: version ? String(version) : null, category, confidence, source };
}

export function cleanVersion(v) {
  if (v == null) return null;
  const m = /\d+(?:\.\d+)*(?:[-+.\w]*)?/.exec(String(v));
  return m ? m[0] : String(v);
}

/** Split `str` on `sep` at nesting depth 0, outside string literals. */
export function splitTop(str, sep = ',') {
  const out = []; let depth = 0; let q = null; let cur = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (q) {
      cur += ch;
      if (ch === '\\') { cur += str[++i] ?? ''; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (depth === 0 && str.startsWith(sep, i)) { out.push(cur); cur = ''; i += sep.length - 1; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function stripTomlComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '\\' && q === '"') i++; else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === '#') return line.slice(0, i);
  }
  return line;
}
function splitKey(k) {
  const parts = []; let cur = ''; let q = null;
  for (const ch of k.trim()) {
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === '.') { parts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur.trim());
  return parts;
}
function tomlVal(s) {
  s = s.trim();
  let m;
  if ((m = /^"((?:\\.|[^"\\])*)"$/.exec(s))) return m[1].replace(/\\(["\\])/g, '$1');
  if ((m = /^'([^']*)'$/.exec(s))) return m[1];
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^[+-]?\d[\d_]*(\.\d+)?$/.test(s)) return Number(s.replace(/_/g, ''));
  if (s.startsWith('[') && s.endsWith(']')) return splitTop(s.slice(1, -1)).map((x) => x.trim()).filter(Boolean).map(tomlVal);
  if (s.startsWith('{') && s.endsWith('}')) {
    const o = {};
    for (const it of splitTop(s.slice(1, -1))) {
      const i = it.indexOf('=');
      if (i > 0) setPath(o, splitKey(it.slice(0, i)), tomlVal(it.slice(i + 1)));
    }
    return o;
  }
  return s;
}
function setPath(obj, keys, val) {
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof o[keys[i]] !== 'object' || o[keys[i]] === null) o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = val;
}
const unbalanced = (v) => {
  let d = 0; let q = null;
  for (const ch of v) {
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === '[' || ch === '{') d++;
    else if (ch === ']' || ch === '}') d--;
  }
  return d > 0;
};

/** Minimal tolerant TOML parser (enough for pyproject.toml / Cargo.toml). */
export function parseToml(text) {
  const out = {}; let cur = out;
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = stripTomlComment(lines[i]).trim();
    if (!line) continue;
    let m;
    if ((m = /^\[\[(.+)\]\]$/.exec(line))) {
      const keys = splitKey(m[1]);
      let o = out;
      for (let k = 0; k < keys.length - 1; k++) { o[keys[k]] ??= {}; o = Array.isArray(o[keys[k]]) ? o[keys[k]].at(-1) : o[keys[k]]; }
      const last = keys.at(-1);
      if (!Array.isArray(o[last])) o[last] = [];
      cur = {}; o[last].push(cur);
    } else if ((m = /^\[(.+)\]$/.exec(line))) {
      const keys = splitKey(m[1]);
      let o = out;
      for (const k of keys) { if (typeof o[k] !== 'object' || o[k] === null) o[k] = {}; o = Array.isArray(o[k]) ? o[k].at(-1) : o[k]; }
      cur = o;
    } else if ((m = /^([A-Za-z0-9_."'-]+)\s*=\s*(.*)$/.exec(line))) {
      let val = m[2];
      while (unbalanced(val) && i + 1 < lines.length) val += ' ' + stripTomlComment(lines[++i]).trim();
      setPath(cur, splitKey(m[1]), tomlVal(val));
    }
  }
  return out;
}

/** KEY names from a dotenv-style text. Values are never read into the result. */
export function envKeys(text) {
  const keys = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=/.exec(line);
    if (m) keys.push(m[1]);
  }
  return [...new Set(keys)];
}

export const posix = (p) => p.split(path.sep).join('/');
