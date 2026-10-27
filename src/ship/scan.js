// Static scan shared by readiness (#2) and placeholders (#15): one bounded pass over the source files,
// per-file results cached by mtime+size, whole result cached for a few seconds so parallel requests share it.
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { listSourceFiles, readBounded, LIMITS } from './files.js';
import { scanFile, RULES_VERSION } from './rules.js';
import { detectProject } from '../project/index.js';
import { readRegularAsync } from '../files/safeio.js';
import { changedFiles } from './git.js';
import { envKeys } from '../project/util.js';

const TTL = 4000;
const fileCache = new Map(); // root -> Map(path -> { sig, res })
const scanCache = new Map(); // root -> { ts, pending, value }

const SEV = { high: 0, medium: 1, low: 2 };
const bySeverity = (a, b) => SEV[a.severity] - SEV[b.severity] || a.location.path.localeCompare(b.location.path) || (a.location.line || 0) - (b.location.line || 0);

async function runScan(root, limits) {
  const t0 = Date.now();
  const list = await listSourceFiles(root, limits);
  const prev = fileCache.get(root) || new Map();
  const next = new Map();
  const io = await readBounded(root, list.files, {
    limits,
    cached: (p, st) => {
      const sig = `${RULES_VERSION}:${st.mtimeMs}:${st.size}`;
      const c = prev.get(p);
      if (c && c.sig === sig) { next.set(p, c); return true; }
      return false;
    },
    onFile: (p, text, st) => { next.set(p, { sig: `${RULES_VERSION}:${st.mtimeMs}:${st.size}`, res: scanFile(p, text) }); },
  });
  fileCache.set(root, next);
  return { files: list.files, tracked: list.tracked, source: list.source, results: next, stats: { files: list.files.length, scanned: io.scanned, skipped: io.skipped, truncated: io.truncated || list.truncated, ms: Date.now() - t0 } };
}

/** Shared scan; `fresh` skips the short TTL. */
export async function scanProject(root, { fresh = false, limits = LIMITS } = {}) {
  const c = scanCache.get(root);
  if (c?.pending) return c.pending;
  if (!fresh && c?.value && Date.now() - c.ts < TTL) return c.value;
  const entry = { ts: Date.now(), value: c?.value || null, pending: null };
  entry.pending = runScan(root, limits).then((v) => { entry.value = v; entry.ts = Date.now(); entry.pending = null; return v; }, (e) => { entry.pending = null; scanCache.delete(root); throw e; });
  scanCache.set(root, entry);
  return entry.pending;
}

export function _clearScanCache() { fileCache.clear(); scanCache.clear(); }

const counts = (findings) => {
  const c = { high: 0, medium: 0, low: 0 };
  for (const x of findings) c[x.severity]++;
  return c;
};

/** Placeholder / fake functionality findings. */
export async function placeholders(root, opts = {}) {
  const s = await scanProject(root, opts);
  const findings = [];
  for (const [, v] of s.results) findings.push(...v.res.placeholders);
  findings.sort(bySeverity);
  return { generatedAt: Date.now(), count: findings.length, counts: counts(findings), findings: findings.slice(0, 1000), scanned: s.stats };
}

const readText = async (root, p, max = 1024 * 1024) => {
  const r = await readRegularAsync(path.join(root, p), { maxBytes: max });
  return r ? r.buf.toString('utf8') : null;
};
const exists = async (root, p) => { try { await fsp.access(path.join(root, p)); return true; } catch { return false; } };

const MIGRATION = /(?:^|\/)(?:database\/migrations\/[^/]+\.php|prisma\/migrations\/.+\.sql|db\/migrate\/[^/]+\.rb|[\w-]+\/migrations\/\d{4}_[\w]+\.py|drizzle\/[^/]+\.sql|migrations\/[^/]+\.sql|alembic\/versions\/[^/]+\.py)$/;
const DEPLOY_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yaml', 'compose.yml', 'fly.toml', 'render.yaml', 'app.json', 'app.yaml', 'netlify.toml', 'vercel.json', 'wrangler.toml', 'Procfile', 'Dockerfile', '.do/app.yaml', 'serverless.yml'];
const EXAMPLES = ['.env.example', '.env.sample', '.env.dist', '.env.template', '.env.defaults'];
const SERVER_DEPS = ['express', 'fastify', 'koa', '@nestjs/core', 'hono', 'next', 'nuxt', '@remix-run/serve', '@hapi/hapi', 'restify', 'polka', '@sveltejs/adapter-node', 'socket.io'];
const BUILD_STACKS = ['vite', 'next', 'nuxt', 'astro', 'angular', 'sveltekit', 'svelte', 'react-scripts', 'webpack', 'parcel', 'remix', 'gatsby'];

/** Project-level readiness checks (env, lockfiles, scripts, migrations, committed env files). */
async function projectFindings(root, scan, opts) {
  const out = [];
  const F = (rule, severity, category, title, why, fix, p = null, line = null) => out.push({ id: `${rule}-${crypto.createHash('sha1').update(`${rule}\0${p || ''}\0${line || 0}`).digest('hex').slice(0, 12)}`, rule, severity, category, title, why, fix, location: { path: p, line } });
  const tracked = scan.tracked;

  // committed env files
  if (tracked) {
    for (const p of tracked) {
      if (!/(?:^|\/)\.env(?:\.[\w.-]+)?$/.test(p) || /\.(?:example|sample|dist|template|defaults)$/i.test(p) || p.split('/').some((s) => s === 'node_modules' || s === 'vendor')) continue;
      const testing = /\.env\.(?:test|testing|ci|e2e)$/i.test(p);
      F('env-committed', testing ? 'low' : 'high', 'env', `${p} is committed`, testing ? 'Test env files are usually fine, but make sure they hold no real credentials.' : 'Env files hold credentials and per-machine settings; committed ones leak and override deploy config.', `git rm --cached ${p}, add it to .gitignore, rotate any credentials it contained, and commit a .env.example with key names only.`, p);
    }
  }

  // env vars used in code vs documented
  const used = new Map();
  for (const [p, v] of scan.results) for (const e of v.res.env) if (!used.has(e.name)) used.set(e.name, { path: p, line: e.line });
  if (used.size) {
    const documented = new Set();
    let example = null;
    for (const e of EXAMPLES) {
      const t = await readText(root, e, 512 * 1024);
      if (t == null) continue;
      example = example || e;
      for (const k of envKeys(t)) documented.add(k);
    }
    let deployText = '';
    for (const d of DEPLOY_FILES) { const t = await readText(root, d, 512 * 1024); if (t) deployText += `\n${t}`; }
    try { const wf = await fsp.readdir(path.join(root, '.github/workflows')); for (const n of wf.slice(0, 20)) { const t = await readText(root, `.github/workflows/${n}`, 256 * 1024); if (t) deployText += `\n${t}`; } } catch { /* none */ }
    const known = (k) => documented.has(k) || new RegExp(`\\b${k}\\b`).test(deployText);
    if (!example && ![...used.keys()].every(known)) {
      const first = [...used.entries()].find(([k]) => !known(k));
      F('env-example-missing', 'medium', 'env', `No .env.example for ${used.size} environment variable${used.size === 1 ? '' : 's'} used in code`, 'Whoever deploys has to read the code to find out which variables to set; a missing one fails at runtime.', `Add .env.example listing ${[...used.keys()].slice(0, 6).join(', ')}${used.size > 6 ? ', ...' : ''} (names only, no real values).`, first[1].path, first[1].line);
    } else {
      let n = 0;
      for (const [k, loc] of used) {
        if (known(k)) continue;
        if (++n > 40) break;
        F('env-undocumented', 'medium', 'env', `${k} is used but not in ${example || '.env.example'} or deploy config`, 'A deployment built from the example will not set it, so the code falls back to undefined.', `Add ${k}= to ${example || '.env.example'} (and to the deploy config).`, loc.path, loc.line);
      }
    }
  }

  // node: lockfile, start/build scripts
  let proj = null;
  try { proj = await detectProject(root); } catch { /* none */ }
  const pkgText = await readText(root, 'package.json');
  let pkg = null; try { pkg = pkgText ? JSON.parse(pkgText.replace(/^﻿/, '')) : null; } catch { pkg = null; }
  if (pkg) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const names = Object.keys(deps);
    const locks = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'npm-shrinkwrap.json'];
    const present = [];
    for (const l of locks) if (await exists(root, l)) present.push(l);
    if (names.length && !present.length && !pkg.workspaces) F('lockfile-missing', 'high', 'dependencies', 'No lockfile for package.json', 'Every install resolves versions anew, so production can run code nobody tested.', 'Run the package manager install once and commit the lockfile.', 'package.json');
    else if (names.length && present.length) {
      const lock = present[0];
      if (lock !== 'bun.lockb') {
        const lt = await readText(root, lock, 64 * 1024 * 1024);
        if (lt) {
          let missing = [];
          if (lock === 'package-lock.json' || lock === 'npm-shrinkwrap.json') {
            try {
              const lj = JSON.parse(lt);
              const top = lj.packages?.[''];
              if (top) { const have = new Set(Object.keys({ ...(top.dependencies || {}), ...(top.devDependencies || {}), ...(top.optionalDependencies || {}) })); missing = names.filter((n) => !have.has(n)); }
              else if (lj.dependencies) missing = names.filter((n) => !lj.dependencies[n]);
            } catch { /* unreadable */ }
          } else missing = names.filter((n) => !lt.includes(n));
          if (missing.length) F('lockfile-stale', 'medium', 'dependencies', `${lock} is out of sync with package.json (${missing.length} missing)`, 'CI and production install from the lockfile, so these dependencies may be missing or resolve differently.', `Run the install command and commit ${lock} (missing: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', ...' : ''}).`, lock);
        }
      }
      if (tracked && !tracked.has(lock)) F('lockfile-untracked', 'medium', 'dependencies', `${lock} is not committed`, 'Deployments cannot reproduce the tested dependency tree.', `Commit ${lock}.`, lock);
    }
    const scripts = pkg.scripts || {};
    const stackIds = new Set((proj?.stacks || []).map((s) => s.id));
    const server = SERVER_DEPS.some((d) => pkg.dependencies?.[d]);
    const hasDeploy = (await Promise.all(['Procfile', 'Dockerfile', 'fly.toml', 'render.yaml', 'vercel.json', 'netlify.toml'].map((d) => exists(root, d)))).some(Boolean);
    if (server && !scripts.start && !hasDeploy) F('start-missing', 'medium', 'scripts', 'No "start" script', 'Most hosts run `npm start`; without it the deploy has no entry point.', 'Add "start": "node <entry>" (or the framework\'s start command) to package.json.', 'package.json');
    const frontend = BUILD_STACKS.some((s) => stackIds.has(s) || pkg.devDependencies?.[s] || pkg.dependencies?.[s]);
    if (frontend && !scripts.build) F('build-missing', 'medium', 'build', 'Frontend tooling but no "build" script', 'There is no defined way to produce the production bundle.', 'Add a "build" script (e.g. "vite build").', 'package.json');
  }

  // composer: lock
  const composerText = await readText(root, 'composer.json');
  if (composerText) {
    let c = null; try { c = JSON.parse(composerText); } catch { c = null; }
    const req = Object.keys(c?.require || {}).filter((n) => n.includes('/'));
    if (req.length && c?.type !== 'library') {
      const lt = await readText(root, 'composer.lock', 64 * 1024 * 1024);
      if (lt == null) F('lockfile-missing', 'high', 'dependencies', 'No composer.lock', 'Production installs resolve versions anew instead of the tested set.', 'Run composer update once and commit composer.lock.', 'composer.json');
      else {
        const missing = req.filter((n) => !lt.includes(`"name": "${n}"`));
        if (missing.length) F('lockfile-stale', 'medium', 'dependencies', `composer.lock is out of sync (${missing.length} missing)`, 'composer install will fail or warn that the lock file is not up to date.', `Run composer update ${missing.slice(0, 3).join(' ')} and commit composer.lock.`, 'composer.lock');
      }
    }
  }

  // migrations added or edited in the working tree
  const changed = opts.changed || (await changedFiles(root, 'HEAD').catch(() => ({ files: [] })));
  for (const fch of changed.files || []) {
    if (!MIGRATION.test(fch.path)) continue;
    if (fch.status === 'M') F('migration-edited', 'high', 'migrations', `Existing migration edited: ${fch.path}`, 'Databases that already ran this migration will not run it again, so they drift from the code.', 'Revert the edit and add a new migration with the change.', fch.path);
    else if (fch.status === '?' || fch.status === 'A') F('migration-pending', 'medium', 'migrations', `New migration: ${fch.path}`, 'The deploy must run migrations before the new code serves traffic.', 'Commit it and make sure the deploy runs migrations (e.g. php artisan migrate --force, prisma migrate deploy).', fch.path);
  }
  return out;
}

/** Production readiness: { ready, blockers, counts, findings, scanned }. */
export async function readiness(root, opts = {}) {
  const s = await scanProject(root, opts);
  const findings = [];
  for (const [, v] of s.results) findings.push(...v.res.readiness);
  findings.push(...(await projectFindings(root, s, opts)));
  findings.sort(bySeverity);
  const c = counts(findings);
  return { generatedAt: Date.now(), ready: c.high === 0, blockers: c.high, counts: c, findings: findings.slice(0, 1000), scanned: s.stats };
}
