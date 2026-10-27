// Detect how to check a project: package scripts (test/build/lint/typecheck), composer test, pytest, go test,
// cargo test. Static: reads manifests through detectProject (cached), never spawns.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { detectProject } from '../project/index.js';
import { buildCommand } from '../actions/packages.js';

export const KINDS = ['test', 'build', 'lint', 'typecheck'];
export const CHECK_ID = /^[a-z]+:[\w:.@/-]{1,80}$/;

/** script name -> kind (null: not a check). */
export function kindOfScript(name) {
  const n = String(name).toLowerCase();
  if (/^(pre|post)/.test(n) && !/^(prettier|preview)/.test(n)) return null;
  if (/(^|:)(watch|dev|serve|start)($|:)/.test(n) || /:watch$|--watch/.test(n)) return null;
  if (n === 'test' || n === 'tests' || n === 'test:unit' || n === 'test:ci' || n === 'unit') return 'test';
  if (n === 'build' || n === 'compile') return 'build';
  if (n === 'lint' || n === 'lint:check' || n === 'eslint') return 'lint';
  if (n === 'typecheck' || n === 'type-check' || n === 'types' || n === 'check:types' || n === 'tsc' || n === 'check') return 'typecheck';
  return null;
}

const exists = async (p) => { try { await fsp.access(p); return true; } catch { return false; } };

/**
 * @returns {Promise<Array<{ id, kind, label, command: string[], source }>>}
 * `command` is the argv the exec action runs (never a shell string).
 */
export async function detectChecks(root) {
  let proj;
  try { proj = await detectProject(root); } catch { proj = { scripts: [], manifests: [], packageManagers: [] }; }
  const out = [];
  const seenKind = new Map(); // manager -> Set(kind): one check per kind per manager, the canonical name wins
  const scripts = [...(proj.scripts || [])].filter((s) => s.source === 'package.json' || s.source === 'composer.json')
    .sort((a, b) => a.name.length - b.name.length);
  for (const s of scripts) {
    const kind = kindOfScript(s.name);
    if (!kind) continue;
    const key = `${s.manager}`;
    if (!seenKind.has(key)) seenKind.set(key, new Set());
    if (seenKind.get(key).has(kind)) continue;
    let argv;
    try { const [cmd, args] = buildCommand('script', { manager: s.manager, name: s.name }); argv = [cmd, ...args]; } catch { continue; }
    seenKind.get(key).add(kind);
    out.push({ id: `${s.manager}:${s.name}`, kind, label: `${s.manager} run ${s.name}`, command: argv, source: `${s.source}#scripts.${s.name}`, script: String(s.command || '').slice(0, 300) });
  }
  const manifests = proj.manifests || [];
  const has = (t) => manifests.some((m) => m.type === t);
  if (has('python')) {
    const py = manifests.find((m) => m.type === 'python');
    const dev = JSON.stringify(py?.deps || {});
    const cfg = await Promise.all(['pytest.ini', 'conftest.py', 'tests', 'test'].map((f) => exists(path.join(root, f))));
    if (/pytest/i.test(dev) || cfg.some(Boolean)) out.push({ id: 'pytest:all', kind: 'test', label: 'pytest', command: ['python', '-m', 'pytest', '-q', '-rfE'], source: py?.path || 'pytest.ini' });
  }
  if (has('go')) {
    out.push({ id: 'go:test', kind: 'test', label: 'go test ./...', command: ['go', 'test', './...'], source: 'go.mod' });
    out.push({ id: 'go:vet', kind: 'lint', label: 'go vet ./...', command: ['go', 'vet', './...'], source: 'go.mod' });
  }
  if (has('cargo')) {
    out.push({ id: 'cargo:test', kind: 'test', label: 'cargo test', command: ['cargo', 'test'], source: 'Cargo.toml' });
    out.push({ id: 'cargo:build', kind: 'build', label: 'cargo build', command: ['cargo', 'build'], source: 'Cargo.toml' });
  }
  if (has('composer') && !out.some((c) => c.id.startsWith('composer:') && c.kind === 'test')) {
    if (await exists(path.join(root, 'vendor/bin/phpunit')) || await exists(path.join(root, 'phpunit.xml')) || await exists(path.join(root, 'phpunit.xml.dist'))) {
      if (await exists(path.join(root, 'artisan'))) out.push({ id: 'artisan:test', kind: 'test', label: 'php artisan test', command: ['php', 'artisan', 'test', '--no-ansi'], source: 'artisan' });
      else out.push({ id: 'phpunit:all', kind: 'test', label: 'vendor/bin/phpunit', command: ['php', 'vendor/bin/phpunit', '--colors=never'], source: 'phpunit.xml' });
    }
  }
  const order = { test: 0, typecheck: 1, lint: 2, build: 3 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.id.localeCompare(b.id));
}
