// `agentneuron update`: check the npm registry and update the way this copy was installed.
// Only runs when asked; nothing ever phones home on `start`.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawn, execFile } from '../core/spawn.js';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../server/version.js';

export const PKG = 'agentneuron';
export const REGISTRY_URL = `https://registry.npmjs.org/${PKG}/latest`;
export const RELEASE_BASE = 'https://github.com/TurjoAt/agentneuron/releases/download';
export const NPM_BASE = `https://registry.npmjs.org/${PKG}`;
const MAX_BUNDLE = 50 * 1024 * 1024;
const MAX_TARBALL = 50 * 1024 * 1024;
const MAX_UNPACKED = 200 * 1024 * 1024;
const MAX_META = 1024 * 1024;
const TAR_ENTRY = 'package/dist/agentneuron.mjs';

/** -1 / 0 / 1. Numeric x.y.z; a pre-release sorts before its release. */
export function compareVersions(a, b) {
  const p = (v) => { const [core, pre = ''] = String(v).trim().replace(/^v/, '').split('-', 2); return [core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre]; };
  const [ca, pa] = p(a), [cb, pb] = p(b);
  for (let i = 0; i < 3; i++) if ((ca[i] || 0) !== (cb[i] || 0)) return (ca[i] || 0) < (cb[i] || 0) ? -1 : 1;
  if (pa === pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  return pa < pb ? -1 : 1;
}

const validVersion = (v) => typeof v === 'string' && /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(v);

async function fetchWithTimeout(fetchFn, url, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetchFn(url, { signal: ac.signal, redirect: 'follow', headers: { 'user-agent': `${PKG}/${VERSION}` } }); } finally { clearTimeout(t); }
}

/** Latest published version, or throws a short message (offline, timeout, bad response). */
export async function fetchLatest({ fetch: fetchFn = globalThis.fetch, timeoutMs = 5000 } = {}) {
  let r;
  try { r = await fetchWithTimeout(fetchFn, REGISTRY_URL, timeoutMs); } catch (e) {
    throw new Error(e?.name === 'AbortError' ? `npm registry did not answer within ${timeoutMs / 1000}s` : 'could not reach the npm registry (offline?)');
  }
  if (!r.ok) throw new Error(`npm registry answered HTTP ${r.status}`);
  let j; try { j = await r.json(); } catch { throw new Error('npm registry sent invalid JSON'); }
  if (!validVersion(j?.version)) throw new Error('npm registry sent no usable version');
  return j.version;
}

const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
const within = (child, parent) => { const r = path.relative(norm(parent), norm(child)); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };

/**
 * How is this copy installed? selfPath = the running script (bundle or src/cli.js).
 * -> 'local' (init copy at <project>/.agentneuron/agentneuron.mjs) | 'npx' | 'global' | 'other'
 */
export function detectInstall(selfPath, { globalRoot = null } = {}) {
  const parts = path.resolve(selfPath).split(/[\\/]+/);
  if (parts[parts.length - 1] === 'agentneuron.mjs' && parts[parts.length - 2] === '.agentneuron') return 'local';
  if (parts.includes('_npx')) return 'npx';
  if (globalRoot && within(selfPath, path.join(globalRoot, PKG))) return 'global';
  return 'other';
}

// core/spawn resolves npm.cmd on Windows and runs it via cmd.exe with escaped arguments (no shell: true).
const npmBin = () => 'npm';
const npmOpts = () => ({ windowsHide: true });

/** `npm root -g`, or null. */
export function npmGlobalRoot({ timeoutMs = 10000 } = {}) {
  return new Promise((resolve) => {
    try {
      execFile(npmBin(), ['root', '-g'], { ...npmOpts(), timeout: timeoutMs, encoding: 'utf8' }, (err, out) => resolve(err ? null : String(out).trim() || null));
    } catch { resolve(null); }
  });
}

/** sha256sum output ("<hex>  agentneuron.mjs") -> lowercase hex, or null. */
export function parseSha256File(text) {
  const tok = String(text || '').trim().split(/\s+/)[0]?.toLowerCase() || '';
  return /^[0-9a-f]{64}$/.test(tok) ? tok : null;
}

// The timer stays armed until the body is read: a server that stalls mid-body must not hang us.
async function download(fetchFn, url, max, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  const fail = (e) => new Error(`download failed: ${url} (${e?.name === 'AbortError' || ac.signal.aborted ? 'timeout' : 'network error'})`);
  try {
    let r;
    try { r = await fetchFn(url, { signal: ac.signal, redirect: 'follow', headers: { 'user-agent': `${PKG}/${VERSION}` } }); } catch (e) { throw fail(e); }
    if (!r.ok) throw Object.assign(new Error(`download failed: ${url} (HTTP ${r.status})`), { status: r.status });
    const len = Number(r.headers?.get?.('content-length'));
    if (Number.isFinite(len) && len > max) throw new Error(`download too large: ${url}`);
    let buf;
    try { buf = Buffer.from(await r.arrayBuffer()); } catch (e) { throw fail(e); }
    if (buf.length > max) throw new Error(`download too large: ${url}`);
    return buf;
  } finally { clearTimeout(t); }
}

const tarStr = (b, off, len) => { const s = b.subarray(off, off + len); const z = s.indexOf(0); return (z < 0 ? s : s.subarray(0, z)).toString('utf8'); };
const tarOctal = (b, off, len) => {
  if (b[off] & 0x80) return NaN; // base-256 sizes are never needed for a bundle
  const s = tarStr(b, off, len).trim();
  return /^[0-7]+$/.test(s) ? Number.parseInt(s, 8) : NaN;
};

/** Minimal ustar reader: returns the contents of regular file `want`, or throws. pax/GNU long-name records are skipped. */
export function tarExtract(tar, want) {
  let off = 0, found = null;
  while (off + 512 <= tar.length) {
    const h = tar.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (tarOctal(h, 148, 8) !== sum) throw new Error('npm tarball is malformed (bad tar header checksum)');
    const size = tarOctal(h, 124, 12);
    if (!Number.isSafeInteger(size)) throw new Error('npm tarball is malformed (bad tar entry size)');
    const type = String.fromCharCode(h[156]);
    const prefix = tarStr(h, 257, 6) === 'ustar' ? tarStr(h, 345, 155) : '';
    const name = prefix ? `${prefix}/${tarStr(h, 0, 100)}` : tarStr(h, 0, 100);
    const start = off + 512;
    if (start + size > tar.length) throw new Error('npm tarball is malformed (truncated entry)');
    if ((type === '0' || type === '\0') && name === want) {
      if (found) throw new Error(`npm tarball is malformed (duplicate ${want})`);
      found = Buffer.from(tar.subarray(start, start + size));
    }
    off = start + Math.ceil(size / 512) * 512;
  }
  if (!found) throw new Error(`npm tarball does not contain ${want}`);
  return found;
}

/** "sha512-<base64>" from an SRI string (several space-separated hashes allowed) -> 64-byte Buffer, or null. */
export function parseSha512Integrity(sri) {
  for (const tok of String(sri || '').trim().split(/\s+/)) {
    const m = /^sha512-([A-Za-z0-9+/]+={0,2})(\?.*)?$/.exec(tok);
    if (!m) continue;
    const b = Buffer.from(m[1], 'base64');
    if (b.length === 64) return b;
  }
  return null;
}

/**
 * Second origin: the npm tarball for `version`. Returns the sha256 of package/dist/agentneuron.mjs,
 * or null when npm has no such version (HTTP 404). Every other problem throws.
 */
export async function npmBundleSha256(version, { fetch: fetchFn = globalThis.fetch, timeoutMs = 60000 } = {}) {
  let meta;
  try { meta = await download(fetchFn, `${NPM_BASE}/${version}`, MAX_META, timeoutMs); } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
  let j; try { j = JSON.parse(meta.toString('utf8')); } catch { throw new Error('npm registry sent invalid JSON'); }
  if (j?.name !== PKG || j?.version !== version) throw new Error('npm registry metadata does not match the requested version');
  let u; try { u = new URL(String(j.dist?.tarball)); } catch { throw new Error('npm registry sent no usable tarball URL'); }
  if (u.protocol !== 'https:' || u.hostname !== 'registry.npmjs.org' || u.username || u.password) throw new Error(`npm tarball URL is not on https://registry.npmjs.org: ${u.origin}`);
  const want = parseSha512Integrity(j.dist?.integrity);
  if (!want) throw new Error('npm registry sent no sha512 integrity for the tarball');
  const tgz = await download(fetchFn, u.href, MAX_TARBALL, timeoutMs);
  if (!crypto.createHash('sha512').update(tgz).digest().equals(want)) throw new Error('npm tarball does not match its registry integrity (sha512); nothing was changed');
  let tar;
  try { tar = zlib.gunzipSync(tgz, { maxOutputLength: MAX_UNPACKED }); } catch (e) {
    throw new Error(e?.code === 'ERR_BUFFER_TOO_LARGE' || e instanceof RangeError ? 'npm tarball unpacks too large' : 'npm tarball is malformed (gzip)');
  }
  return crypto.createHash('sha256').update(tarExtract(tar, TAR_ENTRY)).digest('hex');
}

/**
 * Replace an init copy with the release bundle for `version`. Verifies the GitHub asset against its
 * .sha256 and against the bundle inside the npm tarball (itself checked against the registry's sha512
 * integrity); only if npm has no such version and allowUnverified is set does the GitHub check alone
 * suffice. Writes a temp file next to the target and renames it over; the previous copy is kept as <target>.bak.
 */
export async function updateLocalCopy(target, version, { fetch: fetchFn = globalThis.fetch, timeoutMs = 60000, allowUnverified = false, warn = () => {} } = {}) {
  if (!validVersion(version)) throw new Error('bad version');
  const base = `${RELEASE_BASE}/v${version}/agentneuron.mjs`;
  const [bundle, shaText] = await Promise.all([download(fetchFn, base, MAX_BUNDLE, timeoutMs), download(fetchFn, `${base}.sha256`, 4096, timeoutMs)]);
  const want = parseSha256File(shaText.toString('utf8'));
  if (!want) throw new Error('release checksum file is malformed');
  const got = crypto.createHash('sha256').update(bundle).digest('hex');
  if (got !== want) throw new Error(`checksum mismatch (expected ${want.slice(0, 12)}..., got ${got.slice(0, 12)}...); nothing was changed`);
  const npmSha = await npmBundleSha256(version, { fetch: fetchFn, timeoutMs });
  if (npmSha === null) {
    if (!allowUnverified) throw new Error(`npm has no ${PKG}@${version} to cross-check the GitHub release against; nothing was changed (retry later, or pass --allow-unverified to trust the GitHub release alone)`);
    warn(`agentneuron: warning: npm has no ${PKG}@${version}; --allow-unverified: installing with the GitHub release checksum only (one origin)`);
  } else if (npmSha !== got) {
    throw new Error(`GitHub release and npm tarball disagree (github ${got.slice(0, 12)}..., npm ${npmSha.slice(0, 12)}...); nothing was changed`);
  }
  const tmp = path.join(path.dirname(target), `.agentneuron.mjs.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, bundle, { mode: 0o755, flag: 'wx' });
    fs.copyFileSync(target, `${target}.bak`);
    fs.renameSync(tmp, target);
    try { fs.chmodSync(target, 0o755); } catch { /* Windows */ }
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* not created */ }
    throw e;
  }
  return { target, backup: `${target}.bak`, sha256: got, npmVerified: npmSha !== null };
}

/** Ask y/N on a TTY. Without a TTY the answer is no (use --yes). */
export async function askYesNo(question, { input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY) return false;
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input, output });
  try { return await new Promise((res) => rl.question(`${question} [y/N] `, (a) => res(/^y(es)?$/i.test(a.trim())))); } finally { rl.close(); }
}

function runNpmInstall(log) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(npmBin(), ['install', '-g', `${PKG}@latest`], { ...npmOpts(), stdio: 'inherit' }); } catch (e) { log.error(`could not start npm: ${e.message}`); return resolve(1); }
    const t = setTimeout(() => { try { child.kill(); } catch {} }, 5 * 60000);
    child.on('error', (e) => { clearTimeout(t); log.error(`could not start npm: ${e.code || e.message}`); resolve(1); });
    child.on('exit', (code) => { clearTimeout(t); resolve(code ?? 1); });
  });
}

/** CLI entry. deps are injectable for tests. Returns an exit code. */
export async function cmdUpdate(flags, deps = {}) {
  const log = deps.log || console;
  const current = deps.current || VERSION;
  const fetchFn = deps.fetch || globalThis.fetch;
  let latest;
  try { latest = await fetchLatest({ fetch: fetchFn, timeoutMs: deps.timeoutMs ?? 5000 }); } catch (e) {
    log.error(`agentneuron: update check failed: ${e.message}`);
    return 1;
  }
  const cmp = compareVersions(current, latest);
  const upToDate = () => `agentneuron ${current} is ${cmp > 0 ? 'newer than' : 'up to date with'} the latest release (${latest})`;
  if (flags.check) {
    if (cmp < 0) log.log(`update available: ${current} -> ${latest}  (run: agentneuron update)`);
    else log.log(upToDate());
    return 0;
  }
  if (cmp >= 0) { log.log(upToDate()); return 0; }

  const self = deps.selfPath || fileURLToPath(import.meta.url);
  let mode = detectInstall(self);
  if (mode === 'other') mode = detectInstall(self, { globalRoot: deps.globalRoot !== undefined ? deps.globalRoot : await npmGlobalRoot() });
  const confirm = deps.confirm || askYesNo;
  const ok = async (what) => {
    if (flags.yes || flags.y) return true;
    if (await confirm(`${what}?`)) return true;
    log.log(process.stdin.isTTY || deps.confirm ? 'cancelled' : 'not a terminal: re-run with --yes to confirm');
    return false;
  };

  if (mode === 'local') {
    if (!(await ok(`Replace ${self} with agentneuron ${latest} (GitHub release, sha256-verified and cross-checked against npm)`))) return 1;
    try {
      const r = await updateLocalCopy(self, latest, { fetch: fetchFn, allowUnverified: !!flags['allow-unverified'], warn: (m) => log.error(m) });
      log.log(`updated ${r.target} to ${latest} (sha256 ${r.sha256.slice(0, 12)}..., ${r.npmVerified ? 'matches npm' : 'GitHub only'}); previous copy: ${path.basename(r.backup)}`);
      return 0;
    } catch (e) { log.error(`agentneuron: update failed: ${e.message}`); return 1; }
  }
  if (mode === 'global') {
    if (!(await ok(`Run "npm install -g ${PKG}@latest" (${current} -> ${latest})`))) return 1;
    const code = await (deps.npmInstall || runNpmInstall)(log);
    if (code !== 0) log.error(`agentneuron: npm exited with ${code}. If it was a permissions error, use a user-writable npm prefix or a Node version manager rather than sudo.`);
    else log.log(`updated to ${latest}`);
    return code === 0 ? 0 : 1;
  }
  log.log(`agentneuron ${latest} is available (running ${current}).`);
  log.log(mode === 'npx'
    ? `Running via npx: use "npx ${PKG}@latest <command>" to get the latest version.`
    : `Not a global npm install or an init copy. Update with "npm install -g ${PKG}@latest", or run "npx ${PKG}@latest <command>".`);
  return 0;
}
