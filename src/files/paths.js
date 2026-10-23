// Path safety helpers for everything that touches project files.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class FileError extends Error {
  constructor(status, message, extra = null) { super(message); this.status = status; this.extra = extra; }
}

export const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const FORBIDDEN = new Set(['.git', '.agentneuron', '.mdctl', 'node_modules']);

/** Validate and normalise a project-relative POSIX path. Throws FileError(400). */
export function cleanRel(input) {
  if (typeof input !== 'string' || !input) throw new FileError(400, 'path required');
  if (input.includes('\0')) throw new FileError(400, 'invalid path');
  if (input.includes('\\')) throw new FileError(400, 'invalid path');
  if (input.startsWith('/') || /^[A-Za-z]:/.test(input)) throw new FileError(400, 'absolute paths are not allowed');
  const segs = input.split('/');
  if (segs.includes('..')) throw new FileError(400, 'path escapes project root');
  const out = segs.filter((s) => s !== '' && s !== '.');
  if (!out.length) throw new FileError(400, 'path required');
  if (out.some((s) => FORBIDDEN.has(s))) throw new FileError(403, 'path is not accessible');
  return out.join('/');
}

function realRoot(root) {
  try { return fs.realpathSync(root); } catch { return path.resolve(root); }
}

/**
 * Resolve a request path inside root. Rejects absolute / .. / NUL and refuses to
 * traverse any symlink (existing components). Returns { rel, abs }.
 */
export function resolveSafe(root, input) {
  const rel = cleanRel(input);
  const base = realRoot(root);
  let cur = base;
  for (const seg of rel.split('/')) {
    cur = path.join(cur, seg);
    let st;
    try { st = fs.lstatSync(cur); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') break; throw new FileError(400, 'invalid path'); }
    if (st.isSymbolicLink()) throw new FileError(403, 'symlinks are not followed');
  }
  const abs = path.join(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new FileError(400, 'path escapes project root');
  return { rel, abs };
}

/** Atomic write: tmp file in the same directory, then rename. Keeps the mode of an existing file. */
export function atomicWrite(abs, content) {
  const dir = path.dirname(abs);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(abs)}.agentneuron-${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`);
  let mode;
  try { mode = fs.statSync(abs).mode & 0o777; } catch { /* new file */ }
  try {
    fs.writeFileSync(tmp, content, mode ? { mode } : undefined);
    fs.renameSync(tmp, abs);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

/** Write a new file without ever overwriting (hard link trick). Throws EEXIST-> FileError(409). */
export function writeNew(abs, content) {
  const dir = path.dirname(abs);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(abs)}.agentneuron-${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, content);
  try {
    fs.linkSync(tmp, abs);
  } catch (e) {
    if (e.code === 'EEXIST') throw new FileError(409, 'file already exists');
    if (fs.existsSync(abs)) throw new FileError(409, 'file already exists');
    fs.renameSync(tmp, abs);
    return;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

export function readTextIfExists(abs) {
  try {
    const st = fs.lstatSync(abs);
    if (!st.isFile()) return null;
    const buf = fs.readFileSync(abs);
    if (buf.includes(0)) return null;
    return { content: buf.toString('utf8'), hash: crypto.createHash('sha1').update(buf).digest('hex'), mtime: Math.floor(st.mtimeMs) };
  } catch { return null; }
}

export function atomicJson(abs, data) {
  atomicWrite(abs, JSON.stringify(data, null, 2));
}

export function readJson(abs, fallback) {
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { return fallback; }
}

export function agentneuronPath(root, ...parts) { return path.join(realRoot(root), '.agentneuron', ...parts); }
