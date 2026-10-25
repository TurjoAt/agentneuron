// Repo facts for the truth check: scripts, package managers, make targets, manifests, runtime versions,
// env key NAMES and the file tree. Synchronous (lint is sync), confined reads, cached briefly per root.
import fs from 'node:fs';
import path from 'node:path';
import { isIgnored } from '../core/classify.js';
import { readRegular } from '../files/safeio.js';
import { parseToml, envKeys, cleanVersion } from '../project/util.js';
import { pmFromIndex } from '../project/detectors/node.js';

const TTL = 15000;
const MAX_ENTRIES = 50000;
const SKIP = new Set(['.venv', 'venv', '__pycache__', 'target', '.cache', 'coverage', '.nuxt', '.svelte-kit', '.turbo', '.gradle', '.idea', '.output', '.pytest_cache', '.mypy_cache', '.tox']);
const SIG = ['package.json', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'bun.lockb', 'bun.lock', 'Makefile', 'composer.json', 'composer.lock', 'pyproject.toml',
  '.nvmrc', '.node-version', '.python-version', '.env.example', '.env.sample', 'Cargo.toml', 'go.mod', 'artisan'];
const LOCKS = [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lockb', 'bun'], ['bun.lock', 'bun'], ['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm']];
const ENV_EXAMPLES = ['.env.example', '.env.sample', '.env.dist', '.env.template', '.env.defaults'];
const ENV_ACTUAL = ['.env', '.env.local', '.env.development', '.env.test', '.env.production'];
const SRC_EXT = /\.(?:[cm]?[jt]sx?|php|py|go|rs|rb|java|kt|cs|ya?ml|toml|json|sh|ini|conf|vue|svelte|astro|ex|exs)$|(?:^|\/)(?:Dockerfile|Makefile|\.env[\w.-]*)$/i;

const cache = new Map(); // root -> { ts, sig, facts }

function signature(root) {
  const parts = [];
  for (const f of SIG) { try { parts.push(`${f}:${fs.statSync(path.join(root, f)).mtimeMs}`); } catch { /* absent */ } }
  return parts.join('|');
}

export function clearFactsCache(root) { if (root) cache.delete(path.resolve(root)); else cache.clear(); }

/** Facts for `root`, cached for 15 s or until a root manifest changes. */
export function loadFacts(root) {
  const key = path.resolve(root);
  const sig = signature(key);
  const c = cache.get(key);
  if (c && c.sig === sig && Date.now() - c.ts < TTL) return c.facts;
  const facts = computeFacts(key);
  cache.set(key, { ts: Date.now(), sig, facts });
  return facts;
}

function walk(root) {
  const files = []; const dirs = new Set(['']);
  let n = 0; let truncated = false;
  const queue = [''];
  while (queue.length) {
    const rel = queue.shift();
    let ents;
    try { ents = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (isIgnored(p)) continue;
      if (++n > MAX_ENTRIES) { truncated = true; break; }
      if (e.isDirectory()) { if (SKIP.has(e.name)) continue; dirs.add(p); queue.push(p); } else if (e.isFile()) files.push(p);
    }
    if (truncated) break;
  }
  return { files, dirs, truncated };
}

function makeReader(root) {
  const text = (rel, max = 2 * 1024 * 1024) => {
    const r = readRegular(path.join(root, rel), { maxBytes: max, confine: root });
    return r ? r.buf.toString('utf8').replace(/^﻿/, '') : null;
  };
  const json = (rel) => { const t = text(rel); if (t == null) return null; try { const v = JSON.parse(t); return v && typeof v === 'object' ? v : null; } catch { return null; } };
  return { text, json };
}

const dirOf = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };

/** Make targets of a Makefile text; `dynamic` when includes/pattern rules could add more. */
export function makeTargets(text) {
  const targets = new Set(); let dynamic = false; let first = null;
  for (const raw of String(text).split(/\r?\n/)) {
    if (/^\s*-?s?include\s/.test(raw)) dynamic = true;
    if (/^\t/.test(raw) || /^\s*#/.test(raw)) continue;
    const m = /^([^:#=\t][^:#=]*?)\s*::?(?!=)/.exec(raw);
    if (!m) continue;
    for (const t of m[1].trim().split(/\s+/)) {
      if (!t) continue;
      if (/[%$()]/.test(t)) { dynamic = true; continue; }
      if (t.startsWith('.')) continue; // .PHONY, .DEFAULT ...
      targets.add(t);
      if (!first) first = t;
    }
  }
  return { targets, dynamic, first };
}

function computeFacts(root) {
  const { files, dirs, truncated } = walk(root);
  const fileSet = new Set(files);
  const rd = makeReader(root);
  const has = (p) => fileSet.has(p);

  // --- node
  const pkgs = new Map(); // dir -> { path, name, scripts, deps:Map(name->range), engines }
  for (const p of files) {
    if (!/(^|\/)package\.json$/.test(p)) continue;
    const j = rd.json(p);
    if (!j) continue;
    const deps = new Map();
    for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [n, v] of Object.entries(j[k] || {})) if (!deps.has(n)) deps.set(n, String(v));
    }
    const scripts = {};
    for (const [n, v] of Object.entries(j.scripts || {})) scripts[n] = String(v);
    pkgs.set(dirOf(p), { path: p, name: typeof j.name === 'string' ? j.name : null, scripts, deps, engines: j.engines || {}, packageManager: typeof j.packageManager === 'string' ? j.packageManager : null });
  }
  const rootPkg = pkgs.get('') || null;
  const lockfiles = LOCKS.filter(([f]) => has(f));
  const lockIds = [...new Set(lockfiles.map(([, id]) => id))];
  const pmField = rootPkg?.packageManager ? rootPkg.packageManager.split('@')[0] : null;
  let pm = null;
  if (rootPkg || lockfiles.length) {
    const guess = pmFromIndex({ has }, rootPkg ? { packageManager: rootPkg.packageManager } : null);
    // only certain when exactly one lockfile family exists, or package.json says so explicitly
    const certain = (lockIds.length === 1 && (!pmField || pmField === lockIds[0])) || (!lockIds.length && !!pmField);
    pm = { id: certain && pmField && !lockIds.length ? pmField : guess.id, certain, source: lockIds.length === 1 ? lockfiles[0][0] : pmField ? 'package.json packageManager' : null };
  }
  let bins = null;
  try { bins = new Set(fs.readdirSync(path.join(root, 'node_modules', '.bin')).map((b) => b.replace(/\.(cmd|ps1)$/i, ''))); } catch { /* not installed */ }

  // --- make
  const makefiles = new Map(); // dir -> { path, targets, dynamic }
  for (const p of files) {
    if (!/(^|\/)(GNUmakefile|Makefile|makefile)$/.test(p)) continue;
    const d = dirOf(p);
    if (makefiles.has(d)) continue;
    const t = rd.text(p, 1024 * 1024);
    if (t == null) continue;
    makefiles.set(d, { path: p, ...makeTargets(t) });
  }
  const cmake = files.some((p) => /(^|\/)CMakeLists\.txt$/.test(p)) || files.some((p) => /(^|\/)(configure|configure\.ac|Makefile\.am|Makefile\.in)$/.test(p));

  // --- php
  let composer = null;
  const cj = has('composer.json') ? rd.json('composer.json') : null;
  if (cj) {
    const deps = new Map();
    for (const k of ['require', 'require-dev']) for (const [n, v] of Object.entries(cj[k] || {})) deps.set(n.toLowerCase(), String(v));
    const lock = has('composer.lock') ? rd.json('composer.lock') : null;
    const locked = new Map();
    for (const pk of [...(lock?.packages || []), ...(lock?.['packages-dev'] || [])]) if (pk?.name) locked.set(String(pk.name).toLowerCase(), String(pk.version || '').replace(/^v/, ''));
    composer = { scripts: new Set(Object.keys(cj.scripts || {})), deps, locked, php: deps.get('php') || null, platformPhp: cj.config?.platform?.php || null };
  }
  const artisan = has('artisan');

  // --- python
  let python = null;
  const pyFiles = ['pyproject.toml', 'setup.py', 'setup.cfg', 'Pipfile', 'tox.ini', 'pytest.ini', 'conftest.py'].filter(has);
  const reqFiles = files.filter((p) => /^requirements[\w.-]*\.txt$/.test(p) || /^requirements\/[\w.-]+\.txt$/.test(p));
  if (pyFiles.length || reqFiles.length) {
    const deps = new Set(); let requires = null; let poetry = false; let pytestCfg = has('pytest.ini') || has('conftest.py') || files.some((p) => /(^|\/)conftest\.py$/.test(p));
    const pyText = has('pyproject.toml') ? rd.text('pyproject.toml') || '' : '';
    if (pyText) {
      const t = parseToml(pyText);
      requires = t.project?.['requires-python'] || t.tool?.poetry?.dependencies?.python || null;
      poetry = !!t.tool?.poetry;
      const nm = (s) => String(s).split(/[\s<>=!~;[(]/)[0].toLowerCase();
      for (const d of t.project?.dependencies || []) deps.add(nm(d));
      for (const l of Object.values(t.project?.['optional-dependencies'] || {})) for (const d of l || []) deps.add(nm(d));
      for (const l of Object.values(t['dependency-groups'] || {})) for (const d of Array.isArray(l) ? l : []) if (typeof d === 'string') deps.add(nm(d));
      for (const g of ['dependencies', 'dev-dependencies']) for (const n of Object.keys(t.tool?.poetry?.[g] || {})) deps.add(n.toLowerCase());
      for (const grp of Object.values(t.tool?.poetry?.group || {})) for (const n of Object.keys(grp?.dependencies || {})) deps.add(n.toLowerCase());
      if (/\[tool\.pytest/.test(pyText)) pytestCfg = true;
    }
    for (const rf of reqFiles) for (const line of (rd.text(rf) || '').split(/\r?\n/)) { const l = line.split('#')[0].trim(); if (l && !l.startsWith('-')) deps.add(l.split(/[\s<>=!~;[(]/)[0].toLowerCase()); }
    for (const f of ['setup.cfg', 'tox.ini']) if (has(f) && /\[(tool:)?pytest\]/.test(rd.text(f) || '')) pytestCfg = true;
    python = { deps, requires, poetry, uv: has('uv.lock'), pytest: deps.has('pytest') || pytestCfg, pinned: has('.python-version') ? (rd.text('.python-version') || '').trim().split(/\s+/)[0] || null : null };
  }

  // --- node runtime pins
  const nvm = ['.nvmrc', '.node-version'].find(has);
  const nodePin = nvm ? (rd.text(nvm) || '').trim().split(/\s+/)[0].replace(/^v/, '') || null : null;
  let toolVersions = {};
  if (has('.tool-versions')) for (const l of (rd.text('.tool-versions') || '').split(/\r?\n/)) { const m = /^\s*(nodejs|node|php|python)\s+(\S+)/.exec(l); if (m) toolVersions[m[1] === 'nodejs' ? 'node' : m[1]] = m[2]; }

  // --- env names (never values)
  const exampleFiles = ENV_EXAMPLES.filter(has);
  const envNames = new Set();
  for (const f of [...exampleFiles, ...ENV_ACTUAL.filter(has)]) for (const k of envKeys(rd.text(f, 512 * 1024) || '')) envNames.add(k);

  // --- ports declared in config (for "ok" evidence only)
  const ports = new Set();
  const addPorts = (s) => { for (const m of String(s).matchAll(/(?:--port[= ]|-p\s+|\bPORT=)(\d{2,5})\b/g)) ports.add(Number(m[1])); };
  for (const p of pkgs.values()) for (const s of Object.values(p.scripts)) addPorts(s);
  for (const f of exampleFiles) for (const m of (rd.text(f, 512 * 1024) || '').matchAll(/^\s*(?:export\s+)?[A-Z_]*PORT\s*=\s*["']?(\d{2,5})\b/gm)) ports.add(Number(m[1]));
  for (const f of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yaml', 'compose.yml'].filter(has)) for (const m of (rd.text(f) || '').matchAll(/["'\s-](\d{2,5}):\d{2,5}\b/g)) ports.add(Number(m[1]));
  for (const f of files.filter((p) => /^(vite|vitest|astro|nuxt|svelte)\.config\.[cm]?[jt]s$/.test(p))) for (const m of (rd.text(f) || '').matchAll(/\bport\s*:\s*(\d{2,5})\b/g)) ports.add(Number(m[1]));

  let srcNames = null; // lazy: identifiers in source files, for env-var claims
  const facts = {
    root, files, fileSet, dirs, truncated, pkgs, rootPkg, pm, lockIds, bins, makefiles, cmake, composer, artisan, python,
    node: { pin: nodePin || toolVersions.node || null, pinSource: nvm || (toolVersions.node ? '.tool-versions' : null), engines: rootPkg?.engines?.node || null },
    php: { range: composer?.platformPhp || composer?.php || toolVersions.php || null },
    pyVersion: { pin: python?.pinned || toolVersions.python || null, range: python?.requires || null },
    cargo: files.some((p) => /(^|\/)Cargo\.toml$/.test(p)),
    gomod: files.some((p) => /(^|\/)go\.mod$/.test(p)) || files.some((p) => p.endsWith('.go')),
    envExampleFiles: exampleFiles, envNames, ports,
    /** All UPPER_SNAKE identifiers appearing in source/config files (bounded scan). */
    sourceNames() {
      if (srcNames) return srcNames;
      srcNames = new Set(); let budget = 32 * 1024 * 1024; let count = 0;
      for (const p of files) {
        if (!SRC_EXT.test(p) || /(^|\/)(package-lock\.json|composer\.lock|yarn\.lock|pnpm-lock\.yaml)$/.test(p)) continue;
        if (++count > 5000 || budget <= 0) break;
        const t = rd.text(p, 256 * 1024);
        if (t == null) continue;
        budget -= t.length;
        for (const m of t.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)) srcNames.add(m[0]);
      }
      return srcNames;
    },
    /** Version range for a dependency from any manifest (npm, composer, python). */
    depRange(name) {
      const n = name.toLowerCase();
      for (const p of pkgs.values()) if (p.deps.has(n)) return { range: p.deps.get(n), source: p.path };
      if (composer?.locked.has(n)) return { range: composer.locked.get(n), source: 'composer.lock' };
      if (composer?.deps.has(n)) return { range: composer.deps.get(n), source: 'composer.json' };
      if (python?.deps.has(n)) return { range: null, source: 'python manifest' };
      return null;
    },
    hasDep(name) { return !!facts.depRange(name); },
    cleanVersion,
  };
  return facts;
}
