import { execFile } from 'node:child_process';
import path from 'node:path';

export const US = '\x1f';
export const RS = '\x1e';
export const MAX_PATCH = 400 * 1024;

/**
 * Run git (never a shell). Resolves { ok, code, out, err }; never rejects.
 * Options: `env` adds variables (e.g. GIT_INDEX_FILE); `encoding: 'buffer'` returns `out` as a Buffer (binary blobs).
 */
export function runGit(cwd, args, { timeout = 15000, maxBuffer = 64 * 1024 * 1024, env = null, encoding = 'utf8' } = {}) {
  return new Promise((resolve) => {
    try {
      execFile('git', args, {
        cwd, timeout, maxBuffer, windowsHide: true, encoding,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', ...(env || {}) },
      }, (err, stdout, stderr) => {
        const out = encoding === 'buffer' ? (Buffer.isBuffer(stdout) ? stdout : Buffer.alloc(0)) : typeof stdout === 'string' ? stdout : '';
        const e = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : typeof stderr === 'string' ? stderr : '';
        if (err) return resolve({ ok: false, code: typeof err.code === 'number' ? err.code : -1, out, err: e || String(err.message || '') });
        resolve({ ok: true, code: 0, out, err: e });
      });
    } catch (e) {
      resolve({ ok: false, code: -1, out: '', err: String(e.message || e) });
    }
  });
}

/** Validate a project-relative path from a request. Returns normalized POSIX path or null. */
export function cleanRelPath(root, p) {
  if (typeof p !== 'string' || !p || p.includes('\0')) return null;
  p = p.replace(/\\/g, '/');
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').includes('..')) return null;
  if (p.startsWith('-') ) p = './' + p;
  const abs = path.resolve(root, p);
  const r = path.relative(root, abs);
  if (r.startsWith('..') || path.isAbsolute(r)) return null;
  return p;
}

/** Validate a branch/ref-like name using git itself. */
export async function validRefName(root, name) {
  if (typeof name !== 'string' || !name || name.length > 255 || name.startsWith('-') || name.includes('\0')) return false;
  if (name.includes('@{')) return false;
  const r = await runGit(root, ['check-ref-format', '--branch', name], { timeout: 5000 });
  return r.ok;
}

/** Validate a revision expression (hash, tag, HEAD~2...). */
export function validRev(rev) {
  return typeof rev === 'string' && rev.length <= 255 && /^[\w./@^~{}-]+$/.test(rev) && !rev.startsWith('-') && !rev.includes('..');
}
