// Package / script / framework actions. Never spawns a shell; every argument is validated.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { detectProject, peekProject, hasBinary } from '../project/index.js';

export const MANAGERS = ['npm', 'pnpm', 'yarn', 'bun', 'composer', 'pip', 'poetry'];
export const ARTISAN_ALLOW = ['about', 'route:list', 'migrate:status', 'cache:clear', 'config:clear', 'view:clear', 'route:clear', 'optimize:clear', 'queue:failed', 'schedule:list'];

const NPM_NAME = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/;
const COMPOSER_NAME = /^[a-z0-9]([_.-]?[a-z0-9]+)*\/[a-z0-9]([_.-]?[a-z0-9]+)*$/;
const PY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const VERSION = /^[\w.^~<>=*|-]+$/;
const SCRIPT = /^[\w][\w:.@/-]*$/;
const BIN = { npm: 'npm', pnpm: 'pnpm', yarn: 'yarn', bun: 'bun', composer: 'composer', pip: 'pip', poetry: 'poetry' };
const MANIFEST_TYPE = { npm: 'npm', pnpm: 'npm', yarn: 'npm', bun: 'npm', composer: 'composer', pip: 'python', poetry: 'python' };
const bad = (m) => Object.assign(new Error(m), { status: 400 });

export function validateName(manager, name) {
  const re = manager === 'composer' ? COMPOSER_NAME : manager === 'pip' || manager === 'poetry' ? PY_NAME : NPM_NAME;
  if (typeof name !== 'string' || name.length > 214 || !re.test(name)) throw bad(`invalid package name for ${manager}: ${String(name).slice(0, 60)}`);
  return name;
}
export function validateVersion(v) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || v.length > 64 || !VERSION.test(v) || v.startsWith('-')) throw bad('invalid version');
  return v;
}
function manager(p) {
  if (!MANAGERS.includes(p.manager)) throw bad(`unknown manager: ${p.manager}`);
  return p.manager;
}
function spec(m, name, version) {
  if (!version) return name;
  if (m === 'composer') return `${name}:${version}`;
  if (m === 'pip') return /^[<>=!~]/.test(version) ? `${name}${version}` : /^\d/.test(version) ? `${name}==${version}` : name;
  if (m === 'poetry') return `${name}@${version}`;
  return `${name}@${version}`;
}

/** Build [cmd, args] for an action. Exported for tests. */
export function buildCommand(kind, p) {
  const m = manager(p);
  const bin = BIN[m];
  const name = kind !== 'script' && p.name != null && p.name !== '' ? validateName(m, p.name) : null;
  const version = validateVersion(p.version);
  switch (kind) {
    case 'install':
      return [bin, m === 'pip' ? ['install', '-r', 'requirements.txt'] : m === 'composer' ? ['install', '--no-interaction'] : ['install']];
    case 'add': {
      if (!name) throw bad('name is required');
      const s = spec(m, name, version); const dev = !!p.dev;
      if (m === 'npm') return [bin, ['install', s, ...(dev ? ['--save-dev'] : [])]];
      if (m === 'pnpm' || m === 'yarn') return [bin, ['add', s, ...(dev ? ['-D'] : [])]];
      if (m === 'bun') return [bin, ['add', s, ...(dev ? ['-d'] : [])]];
      if (m === 'composer') return [bin, ['require', s, '--no-interaction', ...(dev ? ['--dev'] : [])]];
      if (m === 'pip') return [bin, ['install', s]];
      return [bin, ['add', s, ...(dev ? ['--group', 'dev'] : [])]];
    }
    case 'remove': {
      if (!name) throw bad('name is required');
      if (m === 'npm') return [bin, ['uninstall', name]];
      if (m === 'composer') return [bin, ['remove', name, '--no-interaction']];
      if (m === 'pip') return [bin, ['uninstall', '-y', name]];
      return [bin, ['remove', name]];
    }
    case 'update': {
      if (m === 'pip') { if (!name) throw bad('pip update needs a package name'); return [bin, ['install', '--upgrade', name]]; }
      const verb = m === 'yarn' ? 'upgrade' : 'update';
      return [bin, [verb, ...(name ? [name] : []), ...(m === 'composer' ? ['--no-interaction'] : [])]];
    }
    case 'outdated':
      return { npm: ['npm', ['outdated', '--json']], pnpm: ['pnpm', ['outdated', '--format', 'json']], yarn: ['yarn', ['outdated', '--json']], bun: ['bun', ['outdated']],
        composer: ['composer', ['outdated', '--format=json', '--direct', '--no-interaction']], pip: ['pip', ['list', '--outdated', '--format=json']], poetry: ['poetry', ['show', '--outdated']] }[m];
    case 'audit':
      if (m === 'poetry') throw bad('poetry has no built-in audit');
      return { npm: ['npm', ['audit', '--json']], pnpm: ['pnpm', ['audit', '--json']], yarn: ['yarn', ['audit', '--json']], bun: ['bun', ['audit']],
        composer: ['composer', ['audit', '--format=json', '--no-interaction']], pip: ['pip-audit', ['--format', 'json']] }[m];
    case 'script': {
      if (typeof p.name !== 'string' || !SCRIPT.test(p.name) || p.name.startsWith('-')) throw bad('invalid script name');
      if (m === 'composer') return [bin, ['run-script', p.name]];
      if (m === 'pip' || m === 'poetry') throw bad('scripts.run supports npm, pnpm, yarn, bun, composer');
      return [bin, ['run', p.name]];
    }
    default: throw bad('unknown command kind');
  }
}

// ---- output parsers (exported for tests) ------------------------------------
const tryJson = (t) => { try { return JSON.parse(t); } catch { return null; } };

export function parseOutdated(m, stdout) {
  const t = String(stdout || '').trim();
  if (m === 'npm' || m === 'pnpm') {
    const j = tryJson(t) || {};
    return Object.entries(j).map(([name, v]) => {
      const x = Array.isArray(v) ? v[0] : v;
      return { name, current: x?.current ?? null, wanted: x?.wanted ?? null, latest: x?.latest ?? null, type: x?.dependencyType || x?.type || null };
    });
  }
  if (m === 'composer') return (tryJson(t)?.installed || []).map((x) => ({ name: x.name, current: x.version, wanted: null, latest: x.latest, type: x['latest-status'] || null }));
  if (m === 'pip') return (tryJson(t) || []).map((x) => ({ name: x.name, current: x.version, wanted: null, latest: x.latest_version, type: x.latest_filetype || null }));
  if (m === 'yarn') {
    for (const line of t.split('\n')) {
      const j = tryJson(line);
      const body = j?.type === 'table' ? j.data?.body : null;
      if (body) return body.map((r) => ({ name: r[0], current: r[1], wanted: r[2], latest: r[3], type: r[4] || null }));
    }
    return [];
  }
  if (m === 'poetry') {
    return t.split('\n').map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 3 && /^[A-Za-z0-9]/.test(c[0]) && /\d/.test(c[1]))
      .map((c) => ({ name: c[0], current: c[1], wanted: null, latest: c[2], type: null }));
  }
  return [];
}

export function parseAudit(m, stdout) {
  const t = String(stdout || '').trim();
  if (m === 'npm' || m === 'pnpm') {
    const v = (tryJson(t) || {}).metadata?.vulnerabilities;
    return v ? { total: v.total ?? Object.values(v).reduce((a, b) => a + (+b || 0), 0), ...v } : null;
  }
  if (m === 'composer') {
    const a = tryJson(t)?.advisories;
    if (!a) return null;
    return { total: Array.isArray(a) ? a.length : Object.values(a).reduce((n, l) => n + l.length, 0) };
  }
  if (m === 'pip') {
    const deps = tryJson(t)?.dependencies;
    return deps ? { total: deps.reduce((n, d) => n + (d.vulns?.length || 0), 0) } : null;
  }
  return null;
}

// ---- helpers ----------------------------------------------------------------
async function requireManifest(m, ctx) {
  const proj = await detectProject(ctx.root);
  const type = MANIFEST_TYPE[m];
  if (!proj.manifests.some((x) => x.type === type)) throw bad(`no ${type} manifest in project for ${m}`);
  if (!hasBinary(m === 'pip' ? 'pip' : BIN[m])) throw bad(`${BIN[m]} not found on PATH`);
  return proj;
}
const anyAvailable = (types, bins) => async (ctx) => {
  try {
    const p = await detectProject(ctx.root);
    return p.manifests.some((x) => types.includes(x.type)) && bins.some((b) => hasBinary(b));
  } catch { return false; }
};

export function cachePath(root, m) { return path.join(root, '.mdctl', 'cache', `outdated-${m}.json`); }
export async function readOutdatedCache(root) {
  const dir = path.join(root, '.mdctl', 'cache');
  const out = {};
  let names = []; try { names = await fsp.readdir(dir); } catch { return out; }
  for (const n of names) {
    const mm = /^outdated-(\w+)\.json$/.exec(n);
    if (!mm) continue;
    try { out[mm[1]] = JSON.parse(await fsp.readFile(path.join(dir, n), 'utf8')); } catch { /* skip */ }
  }
  return out;
}

const mgrParam = { type: 'enum', enum: MANAGERS, required: true, label: 'Package manager' };
const nameParam = (required, label = 'Package') => ({ type: 'string', required, label, pattern: '^@?[A-Za-z0-9][\\w.\\/-]*$' });
const versionParam = { type: 'string', required: false, label: 'Version (optional)', pattern: '^[\\w.^~<>=*|-]+$' };

export default function register(registry, ctx) {
  const anyPkg = anyAvailable(['npm', 'composer', 'python'], ['npm', 'pnpm', 'yarn', 'bun', 'composer', 'pip', 'poetry']);
  const simple = (kind, id, title, level, params, summary) => registry.register({
    id, title, category: 'packages', level, description: summary, params, available: anyPkg,
    preview: (p) => { const [cmd, args] = buildCommand(kind, p); return { command: [cmd, ...args], summary }; },
    run: async (p, c, job) => {
      await requireManifest(manager(p), ctx);
      const [cmd, args] = buildCommand(kind, p);
      const r = await job.exec(cmd, args, { cwd: '.' });
      if (r.code !== 0) throw new Error(`${cmd} exited with code ${r.code}`);
      return { code: r.code };
    },
  });
  simple('install', 'packages.install', 'Install dependencies', 'exec', { manager: mgrParam }, 'Install all dependencies from the manifest/lockfile');
  simple('add', 'packages.add', 'Add package', 'exec', { manager: mgrParam, name: nameParam(true), version: versionParam, dev: { type: 'boolean', default: false, label: 'As dev dependency' } }, 'Add a dependency');
  simple('remove', 'packages.remove', 'Remove package', 'exec', { manager: mgrParam, name: nameParam(true) }, 'Remove a dependency');
  simple('update', 'packages.update', 'Update packages', 'exec', { manager: mgrParam, name: nameParam(false) }, 'Update one package or all');

  registry.register({
    id: 'packages.outdated', title: 'Check outdated packages', category: 'packages', level: 'exec', description: 'List outdated dependencies (cached for the Project view)',
    params: { manager: mgrParam }, available: anyPkg,
    preview: (p) => { const [cmd, args] = buildCommand('outdated', p); return { command: [cmd, ...args], summary: 'Lists outdated dependencies' }; },
    run: async (p, c, job) => {
      const m = manager(p); await requireManifest(m, ctx);
      const [cmd, args] = buildCommand('outdated', p);
      const r = await job.exec(cmd, args, { cwd: '.' }); // non-zero exit is normal when outdated
      const items = parseOutdated(m, r.stdout);
      const doc = { manager: m, ts: Date.now(), items, ...(items.length === 0 && r.stdout && m === 'bun' ? { raw: String(r.stdout).slice(0, 20000) } : {}) };
      try {
        await fsp.mkdir(path.join(ctx.root, '.mdctl', 'cache'), { recursive: true });
        await fsp.writeFile(cachePath(ctx.root, m), JSON.stringify(doc));
      } catch { job.log?.('stderr', 'could not write .mdctl/cache'); }
      return { manager: m, count: items.length };
    },
  });
  registry.register({
    id: 'packages.audit', title: 'Security audit', category: 'packages', level: 'exec', description: 'Audit dependencies for known vulnerabilities',
    params: { manager: mgrParam }, available: anyPkg,
    preview: (p) => { const [cmd, args] = buildCommand('audit', p); return { command: [cmd, ...args], summary: 'Audits dependencies' }; },
    run: async (p, c, job) => {
      const m = manager(p); await requireManifest(m, ctx);
      const [cmd, args] = buildCommand('audit', p);
      const r = await job.exec(cmd, args, { cwd: '.' });
      return { manager: m, code: r.code, vulnerabilities: parseAudit(m, r.stdout) };
    },
  });

  // scripts.run: name must exist in the manifest
  const scriptExists = (proj, m, name) => proj.scripts.some((s) => s.manager === m && s.name === name);
  registry.register({
    id: 'scripts.run', title: 'Run script', category: 'scripts', level: 'exec', description: 'Run a script defined in package.json / composer.json',
    params: { manager: { type: 'enum', enum: ['npm', 'pnpm', 'yarn', 'bun', 'composer'], required: true, label: 'Runner' }, name: { type: 'string', required: true, label: 'Script', pattern: '^\\w[\\w:.@/-]*$' } },
    available: anyAvailable(['npm', 'composer'], ['npm', 'pnpm', 'yarn', 'bun', 'composer']),
    preview: (p) => {
      const [cmd, args] = buildCommand('script', p);
      const cached = peekProject(ctx.root);
      if (cached && !scriptExists(cached, p.manager, p.name)) throw bad(`script "${p.name}" not found for ${p.manager}`);
      return { command: [cmd, ...args], summary: `Runs script ${p.name}` };
    },
    run: async (p, c, job) => {
      const [cmd, args] = buildCommand('script', p);
      const proj = await requireManifest(p.manager, ctx);
      if (!scriptExists(proj, p.manager, p.name)) throw bad(`script "${p.name}" not found for ${p.manager}`);
      const r = await job.exec(cmd, args, { cwd: '.' });
      if (r.code !== 0) throw new Error(`${cmd} exited with code ${r.code}`);
      return { code: r.code };
    },
  });

  const artisanAvail = async () => {
    try { await fsp.access(path.join(ctx.root, 'artisan')); } catch { return false; }
    return hasBinary('php');
  };
  registry.register({
    id: 'framework.artisan', title: 'Run artisan command', category: 'framework', level: 'exec', description: 'Run an allow-listed read-only/cache artisan command',
    params: { command: { type: 'enum', enum: ARTISAN_ALLOW, required: true, label: 'Command' } }, available: artisanAvail,
    preview: (p) => {
      if (!ARTISAN_ALLOW.includes(p.command)) throw bad('command not allowed');
      return { command: ['php', 'artisan', p.command, '--no-interaction', '--no-ansi'], summary: `php artisan ${p.command}` };
    },
    run: async (p, c, job) => {
      if (!ARTISAN_ALLOW.includes(p.command)) throw bad('command not allowed');
      const r = await job.exec('php', ['artisan', p.command, '--no-interaction', '--no-ansi'], { cwd: '.' });
      if (r.code !== 0) throw new Error(`artisan exited with code ${r.code}`);
      return { code: r.code };
    },
  });
  registry.register({
    id: 'framework.artisan.migrate', title: 'Run migrations', category: 'framework', level: 'danger', description: 'php artisan migrate --force (changes the database)',
    params: { pretend: { type: 'boolean', default: false, label: 'Dry run (--pretend)' } }, available: artisanAvail,
    preview: (p) => ({ command: ['php', 'artisan', 'migrate', '--force', '--no-interaction', ...(p.pretend ? ['--pretend'] : [])], summary: p.pretend ? 'Shows the SQL migrations would run' : 'Runs pending migrations against the configured database' }),
    run: async (p, c, job) => {
      const r = await job.exec('php', ['artisan', 'migrate', '--force', '--no-interaction', ...(p.pretend ? ['--pretend'] : [])], { cwd: '.' });
      if (r.code !== 0) throw new Error(`artisan migrate exited with code ${r.code}`);
      return { code: r.code };
    },
  });
}
