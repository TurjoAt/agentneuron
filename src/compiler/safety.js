// Path and value validation for the rules compiler, plus confined I/O for the rules directory
// (which usually lives in .agentneuron/, outside what the file ops / store may touch).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readRegular } from '../files/safeio.js';
import { atomicWrite, writeNew, FileError } from '../files/paths.js';

export const DEFAULT_RULES_DIR = '.agentneuron/rules';
export const MAX_RULES = 500;
export const MAX_RULE_BYTES = 256 * 1024;
const SEG = /^[A-Za-z0-9_@+-][A-Za-z0-9_.@+-]*$/;
const DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
export const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
export const lf = (s) => String(s ?? '').replace(/\r\n?/g, '\n');

export function validSlug(s) { return typeof s === 'string' && SLUG.test(s) && !DEVICE.test(s); }

/** Turn free text into a safe slug (never empty, never a Windows device name). */
export function slugify(s) {
  let out = String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
  if (!out) out = 'rule';
  if (DEVICE.test(out)) out = `rule-${out}`;
  return out;
}

/**
 * A scope glob is written into YAML frontmatter and markdown: allow a conservative charset only.
 * Commas only inside {a,b} (the outer list is comma separated in Cursor/Copilot/Windsurf).
 */
export function globError(g) {
  if (typeof g !== 'string' || !g) return 'empty glob';
  if (g.length > 200) return 'glob too long';
  if (!/^[A-Za-z0-9_.\-/*?{}[\]!@+,]+$/.test(g)) return `glob has unsupported characters: ${JSON.stringify(g).slice(0, 80)}`;
  if (g.startsWith('/') || /^[A-Za-z]:/.test(g)) return 'glob must be project-relative';
  if (g.split('/').some((s) => s === '..' || s === '.')) return 'glob must not contain . or .. segments';
  let depth = 0;
  for (const c of g) {
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === ',' && depth <= 0) return 'commas are only allowed inside {braces}';
    if (depth < 0) return 'unbalanced braces';
  }
  return depth ? 'unbalanced braces' : null;
}

/** Single-line, length-capped text safe for headings and quoted YAML. */
export function cleanText(s, max = 200) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/<!--|--!?>/g, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

const realRoot = (root) => { try { return fs.realpathSync(root); } catch { return path.resolve(root); } };
const inside = (p, root) => p === root || p.startsWith(root + path.sep);

/** Validated project-relative rules dir (config.compiler.rulesDir, default .agentneuron/rules). */
export function rulesDirRel(config) {
  const raw = config?.compiler?.rulesDir ?? DEFAULT_RULES_DIR;
  if (typeof raw !== 'string' || !raw || raw.length > 200) throw new FileError(400, 'compiler.rulesDir must be a project-relative path');
  const segs = raw.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.');
  if (!segs.length || /^[A-Za-z]:/.test(raw) || raw.startsWith('/') || segs.some((s) => s === '..' || !SEG.test(s.replace(/^\./, '')) || s === '.git' || s === 'node_modules')) {
    throw new FileError(400, 'compiler.rulesDir must be a plain project-relative directory');
  }
  return segs.join('/');
}

/** Absolute rules dir; refuses symlinked components and anything resolving outside the root. */
export function rulesDirAbs(root, config) {
  const rel = rulesDirRel(config);
  const base = realRoot(root);
  let cur = base;
  for (const seg of rel.split('/')) {
    cur = path.join(cur, seg);
    let st;
    try { st = fs.lstatSync(cur); } catch { break; }
    if (st.isSymbolicLink()) throw new FileError(403, 'the rules directory must not be (or sit under) a symlink');
    if (!st.isDirectory()) throw new FileError(400, `${rel} is not a directory`);
  }
  const abs = path.join(base, rel);
  if (!inside(abs, base)) throw new FileError(400, 'rules directory escapes the project root');
  return { rel, abs, base };
}

/** -> [{ slug, name, text, hash, error? }] for every *.md directly inside the rules dir (no recursion, no symlinks). */
export function readRuleFiles(root, config) {
  const { abs, base } = rulesDirAbs(root, config);
  let ents;
  try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of ents.filter((x) => /\.md$/i.test(x.name) && !/^readme\.md$/i.test(x.name)).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (out.length >= MAX_RULES) break;
    const slug = e.name.replace(/\.md$/i, '');
    if (!e.isFile()) { out.push({ slug, name: e.name, error: 'not a regular file (symlinks are not followed)' }); continue; }
    if (!validSlug(slug) || !e.name.endsWith('.md')) { out.push({ slug, name: e.name, error: 'file name must be a lowercase slug: a-z, 0-9 and dashes, ending in .md' }); continue; }
    const r = readRegular(path.join(abs, e.name), { maxBytes: MAX_RULE_BYTES, confine: base });
    if (!r) { out.push({ slug, name: e.name, error: `unreadable or larger than ${MAX_RULE_BYTES} bytes` }); continue; }
    const text = r.buf.toString('utf8');
    out.push({ slug, name: e.name, text, hash: sha(r.buf) });
  }
  return out;
}

/**
 * Write <rulesDir>/<slug>.md. `baseHash` (sha1 of the current bytes) is required to overwrite;
 * without it the file must not exist yet. Throws FileError(409) on a conflict.
 */
export function writeRuleFile(root, config, slug, content, { baseHash = null } = {}) {
  if (!validSlug(slug)) throw new FileError(400, 'invalid rule slug');
  if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_RULE_BYTES) throw new FileError(413, 'rule content missing or too large');
  const { abs: dir, base } = rulesDirAbs(root, config);
  fs.mkdirSync(dir, { recursive: true });
  if (!inside(fs.realpathSync(dir), base)) throw new FileError(403, 'rules directory escapes the project root');
  const abs = path.join(dir, `${slug}.md`);
  let st = null;
  try { st = fs.lstatSync(abs); } catch { /* new */ }
  if (st && !st.isFile()) throw new FileError(403, 'not a regular file');
  if (!st) {
    if (baseHash) throw new FileError(409, 'rule was deleted on disk', { conflict: true });
    writeNew(abs, content);
    return { slug, hash: sha(content), created: true };
  }
  const cur = readRegular(abs, { maxBytes: MAX_RULE_BYTES, confine: base });
  if (!cur) throw new FileError(415, 'unreadable rule file');
  if (!baseHash || baseHash !== sha(cur.buf)) throw new FileError(409, 'rule changed on disk', { conflict: true, current: cur.buf.toString('utf8'), currentHash: sha(cur.buf) });
  atomicWrite(abs, content);
  return { slug, hash: sha(content), created: false };
}
