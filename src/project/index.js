// detectProject(root): project intelligence facade. Cached 30 s, invalidated when manifests change.
import fs from 'node:fs';
import path from 'node:path';
import { buildIndex } from './fsindex.js';
import node from './detectors/node.js';
import php from './detectors/php.js';
import { python, go, rust, ruby, java, dotnet, deno } from './detectors/other.js';
import { docker, ci, tooling, ai } from './detectors/infra.js';
import { detectEnv } from './env.js';
import { detectDotfolders } from './dotfolders.js';
import { computeStats } from './stats.js';

export { laravelRoutes, laravelMigrations, laravelModels, parseRoutesSource } from './laravel.js';
export { docDrift, extractMentions } from './drift.js';
export { hasBinary } from './util.js';

export const detectors = [node, php, python, go, rust, ruby, java, dotnet, deno, docker, ci, tooling, ai];
const TTL = 30000;
const WATCH = ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'composer.json', 'composer.lock', 'pyproject.toml', 'requirements.txt', 'poetry.lock',
  'go.mod', 'Cargo.toml', 'Gemfile', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'deno.json', '.env', '.env.example', 'docker-compose.yml', 'compose.yaml', 'Dockerfile',
  'routes', 'database/migrations', 'app/Models', '.github/workflows', 'tsconfig.json', 'artisan', '.gitlab-ci.yml'];
const cache = new Map(); // root -> { ts, sig, value, pending }

function signature(root) {
  const parts = [];
  for (const w of WATCH) {
    try { parts.push(`${w}:${fs.statSync(path.join(root, w)).mtimeMs}`); } catch { /* absent */ }
  }
  return parts.join('|');
}

/** Synchronous peek at the last detection result (no I/O); null when none cached. */
export function peekProject(root) { return cache.get(path.resolve(root))?.value || null; }
export function clearProjectCache(root) { if (root) cache.delete(path.resolve(root)); else cache.clear(); }

function mergeInto(acc, part) {
  if (!part) return;
  for (const k of ['name', 'description', 'version']) if (acc[k] == null && part[k]) acc[k] = part[k];
  for (const s of part.stacks || []) {
    const ex = acc.stacks.find((x) => x.id === s.id);
    if (!ex) acc.stacks.push(s);
    else {
      if (!ex.version && s.version) ex.version = s.version;
      if (s.confidence > ex.confidence) { ex.confidence = s.confidence; ex.source = s.source; }
    }
  }
  acc.manifests.push(...(part.manifests || []));
  for (const pm of part.packageManagers || []) if (!acc.packageManagers.some((x) => x.id === pm.id)) acc.packageManagers.push(pm);
  acc.scripts.push(...(part.scripts || []));
  acc.ci.push(...(part.ci || []));
  if (part.docker) { acc.docker.files.push(...part.docker.files); acc.docker.services.push(...part.docker.services); }
  Object.assign(acc.framework, part.framework || {});
}

async function compute(root, opts) {
  const idx = await buildIndex(root, opts);
  const acc = { name: null, description: null, version: null, stacks: [], manifests: [], packageManagers: [], scripts: [], ci: [], docker: { files: [], services: [] }, framework: {} };
  const parts = await Promise.all(detectors.map((d) => d.detect(root, idx).catch(() => null)));
  parts.forEach((p) => mergeInto(acc, p));
  // Framework entries inferred from config files only (no manifest)
  for (const id of ['next', 'nuxt', 'astro', 'vite', 'angular']) {
    const s = acc.stacks.find((x) => x.id === id);
    if (s && !acc.framework[id]) acc.framework[id] = { version: s.version };
  }
  if (idx.has('manage.py') && !acc.framework.django) acc.framework.django = { version: acc.stacks.find((x) => x.id === 'django')?.version || null };
  const [env, dotfolders, stats] = await Promise.all([detectEnv(root, idx), detectDotfolders(root), computeStats(root, idx)]);
  return {
    name: acc.name || path.basename(path.resolve(root)),
    description: acc.description || null,
    version: acc.version || null,
    stacks: acc.stacks.sort((a, b) => b.confidence - a.confidence),
    manifests: acc.manifests,
    packageManagers: acc.packageManagers,
    scripts: acc.scripts,
    env,
    docker: acc.docker,
    ci: acc.ci,
    dotfolders,
    framework: acc.framework,
    stats,
  };
}

export async function detectProject(root, opts = {}) {
  const key = path.resolve(root);
  const c = cache.get(key);
  const sig = signature(key);
  if (!opts.refresh && c?.value && Date.now() - c.ts < TTL && c.sig === sig) return c.value;
  if (!opts.refresh && c?.pending && c.sig === sig) return c.pending;
  const entry = { ts: Date.now(), sig, value: c?.value || null, pending: null };
  entry.pending = compute(key, opts).then((v) => { entry.value = v; entry.ts = Date.now(); entry.pending = null; return v; }, (e) => { if (cache.get(key) === entry) cache.delete(key); throw e; });
  cache.set(key, entry);
  return entry.pending;
}
