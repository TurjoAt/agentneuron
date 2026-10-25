// Check one extracted claim against repo facts -> { status: ok|false|unknown, evidence, suggestion, fix? }.
import { levenshtein, closestFiles } from '../files/fuzzy.js';
import { claimMatches, pinMatches, rangeFloor, versionOf } from './semver.js';
import path from 'node:path';

const BUILTINS = {
  npm: new Set(['install', 'i', 'in', 'ins', 'inst', 'isntall', 'add', 'ci', 'clean-install', 'install-clean', 'uninstall', 'remove', 'rm', 'un', 'r', 'update', 'up', 'upgrade', 'outdated', 'ls', 'list', 'll', 'la',
    'init', 'create', 'exec', 'x', 'pack', 'publish', 'unpublish', 'version', 'view', 'info', 'show', 'v', 'audit', 'fund', 'link', 'ln', 'unlink', 'prune', 'dedupe', 'ddp', 'cache', 'config', 'c', 'set', 'get',
    'login', 'logout', 'adduser', 'whoami', 'doctor', 'explain', 'why', 'help', 'search', 'rebuild', 'pkg', 'query', 'sbom', 'diff', 'deprecate', 'dist-tag', 'owner', 'team', 'token', 'profile', 'access', 'org', 'hook', 'root', 'bin', 'prefix', 'edit', 'explore', 'bugs', 'docs', 'repo', 'star', 'stars', 'unstar', 'shrinkwrap', 'completion', 'ping', 'install-test', 'it', 'install-ci-test', 'cit']),
  pnpm: new Set(['install', 'i', 'add', 'remove', 'rm', 'uninstall', 'un', 'update', 'up', 'upgrade', 'outdated', 'list', 'ls', 'll', 'why', 'link', 'ln', 'unlink', 'import', 'rebuild', 'rb', 'prune', 'fetch',
    'install-test', 'it', 'dedupe', 'patch', 'patch-commit', 'patch-remove', 'audit', 'licenses', 'exec', 'dlx', 'create', 'init', 'pack', 'publish', 'root', 'bin', 'store', 'server', 'setup', 'env', 'config', 'c', 'deploy', 'doctor', 'help', 'self-update', 'approve-builds', 'ignored-builds', 'cat-file', 'cat-index', 'find-hash', 'recursive', 'm', 'multi', 'version', 'view', 'info', 'show', 'login', 'logout', 'whoami', 'docs', 'home', 'bugs', 'repo', 'cache', 'fund', 'sbom']),
  yarn: new Set(['install', 'add', 'remove', 'up', 'upgrade', 'upgrade-interactive', 'dlx', 'exec', 'init', 'create', 'pack', 'publish', 'npm', 'info', 'why', 'workspaces', 'workspace', 'link', 'unlink', 'config',
    'cache', 'set', 'plugin', 'constraints', 'dedupe', 'explain', 'version', 'versions', 'outdated', 'audit', 'list', 'global', 'bin', 'node', 'patch', 'patch-commit', 'rebuild', 'search', 'unplug', 'import', 'help', 'login', 'logout', 'tag', 'team', 'owner', 'policies', 'check', 'autoclean', 'licenses', 'generate-lock-entry', 'stage', 'sdks']),
  bun: new Set(['install', 'i', 'add', 'a', 'remove', 'rm', 'update', 'outdated', 'link', 'unlink', 'pm', 'x', 'exec', 'create', 'c', 'init', 'build', 'upgrade', 'publish', 'patch', 'audit', 'info', 'why', 'repl', 'completions', 'help', 'pack']),
  composer: new Set(['install', 'i', 'update', 'u', 'upgrade', 'require', 'r', 'remove', 'rm', 'dump-autoload', 'dumpautoload', 'create-project', 'outdated', 'show', 'info', 'validate', 'audit', 'init', 'global', 'exec',
    'config', 'diagnose', 'self-update', 'selfupdate', 'why', 'depends', 'why-not', 'prohibits', 'licenses', 'status', 'check-platform-reqs', 'fund', 'bump', 'reinstall', 'search', 'archive', 'clear-cache', 'clearcache', 'list', 'help', 'suggests', 'browse', 'home', 'run-script', 'run', 'about', 'repository']),
};
// tool -> package that ships it, for "pnpm vitest"-style bin calls
const BIN_PKG = { tsc: 'typescript', tsx: 'tsx', vite: 'vite', vitest: 'vitest', jest: 'jest', eslint: 'eslint', prettier: 'prettier', biome: '@biomejs/biome', playwright: '@playwright/test', next: 'next',
  nuxt: 'nuxt', astro: 'astro', prisma: 'prisma', drizzle: 'drizzle-kit', 'drizzle-kit': 'drizzle-kit', svelte: 'svelte', 'svelte-kit': '@sveltejs/kit', 'svelte-check': 'svelte-check', cypress: 'cypress',
  mocha: 'mocha', nodemon: 'nodemon', 'ts-node': 'ts-node', turbo: 'turbo', nx: 'nx', lerna: 'lerna', changeset: '@changesets/cli', storybook: 'storybook', webpack: 'webpack', rollup: 'rollup', esbuild: 'esbuild',
  husky: 'husky', 'lint-staged': 'lint-staged', tailwindcss: 'tailwindcss', knip: 'knip', wrangler: 'wrangler', vercel: 'vercel', electron: 'electron', ng: '@angular/cli', nest: '@nestjs/cli', stylelint: 'stylelint', c8: 'c8', nyc: 'nyc', rimraf: 'rimraf', concurrently: 'concurrently' };
const RUN_FORMS = { npm: (s) => `npm run ${s}`, pnpm: (s) => `pnpm ${s}`, yarn: (s) => `yarn ${s}`, bun: (s) => `bun run ${s}` };
const INSTALL = { npm: 'npm install', pnpm: 'pnpm install', yarn: 'yarn install', bun: 'bun install' };
const ADD = { npm: 'npm install', pnpm: 'pnpm add', yarn: 'yarn add', bun: 'bun add' };
const CI = { npm: 'npm ci', pnpm: 'pnpm install --frozen-lockfile', yarn: 'yarn install --frozen-lockfile', bun: 'bun install --frozen-lockfile' };
const LIFECYCLE = new Set(['test', 't', 'tst', 'start', 'stop', 'restart']);

const R = (status, evidence, suggestion = null, fix = null) => ({ status, evidence, suggestion, fix });
const code = (s) => '`' + s + '`';

/** Closest name within a small edit distance. */
export function closest(name, names) {
  let best = null; let bd = Infinity;
  const max = Math.max(1, Math.min(3, Math.floor(name.length / 3)));
  for (const n of names) {
    const d = levenshtein(name.toLowerCase(), n.toLowerCase());
    if (d < bd && d <= max) { best = n; bd = d; }
  }
  if (best) return best;
  const letters = (x) => [...x.toLowerCase()].sort().join('');
  for (const n of names) if (name.length >= 3 && letters(n) === letters(name)) return n; // transposed letters: "tset"

  // "test:unit" vs "unit-test", "lint" vs "lint:fix": same parts
  const parts = (s) => s.toLowerCase().split(/[:._-]/).filter(Boolean).sort().join(' ');
  for (const n of names) if (parts(n) === parts(name)) return n;
  return null;
}

/** Nearest ancestor dir of `dir` (inclusive) that has an entry in `map`. */
function nearest(map, dir) {
  let d = dir || '';
  for (;;) {
    if (map.has(d)) return d;
    if (!d) return null;
    const i = d.lastIndexOf('/');
    d = i < 0 ? '' : d.slice(0, i);
  }
}

const fileDir = (file) => { const d = path.posix.dirname(file); return d === '.' ? '' : d; };
const join = (a, b) => (b == null ? null : path.posix.normalize(path.posix.join(a || '', b || '')).replace(/^\.$/, '').replace(/\/$/, ''));

function rebuild(c, pm) {
  const [sub, ...rest] = c.args;
  const tail = rest.length ? ' ' + rest.join(' ') : '';
  if (c.flags.length) return null; // keep flags exact: no automatic rewrite
  if (!sub) return pm === 'yarn' ? 'yarn' : INSTALL[pm];
  if (['install', 'i'].includes(sub) && !rest.length) return INSTALL[pm];
  if (['install', 'i', 'add'].includes(sub)) return ADD[pm] + tail;
  if (sub === 'ci') return CI[pm];
  if (sub === 'run' || sub === 'run-script') return rest.length ? RUN_FORMS[pm](rest[0]) + (rest.length > 1 ? ' ' + rest.slice(1).join(' ') : '') : null;
  if (LIFECYCLE.has(sub)) return `${pm} ${sub === 't' || sub === 'tst' ? 'test' : sub}${tail}`;
  if (BUILTINS[c.tool]?.has(sub)) return null;
  return RUN_FORMS[pm](sub) + tail;
}

function checkPm(c, facts, file) {
  const dir = c.dir == null ? null : join(fileDir(file), c.dir) ?? null;
  if (c.global || (c.args[0] === 'create') || c.args[0] === 'dlx' || c.args[0] === 'exec' || c.args[0] === 'x') return R('unknown', 'global/one-off command; not checked');
  if (!facts.pkgs.size) return R('unknown', 'no package.json in the project');
  const pm = facts.pm;
  const s = checkScriptCall(c, facts, dir);
  if (!pm?.certain || pm.id === c.tool) return s;
  // wrong package manager (and maybe a misspelt script too)
  const fixed = s.near ? { ...c, args: c.args.map((a) => (a === s.name ? s.near : a)) } : c;
  const to = rebuild(fixed, pm.id);
  const ev = `project uses ${pm.id} (${pm.source})${s.status === 'false' ? `; ${s.evidence}` : ''}`;
  return to && (s.status !== 'false' || s.near) ? R('false', ev, `replace ${code(c.text)} with ${code(to)}`, { from: c.text, to })
    : R('false', ev, s.status === 'false' ? s.suggestion : `use ${pm.id} instead of ${c.tool}`);
}

function checkScriptCall(c, facts, dir) {
  let [sub, ...rest] = c.args;
  let explicitRun = false;
  if (sub === 'run' || sub === 'run-script' || sub === 'run-s') { explicitRun = true; sub = rest[0]; }
  if (!sub) return explicitRun ? R('unknown', 'lists scripts') : R('ok', `${c.tool} install`);
  if (!explicitRun && c.tool === 'npm' && !LIFECYCLE.has(sub)) {
    return BUILTINS.npm.has(sub) ? R('ok', `npm ${sub} is a built-in command`) : R('unknown', `npm ${sub}: not a script invocation`);
  }
  if (!explicitRun && BUILTINS[c.tool]?.has(sub) && !LIFECYCLE.has(sub)) return R('ok', `${c.tool} ${sub} is a built-in command`);
  const scriptName = LIFECYCLE.has(sub) && !explicitRun ? (sub === 't' || sub === 'tst' ? 'test' : sub) : sub;
  const all = [...facts.pkgs.values()];
  const anyHas = all.filter((p) => Object.hasOwn(p.scripts, scriptName));
  if (c.scoped) {
    if (anyHas.length) return R('ok', `"${scriptName}" defined in ${anyHas.map((p) => p.path).slice(0, 3).join(', ')}`);
    return R('unknown', `no package.json defines "${scriptName}"; workspace-scoped command`);
  }
  const base = dir == null ? null : nearest(facts.pkgs, dir);
  const target = base == null ? null : facts.pkgs.get(base);
  if (!target) return R('unknown', 'no package.json for this location');
  if (Object.hasOwn(target.scripts, scriptName)) return R('ok', `"${scriptName}" is defined in ${target.path}: ${target.scripts[scriptName].slice(0, 120)}`);
  if (facts.rootPkg && Object.hasOwn(facts.rootPkg.scripts, scriptName)) return R('ok', `"${scriptName}" is defined in package.json`);
  if (sub === 'start' && !explicitRun && facts.fileSet.has(join(base, 'server.js'))) return R('ok', 'npm start falls back to node server.js');
  if (anyHas.length) return R('unknown', `"${scriptName}" is only defined in ${anyHas[0].path}`);
  // bins: "pnpm vitest", "yarn tsc", "bun run eslint"
  if (!(c.tool === 'npm' && explicitRun)) {
    if (facts.bins?.has(scriptName)) return R('ok', `runs the ${scriptName} binary from node_modules/.bin`);
    const pkg = BIN_PKG[scriptName] || scriptName;
    if (all.some((p) => p.deps.has(pkg))) return R('ok', `runs the ${scriptName} binary (${pkg} is a dependency)`);
    if (!facts.bins) return R('unknown', `no "${scriptName}" script; it may be a binary (node_modules not installed)`);
  }
  const names = Object.keys(target.scripts);
  const near = closest(scriptName, names);
  const ev = `no "${scriptName}" script in ${target.path}${names.length ? ` (has: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ', …' : ''})` : ''}`;
  if (near) {
    const to = c.text.replace(new RegExp(`(^|\\s)${scriptName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`), `$1${near}`);
    if (to !== c.text) return { ...R('false', ev, `replace ${code(c.text)} with ${code(to)}`, { from: c.text, to }), name: sub, near };
  }
  return { ...R('false', ev, `add a "${scriptName}" script to ${target.path} or remove this instruction`), name: sub };
}

function checkMake(c, facts, file) {
  const dir = c.dir == null ? null : join(fileDir(file), c.dir);
  if (c.scoped) return R('unknown', 'custom makefile');
  if (!facts.makefiles.size) return facts.cmake ? R('unknown', 'Makefile is generated (CMake/autotools)') : R('false', 'no Makefile in the project', 'remove the make instruction or add a Makefile');
  const base = dir == null ? null : nearest(facts.makefiles, dir);
  const mk = base == null ? null : facts.makefiles.get(base);
  if (!mk) return R('unknown', 'no Makefile for this location');
  const targets = c.args.filter((a) => !a.includes('='));
  if (!targets.length) return mk.first ? R('ok', `default target "${mk.first}" in ${mk.path}`) : R('unknown', `${mk.path} has no plain targets`);
  for (const t of targets) {
    if (mk.targets.has(t)) continue;
    if (mk.dynamic) return R('unknown', `"${t}" not found in ${mk.path}, which includes other makefiles or pattern rules`);
    const near = closest(t, mk.targets);
    const ev = `no "${t}" target in ${mk.path}${mk.targets.size ? ` (has: ${[...mk.targets].slice(0, 8).join(', ')})` : ''}`;
    if (near) { const to = c.text.replace(new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`), `$1${near}`); return R('false', ev, `replace ${code(c.text)} with ${code(to)}`, { from: c.text, to }); }
    return R('false', ev, `add a "${t}" target to ${mk.path} or remove this instruction`);
  }
  return R('ok', `target${targets.length > 1 ? 's' : ''} ${targets.join(', ')} defined in ${mk.path}`);
}

function checkComposer(c, facts) {
  if (!facts.composer) return R('false', 'no composer.json in the project', 'remove the composer instruction');
  if (c.global) return R('unknown', 'global composer command');
  let [sub, ...rest] = c.args;
  if (!sub) return R('ok', 'composer');
  const explicit = sub === 'run' || sub === 'run-script';
  if (explicit) sub = rest[0];
  if (!sub) return R('unknown', 'lists scripts');
  if (facts.composer.scripts.has(sub)) return R('ok', `"${sub}" script defined in composer.json`);
  if (!explicit && BUILTINS.composer.has(sub)) return R('ok', `composer ${sub} is a built-in command`);
  if (!explicit) return R('unknown', `composer ${sub}: not a script; may be a plugin command`);
  const near = closest(sub, facts.composer.scripts);
  const ev = `no "${sub}" script in composer.json`;
  if (near) { const to = c.text.replace(new RegExp(`(\\s)${sub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`), `$1${near}`); return R('false', ev, `replace ${code(c.text)} with ${code(to)}`, { from: c.text, to }); }
  return R('false', ev, `add a "${sub}" script to composer.json or remove this instruction`);
}

function checkOther(c, facts) {
  switch (c.tool) {
    case 'artisan': return facts.artisan ? R('ok', 'artisan exists (Laravel)') : R('false', 'no artisan file: not a Laravel project root', 'remove the artisan instruction');
    case 'pytest':
      if (!facts.python) return facts.files.some((p) => p.endsWith('.py')) ? R('unknown', 'Python files but no manifest') : R('false', 'no Python project files (pyproject.toml, requirements*.txt, setup.py …)', 'remove the pytest instruction');
      return facts.python.pytest ? R('ok', 'pytest is configured or a dependency') : R('unknown', 'pytest not listed as a dependency');
    case 'cargo': return facts.cargo ? R('ok', 'Cargo.toml exists') : R('false', 'no Cargo.toml in the project', 'remove the cargo instruction');
    case 'go': return facts.gomod ? R('ok', 'go.mod / Go sources exist') : R('false', 'no go.mod or .go files in the project', 'remove the go instruction');
    case 'poetry':
      if (!facts.python) return R('false', 'no Python project files', 'remove the poetry instruction');
      if (facts.python.poetry) return R('ok', 'pyproject.toml has [tool.poetry]');
      if (facts.python.uv) { const to = c.text.replace(/^poetry\b/, 'uv'); return c.args[0] === 'run' ? R('false', 'project uses uv (uv.lock), not poetry', `replace ${code(c.text)} with ${code(to)}`, { from: c.text, to }) : R('false', 'project uses uv (uv.lock), not poetry', 'use uv instead of poetry'); }
      return R('unknown', 'no [tool.poetry] section');
    case 'uv':
      if (!facts.python) return R('false', 'no Python project files', 'remove the uv instruction');
      if (facts.python.poetry && !facts.python.uv) { const to = c.text.replace(/^uv\b/, 'poetry'); return c.args[0] === 'run' ? R('false', 'project uses poetry (pyproject [tool.poetry]), not uv', `replace ${code(c.text)} with ${code(to)}`, { from: c.text, to }) : R('false', 'project uses poetry, not uv', 'use poetry instead of uv'); }
      return R('ok', 'Python project');
    default: return R('unknown', 'not checked');
  }
}

function checkVersion(cl, facts) {
  const claim = { major: cl.major, minor: cl.minor, atLeast: cl.atLeast };
  const fmt = (maj, min) => `${cl.name} ${maj}${cl.minor != null && min != null ? `.${min}` : ''}${cl.atLeast ? '+' : ''}`;
  if (cl.runtime) {
    const r = cl.runtime === 'node' ? { pin: facts.node.pin, pinSource: facts.node.pinSource, range: facts.node.engines, rangeSource: 'package.json engines.node' }
      : cl.runtime === 'php' ? { range: facts.php.range, rangeSource: 'composer.json require.php' }
        : { pin: facts.pyVersion.pin, pinSource: '.python-version', range: facts.pyVersion.range, rangeSource: 'pyproject requires-python' };
    // both sources must agree; either one disagreeing makes the claim false
    const pinOk = r.pin ? pinMatches(r.pin, claim) : null;
    const rangeOk = r.range ? claimMatches(r.range, claim) : null;
    if (pinOk === false && !cl.atLeast) { const v = versionOf(r.pin); const to = fmt(v.major, v.minor); return R('false', `${r.pinSource} pins ${r.pin}`, `replace ${code(cl.text)} with ${code(to)}`, { from: cl.text, to }); }
    if (rangeOk === false || pinOk === false) {
      const f = rangeOk === false ? rangeFloor(r.range) : versionOf(r.pin);
      const to = f ? fmt(f.major, f.minor) : null;
      return R('false', rangeOk === false ? `${r.rangeSource} is ${r.range}` : `${r.pinSource} pins ${r.pin}`, to ? `replace ${code(cl.text)} with ${code(to)}` : `align with ${r.range}`, to ? { from: cl.text, to } : null);
    }
    if (pinOk || rangeOk) return R('ok', [r.pin && `${r.pinSource}: ${r.pin}`, r.range && `${r.rangeSource}: ${r.range}`].filter(Boolean).join('; '));
    return R('unknown', `no ${cl.name} version declared`);
  }
  for (const dep of cl.deps || []) {
    const d = facts.depRange(dep);
    if (!d) continue;
    if (!d.range) return R('unknown', `${dep} in ${d.source} (no version)`);
    const ok = claimMatches(d.range, claim);
    if (ok === true) return R('ok', `${dep} ${d.range} in ${d.source}`);
    if (ok === false) {
      const f = rangeFloor(d.range);
      const to = f ? fmt(f.major, f.minor) : null;
      return R('false', `${dep} is ${d.range} in ${d.source}`, to ? `replace ${code(cl.text)} with ${code(to)}` : null, to ? { from: cl.text, to } : null);
    }
    return R('unknown', `${dep} ${d.range} in ${d.source}`);
  }
  return R('unknown', `${cl.name} is not a dependency`);
}

function checkDependency(cl, facts) {
  if (!facts.pkgs.size) return R('unknown', 'no package.json');
  if (facts.hasDep(cl.dep)) return R('ok', `${cl.dep} is a dependency`);
  const alt = Object.entries(cl.group.names).find(([, d]) => d !== cl.dep && facts.hasDep(d));
  if (!alt) return R('unknown', `${cl.dep} is not a dependency`);
  return R('false', `${cl.dep} is not a dependency; the project uses ${alt[1]} as its ${cl.group.group}`, `replace ${code(cl.name)} with ${code(alt[0])}`, { from: cl.name, to: alt[0] });
}

function checkPath(cl, facts, file) {
  const rel = path.posix.normalize(cl.path);
  const fromDir = join(fileDir(file), cl.path);
  const exists = (p) => p != null && (facts.fileSet.has(p) || facts.dirs.has(p));
  if (exists(rel) || exists(fromDir)) return R('ok', 'exists');
  if (facts.truncated) return R('unknown', 'project too large to index fully');
  // docs often shorten paths: accept a unique-enough suffix match
  if (facts.files.some((p) => p.endsWith('/' + rel)) || [...facts.dirs].some((d) => d.endsWith('/' + rel))) return R('ok', 'exists (shortened path)');
  const tb = path.posix.basename(rel).toLowerCase();
  const cand = closestFiles(rel, cl.dir ? [...facts.dirs].filter(Boolean) : facts.files, { from: file, limit: 3 })
    .find((p) => levenshtein(path.posix.basename(p).toLowerCase(), tb) <= Math.max(2, Math.floor(tb.length / 3)));
  if (cand) {
    const to = cl.text.startsWith('.') ? path.posix.relative(fileDir(file) || '.', cand) : cand + (cl.dir ? '/' : '');
    return R('false', `${cl.path} does not exist`, `replace ${code(cl.text)} with ${code(to)}`, { from: cl.text, to });
  }
  return R('false', `${cl.path} does not exist`, 'update the path or remove the mention');
}

function checkEnv(cl, facts) {
  if (facts.envNames.has(cl.name)) return R('ok', `listed in ${facts.envExampleFiles[0] || '.env'}`);
  const src = facts.sourceNames();
  if (src.has(cl.name)) return R('ok', 'referenced in source/config files');
  if (!facts.envExampleFiles.length) return R('unknown', 'no .env.example to check against');
  const near = closest(cl.name, facts.envNames);
  const ev = `not in ${facts.envExampleFiles.join(', ')} and not referenced in source`;
  if (near) return R('false', ev, `replace ${code(cl.name)} with ${code(near)}`, { from: cl.name, to: near });
  return R('false', ev, `add ${cl.name} to ${facts.envExampleFiles[0]} or remove the mention`);
}

function checkPort(cl, facts, siblings) {
  // a command on the same line with an explicit port is authoritative
  for (const s of siblings) {
    if (s.kind !== 'command' || !['npm', 'pnpm', 'yarn', 'bun'].includes(s.cmd.tool)) continue;
    const name = s.cmd.args[0] === 'run' ? s.cmd.args[1] : s.cmd.args[0];
    const body = name && facts.rootPkg?.scripts[name];
    const m = body && /(?:--port[= ]|-p\s+|\bPORT=)(\d{2,5})\b/.exec(body);
    if (m) {
      const real = Number(m[1]);
      if (real === cl.port) return R('ok', `"${name}" script sets port ${real}`);
      const to = cl.text.replace(String(cl.port), String(real));
      return R('false', `"${name}" script sets port ${real}`, `replace ${code(cl.text)} with ${code(to)}`, { from: cl.text, to });
    }
  }
  if (facts.ports.has(cl.port)) return R('ok', `port ${cl.port} is configured in the project`);
  return R('unknown', 'no explicit port configuration found');
}

function checkScript(cl, facts) {
  const names = new Set();
  for (const p of facts.pkgs.values()) for (const n of Object.keys(p.scripts)) names.add(n);
  for (const n of facts.composer?.scripts || []) names.add(n);
  if (!facts.pkgs.size && !facts.composer) return R('unknown', 'no package.json or composer.json');
  if (names.has(cl.name)) return R('ok', `"${cl.name}" script exists`);
  const near = closest(cl.name, names);
  if (near) return R('false', `no "${cl.name}" script`, `replace ${code(cl.name)} with ${code(near)}`, { from: cl.name, to: near });
  return R('false', `no "${cl.name}" script in any manifest`, 'add the script or remove the mention');
}

export function checkClaim(cl, facts, file, siblings = []) {
  switch (cl.kind) {
    case 'command': {
      const c = cl.cmd;
      if (['npm', 'pnpm', 'yarn', 'bun'].includes(c.tool)) return checkPm(c, facts, file);
      if (c.tool === 'make') return checkMake(c, facts, file);
      if (c.tool === 'composer') return checkComposer(c, facts);
      return checkOther(c, facts);
    }
    case 'version': return checkVersion(cl, facts);
    case 'dependency': return checkDependency(cl, facts);
    case 'path': return checkPath(cl, facts, file);
    case 'env': return checkEnv(cl, facts);
    case 'port': return checkPort(cl, facts, siblings);
    case 'script': return checkScript(cl, facts);
    default: return R('unknown', 'not checked');
  }
}
