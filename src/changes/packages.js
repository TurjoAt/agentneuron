// #9 Package hallucination guard. Offline by default: manifests + lockfiles + a bundled popular-name list.
// Online lookups (registry + OSV) only when the caller passes `online: true` (config packages.online, admin-only
// in the server), cached under .agentneuron/cache/packages/, 5 s timeout per request.
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { detectProject } from '../project/index.js';
import { readRegularAsync } from '../files/safeio.js';
import { levenshtein } from '../files/fuzzy.js';
import { validateName, validateVersion, MANAGERS } from '../actions/packages.js';
import { POPULAR, ECOSYSTEM, KNOWN_SCOPES } from './popular.js';

const MAX_LOCK = 40 * 1024 * 1024;
const TTL = 24 * 3600 * 1000;
const TIMEOUT = 5000;
const MAX_ONLINE = 25;
const SETS = Object.fromEntries(Object.entries(POPULAR).map(([k, v]) => [k, new Set(v)]));
const RANK = { high: 3, medium: 2, low: 1 };

export const ecosystemOf = (manager) => ECOSYSTEM[manager] || null;
export const pyNorm = (n) => String(n).toLowerCase().replace(/[-_.]+/g, '-');
const keyName = (eco, n) => (eco === 'pypi' ? pyNorm(n) : String(n).toLowerCase());
const delim = (n) => n.toLowerCase().replace(/[-_.]+/g, '');

/** Popular package a name imitates -> { target, code, severity, message } | null. */
export function lookalike(name, eco) {
  const set = SETS[eco];
  if (!set || !name) return null;
  const n = keyName(eco, name);
  if (set.has(n) || [...set].some((p) => keyName(eco, p) === n)) return null;
  // the same name with other separators: lodash_es vs lodash-es
  for (const p of set) if (delim(p) === delim(n) && p.length > 3) return { target: p, code: 'lookalike', severity: 'high', message: `Looks like "${p}" with different separators` };
  if (eco === 'npm' && n.startsWith('@')) {
    const [scope, base] = n.split('/');
    if (base && set.has(base) && !KNOWN_SCOPES.has(scope)) return { target: base, code: 'scope-lookalike', severity: 'medium', message: `Scoped copy of the popular package "${base}" under an unknown scope ${scope}` };
  }
  const bare = eco === 'packagist' ? n : n.replace(/^@[^/]+\//, '');
  // "-js" style clones: lodash-js, node-axios, express.js
  const stripped = bare.replace(/^(node-|js-|py-|python-|php-)/, '').replace(/([-.]js|-node|-py|-python|-php|-official|-lib|-pkg|-sdk|js)$/, '');
  if (stripped !== bare && stripped.length >= 3) {
    for (const p of set) if ((eco === 'packagist' ? p : p.replace(/^@[^/]+\//, '')) === stripped) return { target: p, code: 'suffix-clone', severity: 'medium', message: `Name adds a prefix/suffix to the popular package "${p}"` };
  }
  if (n.length < 4) return null;
  const max = n.length >= 8 ? 2 : 1;
  let best = null, bd = Infinity;
  for (const p of set) {
    if (Math.abs(p.length - n.length) > max) continue;
    const d = levenshtein(n, keyName(eco, p));
    if (d <= max && d < bd) { best = p; bd = d; }
  }
  if (best) return { target: best, code: 'lookalike', severity: 'high', message: `One or two letters away from the popular package "${best}" (possible typosquat)` };
  // transposed letters
  const sorted = [...n].sort().join('');
  for (const p of set) if (p.length === n.length && [...keyName(eco, p)].sort().join('') === sorted) return { target: p, code: 'lookalike', severity: 'high', message: `Same letters as the popular package "${p}" in another order` };
  return null;
}

/** Version spec problems -> [{ code, severity, message, fix }] */
export function versionIssues(eco, version) {
  const v = String(version ?? '').trim();
  const out = [];
  if (/^(git\+|git:|github:|gitlab:|bitbucket:)|^https?:\/\/|^[\w-]+\/[\w.-]+(#.*)?$/.test(v) || /^dev-/.test(v) && eco === 'packagist') {
    out.push({ code: 'url-dep', severity: 'medium', message: 'Installed from a git repository / URL instead of the registry', fix: 'Prefer a published registry version so the lockfile pins an integrity hash.' });
  } else if (/^(file|link|portal):/.test(v)) {
    out.push({ code: 'local-dep', severity: 'low', message: 'Installed from a local path', fix: 'Fine for workspaces; make sure the path is part of the repository.' });
  } else if (v === '*' || v === '' || v === 'latest' || v === 'x' || v === 'next' || /^\*$/.test(v)) {
    out.push({ code: 'unpinned', severity: eco === 'pypi' ? 'low' : 'medium', message: v === 'latest' || v === 'next' ? `Tracks the "${v}" tag: any new release is installed` : 'Any version is accepted', fix: 'Pin a version range (e.g. ^1.2.3) so a compromised new release is not picked up silently.' });
  } else if (/^>=?\s*[\d.]+$/.test(v)) {
    out.push({ code: 'unpinned', severity: 'low', message: 'Open-ended range (no upper bound)', fix: 'Add an upper bound or use ^/~ ranges.' });
  }
  return out;
}

// ---- lockfiles -------------------------------------------------------------------

async function readText(root, rel) {
  const r = await readRegularAsync(path.join(root, rel), { maxBytes: MAX_LOCK });
  return r ? r.buf.toString('utf8') : null;
}

/** Parse the lockfiles at the project root -> { npm?: Lock, packagist?: Lock, pypi?: Lock }; Lock = { file, names:Set, scripts:[name], sources:[{name, url}] } */
const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'composer.lock', 'Pipfile.lock', 'poetry.lock', 'uv.lock'];
const lockCache = new Map(); // root -> { sig, p }
/** Parsed lockfiles, re-read only when one of them changes (mtime + size). */
export async function readLockfiles(root) {
  const sig = (await Promise.all(LOCKFILES.map((f) => fsp.stat(path.join(root, f)).then((st) => `${f}:${st.mtimeMs}:${st.size}`, () => '')))).join('|');
  const c = lockCache.get(root);
  if (c && c.sig === sig) return c.p;
  const p = readLockfilesUncached(root);
  lockCache.set(root, { sig, p });
  p.catch(() => lockCache.delete(root));
  if (lockCache.size > 20) lockCache.delete(lockCache.keys().next().value);
  return p;
}

async function readLockfilesUncached(root) {
  const out = {};
  const npmLock = (file) => (out.npm ||= { file, names: new Set(), scripts: [], sources: [] });
  const pl = await readText(root, 'package-lock.json') ?? await readText(root, 'npm-shrinkwrap.json');
  if (pl) {
    try {
      const j = JSON.parse(pl);
      const L = npmLock('package-lock.json');
      for (const [k, v] of Object.entries(j.packages || {})) {
        if (!k) continue;
        const i = k.lastIndexOf('node_modules/');
        const name = i >= 0 ? k.slice(i + 13) : (v && v.name) || null;
        if (!name || !v || typeof v !== 'object' || v.link) continue;
        L.names.add(name.toLowerCase());
        if (v.hasInstallScript) L.scripts.push(name);
        if (typeof v.resolved === 'string' && !/^https:\/\/registry\.(npmjs\.org|yarnpkg\.com)\//.test(v.resolved) && !v.resolved.startsWith('file:')) L.sources.push({ name, url: v.resolved });
      }
      const walk = (deps) => { for (const [n, v] of Object.entries(deps || {})) { L.names.add(n.toLowerCase()); if (v && typeof v === 'object') walk(v.dependencies); } };
      if (!j.packages) walk(j.dependencies);
    } catch { /* unreadable lockfile: no lock checks */ }
  }
  const pn = await readText(root, 'pnpm-lock.yaml');
  if (pn) {
    const L = npmLock('pnpm-lock.yaml');
    let section = null, cur = null;
    for (const line of pn.split(/\r?\n/)) {
      if (/^\S/.test(line)) { section = line.replace(/:.*$/, ''); cur = null; continue; }
      if (section === 'packages' || section === 'snapshots') {
        const m = /^ {2}['"]?\/?((?:@[^/@\s'"]+\/)?[^@\s'"/(]+)@[^:]*['"]?:\s*$/.exec(line);
        if (m) { cur = m[1]; L.names.add(cur.toLowerCase()); continue; }
        if (cur && /^ {4}requiresBuild: true/.test(line) && !L.scripts.includes(cur)) L.scripts.push(cur);
        const t = cur && /^ {4}resolution: \{.*tarball: ['"]?([^,'"}\s]+)/.exec(line);
        if (t && !/registry\.(npmjs\.org|yarnpkg\.com)/.test(t[1])) L.sources.push({ name: cur, url: t[1] });
      }
    }
  }
  const yl = await readText(root, 'yarn.lock');
  if (yl) {
    const L = npmLock('yarn.lock');
    for (const line of yl.split(/\r?\n/)) {
      if (!line || /^[\s#]/.test(line) || !line.endsWith(':')) continue;
      for (let spec of line.slice(0, -1).split(',')) {
        spec = spec.trim().replace(/^"|"$/g, '');
        const at = spec.indexOf('@', 1);
        if (at > 0) L.names.add(spec.slice(0, at).toLowerCase());
      }
    }
  }
  const cl = await readText(root, 'composer.lock');
  if (cl) {
    try {
      const j = JSON.parse(cl);
      const L = (out.packagist = { file: 'composer.lock', names: new Set(), scripts: [], sources: [] });
      for (const p of [...(j.packages || []), ...(j['packages-dev'] || [])]) {
        if (!p?.name) continue;
        L.names.add(String(p.name).toLowerCase());
        const u = p.dist?.url || '';
        if (u && !/^https:\/\/(api\.github\.com|codeload\.github\.com|repo\.packagist\.org|gitlab\.com|bitbucket\.org)\//.test(u)) L.sources.push({ name: p.name, url: u });
      }
    } catch { /* ignore */ }
  }
  for (const file of ['poetry.lock', 'uv.lock']) {
    const t = await readText(root, file);
    if (!t) continue;
    const L = (out.pypi ||= { file, names: new Set(), scripts: [], sources: [] });
    for (const m of t.matchAll(/^\[\[package\]\]\s*\nname\s*=\s*"([^"]+)"/gm)) L.names.add(pyNorm(m[1]));
  }
  const pf = await readText(root, 'Pipfile.lock');
  if (pf) {
    try {
      const j = JSON.parse(pf);
      const L = (out.pypi ||= { file: 'Pipfile.lock', names: new Set(), scripts: [], sources: [] });
      for (const k of ['default', 'develop']) for (const n of Object.keys(j[k] || {})) L.names.add(pyNorm(n));
    } catch { /* ignore */ }
  }
  return out;
}

// ---- online (opt-in) -------------------------------------------------------------

const OSV_ECO = { npm: 'npm', pypi: 'PyPI', packagist: 'Packagist' };

async function fetchJson(fetchImpl, url, init = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': 'agentneuron', ...(init.headers || {}) } });
    if (res.status === 404) return { status: 404, body: null };
    if (!res.ok) return { status: res.status, body: null, error: `HTTP ${res.status}` };
    const len = Number(res.headers?.get?.('content-length') || 0);
    if (len > 40 * 1024 * 1024) return { status: res.status, body: null, error: 'response too large' };
    return { status: res.status, body: await res.json() };
  } finally { clearTimeout(t); }
}

/** Registry + OSV facts for one package -> { exists, latest, createdAt, maintainers, deprecated, advisories, error? } (cached 24 h). */
export async function registryInfo(root, eco, name, version, { fetchImpl = globalThis.fetch, now = Date.now(), cacheOnly = false } = {}) {
  const dir = path.join(root, '.agentneuron', 'cache', 'packages');
  const key = `${eco}__${crypto.createHash('sha1').update(`${name}@${version || ''}`).digest('hex').slice(0, 16)}.json`;
  const file = path.join(dir, key);
  try {
    const c = JSON.parse(await fsp.readFile(file, 'utf8'));
    if (c && now - c.ts < TTL && c.name === name) return { ...c.data, cached: true };
  } catch { /* miss */ }
  if (cacheOnly) return null;
  if (typeof fetchImpl !== 'function') return { error: 'fetch is not available in this Node version' };
  const info = { exists: null, latest: null, createdAt: null, maintainers: null, deprecated: null, advisories: [] };
  try {
    if (eco === 'npm') {
      const r = await fetchJson(fetchImpl, `https://registry.npmjs.org/${name.replace('/', '%2F')}`);
      info.exists = r.status === 404 ? false : r.body ? true : null;
      if (r.body) {
        const latest = r.body['dist-tags']?.latest || null;
        info.latest = latest;
        info.createdAt = r.body.time?.created || null;
        info.maintainers = Array.isArray(r.body.maintainers) ? r.body.maintainers.length : null;
        const dep = latest && r.body.versions?.[latest]?.deprecated;
        info.deprecated = typeof dep === 'string' ? dep.slice(0, 300) : null;
      }
      if (r.error) info.error = r.error;
    } else if (eco === 'pypi') {
      const r = await fetchJson(fetchImpl, `https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
      info.exists = r.status === 404 ? false : r.body ? true : null;
      if (r.body) {
        info.latest = r.body.info?.version || null;
        let first = null;
        for (const files of Object.values(r.body.releases || {})) for (const f of files || []) if (f.upload_time_iso_8601 && (!first || f.upload_time_iso_8601 < first)) first = f.upload_time_iso_8601;
        info.createdAt = first;
        info.maintainers = [r.body.info?.author, r.body.info?.maintainer].filter(Boolean).length || null;
        info.deprecated = r.body.info?.yanked ? 'yanked' : null;
      }
      if (r.error) info.error = r.error;
    } else if (eco === 'packagist') {
      const r = await fetchJson(fetchImpl, `https://repo.packagist.org/p2/${name}.json`);
      info.exists = r.status === 404 ? false : r.body ? true : null;
      const vs = r.body?.packages?.[name];
      if (Array.isArray(vs) && vs.length) {
        info.latest = vs[0].version || null;
        info.createdAt = vs[vs.length - 1].time || null;
        info.deprecated = vs[0].abandoned ? (typeof vs[0].abandoned === 'string' ? `abandoned, use ${vs[0].abandoned}` : 'abandoned') : null;
      }
      if (r.error) info.error = r.error;
    }
    if (info.exists && OSV_ECO[eco]) {
      const r = await fetchJson(fetchImpl, 'https://api.osv.dev/v1/query', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ package: { name, ecosystem: OSV_ECO[eco] }, ...(version && /^\d[\w.+-]*$/.test(version) ? { version } : {}) }) });
      info.advisories = (r.body?.vulns || []).slice(0, 20).map((v) => ({ id: String(v.id || ''), summary: String(v.summary || '').slice(0, 200) }));
    }
  } catch (e) {
    info.error = e?.name === 'AbortError' ? 'timed out after 5 s' : String(e?.message || e).slice(0, 200);
  }
  if (!info.error) {
    try { await fsp.mkdir(dir, { recursive: true }); await fsp.writeFile(file, JSON.stringify({ ts: now, name, data: info })); } catch { /* cache is optional */ }
  }
  return info;
}

function onlineReasons(info, now = Date.now()) {
  const out = [];
  if (!info) return out;
  if (info.error) { out.push({ code: 'registry-error', severity: 'low', message: `Registry lookup failed: ${info.error}` }); return out; }
  if (info.exists === false) out.push({ code: 'not-on-registry', severity: 'high', message: 'Does not exist on the registry: likely a hallucinated name', fix: 'Check the spelling or find the real package name in the docs.' });
  const created = info.createdAt ? Date.parse(info.createdAt) : NaN;
  if (Number.isFinite(created) && now - created < 30 * 86400000) out.push({ code: 'new-package', severity: 'medium', message: `First published ${Math.max(0, Math.round((now - created) / 86400000))} day(s) ago`, fix: 'Very new packages are a common malware vector; double-check the author.' });
  if (info.deprecated) out.push({ code: 'deprecated', severity: 'medium', message: `Deprecated: ${info.deprecated}`, fix: 'Use the suggested replacement.' });
  if (info.maintainers === 1 && Number.isFinite(created) && now - created < 180 * 86400000) out.push({ code: 'single-maintainer', severity: 'low', message: 'One maintainer and less than six months old' });
  if (info.advisories?.length) out.push({ code: 'advisory', severity: 'high', message: `${info.advisories.length} known advisor${info.advisories.length === 1 ? 'y' : 'ies'} (${info.advisories.slice(0, 3).map((a) => a.id).join(', ')})`, fix: 'Upgrade to a fixed version.' });
  return out;
}

// ---- project scan ----------------------------------------------------------------

const SKIP_DEP = (eco, name) => (eco === 'packagist' && (name === 'php' || /^(ext|lib)-/.test(name) || name === 'composer-plugin-api')) || (eco === 'pypi' && name === 'python');

/**
 * Scan the project's dependencies -> { online, deps, findings: [{ id, severity, manager, name, version, code, message, fix, manifest }], lockfiles }.
 * opts: { online: bool, fetchImpl }
 */
export async function scanPackages(root, { online = false, fetchImpl } = {}) {
  const proj = await detectProject(root);
  const locks = await readLockfiles(root);
  const findings = [];
  const add = (f) => { const id = `${f.code}:${f.manager}:${f.name}:${f.manifest || ''}`; if (!findings.some((x) => x.id === id)) findings.push({ id, ...f }); };
  let deps = 0;
  const direct = [];
  // a nested manifest is covered by the root lockfile only in a workspace setup
  const rootPkg = await readText(root, 'package.json');
  const workspaces = !!(await readText(root, 'pnpm-workspace.yaml')) || /"workspaces"\s*:/.test(rootPkg || '');
  for (const m of proj.manifests || []) {
    for (const d of m.deps || []) {
      const eco = ecosystemOf(d.manager) || (m.type === 'npm' ? 'npm' : m.type === 'composer' ? 'packagist' : m.type === 'python' ? 'pypi' : null);
      if (!eco || SKIP_DEP(eco, d.name)) continue;
      deps++;
      const base = { manager: d.manager, name: d.name, version: d.version ?? null, manifest: m.path };
      direct.push({ ...base, eco });
      const lock = !m.path.includes('/') || (eco === 'npm' && workspaces) ? locks[eco] : null;
      const local = /^(file|link|portal|workspace):/.test(String(d.version || ''));
      if (lock && !local && !lock.names.has(keyName(eco, d.name)) && !(eco === 'pypi' && lock.names.has(pyNorm(d.name)))) {
        add({ ...base, severity: 'medium', code: 'not-in-lockfile', message: `Declared in ${m.path} but missing from ${lock.file}`, fix: `Run the install command so ${lock.file} pins it, then review the lockfile diff.` });
      }
      const la = lookalike(d.name, eco);
      if (la) add({ ...base, severity: la.severity, code: la.code, message: la.message, fix: `Check whether you meant "${la.target}".` });
      for (const v of versionIssues(eco, d.version)) add({ ...base, severity: v.severity, code: v.code, message: v.message, fix: v.fix });
    }
  }
  for (const [eco, lock] of Object.entries(locks)) {
    const mgr = eco === 'npm' ? (lock.file === 'pnpm-lock.yaml' ? 'pnpm' : lock.file === 'yarn.lock' ? 'yarn' : 'npm') : eco === 'packagist' ? 'composer' : 'pip';
    for (const n of lock.scripts.slice(0, 40)) add({ manager: mgr, name: n, version: null, manifest: lock.file, severity: 'low', code: 'install-script', message: 'Runs an install script when installed', fix: 'Expected for native modules; otherwise consider --ignore-scripts or an allow-list.' });
    for (const s of lock.sources.slice(0, 40)) add({ manager: mgr, name: s.name, version: null, manifest: lock.file, severity: 'medium', code: 'non-registry-source', message: 'Resolved from a URL outside the public registry', fix: 'Make sure the source is trusted and pinned to a commit / integrity hash.' });
  }
  if (online) {
    const flagged = new Set(findings.map((f) => f.name));
    const pick = [...direct.filter((d) => flagged.has(d.name)), ...direct.filter((d) => !flagged.has(d.name))].slice(0, MAX_ONLINE);
    for (let i = 0; i < pick.length; i += 4) {
      await Promise.all(pick.slice(i, i + 4).map(async (d) => {
        const info = await registryInfo(root, d.eco, d.name, cleanVer(d.version), { fetchImpl });
        for (const r of onlineReasons(info)) if (r.code !== 'registry-error') add({ manager: d.manager, name: d.name, version: d.version, manifest: d.manifest, severity: r.severity, code: r.code, message: r.message, fix: r.fix || '' });
      }));
    }
  }
  findings.sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.name.localeCompare(b.name));
  return { online: !!online, deps, findings, lockfiles: Object.values(locks).map((l) => l.file), onlineChecked: online ? Math.min(MAX_ONLINE, direct.length) : 0 };
}
const cleanVer = (v) => { const m = /\d+\.\d+(\.\d+)?([-+][\w.]+)?/.exec(String(v || '')); return m ? m[0] : null; };

/**
 * Check one package before installing it.
 * -> { manager, name, version, verdict: 'ok'|'warn'|'block'|'unknown', reasons: [{ code, severity, message, fix? }], known: { popular, inManifest, inLockfile }, registry }
 */
export async function checkPackage(root, { manager, name, version } = {}, { online = false, fetchImpl, cacheOnly = false } = {}) {
  if (!MANAGERS.includes(manager)) throw Object.assign(new Error(`unknown manager: ${String(manager).slice(0, 20)}`), { status: 400 });
  validateName(manager, name);
  const ver = validateVersion(version ?? null);
  const eco = ecosystemOf(manager);
  const reasons = [];
  const locks = await readLockfiles(root);
  let inManifest = false;
  try {
    const proj = await detectProject(root);
    inManifest = (proj.manifests || []).some((m) => (m.deps || []).some((d) => keyName(eco, d.name) === keyName(eco, name) && ecosystemOf(d.manager) === eco));
  } catch { /* no project info */ }
  const inLockfile = !!locks[eco]?.names.has(keyName(eco, name));
  const popular = SETS[eco].has(name) || [...SETS[eco]].some((p) => keyName(eco, p) === keyName(eco, name));
  if (popular) reasons.push({ code: 'popular', severity: 'info', message: 'On the bundled list of widely used packages' });
  if (inLockfile) reasons.push({ code: 'in-lockfile', severity: 'info', message: `Already in ${locks[eco].file}` });
  else if (inManifest) reasons.push({ code: 'in-manifest', severity: 'info', message: 'Already declared in a manifest' });
  const la = lookalike(name, eco);
  if (la) reasons.push({ code: la.code, severity: la.severity, message: la.message, fix: `Did you mean "${la.target}"?` });
  for (const v of versionIssues(eco, ver)) if (ver) reasons.push(v);
  let registry = null;
  if (online || cacheOnly) {
    registry = await registryInfo(root, eco, name, cleanVer(ver), { fetchImpl, cacheOnly: !online });
    reasons.push(...onlineReasons(registry));
  }
  const worst = reasons.reduce((a, r) => Math.max(a, RANK[r.severity] || 0), 0);
  let verdict;
  if (worst === 3) verdict = 'block';
  else if (worst === 2) verdict = 'warn';
  else if (popular || inLockfile || (registry && registry.exists === true)) verdict = 'ok';
  else verdict = 'unknown';
  if (verdict === 'unknown' && !online && !registry) reasons.push({ code: 'offline', severity: 'info', message: 'Not on the bundled list and not in this project; registry lookups are off (packages.online)' });
  return { manager, name, version: ver, ecosystem: eco, verdict, reasons, known: { popular, inManifest, inLockfile }, registry, online: !!online };
}
