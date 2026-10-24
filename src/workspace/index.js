import fs from 'node:fs';
import path from 'node:path';
import { runGit } from '../git2/run.js';
import * as instances from './instances.js';
import { readRegular } from '../files/safeio.js';

export { instances };

const SKIP = new Set(['node_modules', 'vendor', 'dist', 'build', '.git', '.cache', '.next', '.nuxt', 'target', 'venv', '.venv', '__pycache__', 'coverage', 'storage', '.idea', '.vscode', 'tmp']);
const STACK_FILES = [
  ['package.json', 'node'], ['composer.json', 'php'], ['pyproject.toml', 'python'], ['requirements.txt', 'python'], ['go.mod', 'go'],
  ['Cargo.toml', 'rust'], ['Gemfile', 'ruby'], ['pom.xml', 'java'], ['build.gradle', 'java'], ['build.gradle.kts', 'java'],
  ['artisan', 'laravel'], ['next.config.js', 'next'], ['next.config.mjs', 'next'], ['next.config.ts', 'next'], ['nuxt.config.ts', 'nuxt'], ['nuxt.config.js', 'nuxt'],
  ['vite.config.js', 'vite'], ['vite.config.ts', 'vite'], ['svelte.config.js', 'svelte'], ['astro.config.mjs', 'astro'], ['tsconfig.json', 'typescript'],
  ['Dockerfile', 'docker'], ['docker-compose.yml', 'docker'], ['compose.yaml', 'docker'], ['deno.json', 'deno'],
];
const AI_FILES = [
  ['CLAUDE.md', 'claude'], ['.claude', 'claude'], ['AGENTS.md', 'codex'], ['.codex', 'codex'], ['.cursor', 'cursor'], ['.cursorrules', 'cursor'],
  ['.github/copilot-instructions.md', 'copilot'], ['GEMINI.md', 'gemini'], ['.gemini', 'gemini'], ['.windsurf', 'windsurf'], ['.windsurfrules', 'windsurf'],
  ['.clinerules', 'cline'], ['.roo', 'roo'], ['CONVENTIONS.md', 'aider'], ['.aider.conf.yml', 'aider'], ['.junie', 'junie'],
];
const PROJECT_MARKERS = new Set(['.git', '.agentneuron', 'package.json', 'composer.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'Gemfile', 'pom.xml', 'CLAUDE.md', 'AGENTS.md', '.claude', '.cursor']);

function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !SKIP.has(d.name) && !d.name.startsWith('.'))
      .map((d) => d.name).sort();
  } catch { return []; }
}

function isProject(dir) {
  try { return fs.readdirSync(dir).some((n) => PROJECT_MARKERS.has(n)); } catch { return false; }
}

function countMd(dir, depth = 0, acc = { n: 0, last: 0 }) {
  if (acc.n >= 2000) return acc;
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    if (e.isDirectory()) {
      if (depth < 3 && !SKIP.has(e.name) && !(e.name.startsWith('.') && e.name !== '.claude' && e.name !== '.cursor')) countMd(path.join(dir, e.name), depth + 1, acc);
    } else if (e.isFile() && /\.(md|mdc|markdown)$/i.test(e.name)) {
      acc.n++;
      try { acc.last = Math.max(acc.last, fs.statSync(path.join(dir, e.name)).mtimeMs); } catch { /* gone */ }
    }
  }
  return acc;
}

function branchOf(dir) {
  try {
    const g = path.join(dir, '.git');
    let head = path.join(g, 'HEAD');
    const ptr = readRegular(g, { follow: true, maxBytes: 4096 }); // worktree/submodule pointer file
    if (ptr) {
      const m = /gitdir:\s*(.+)/.exec(ptr.buf.toString('utf8'));
      if (!m) return null;
      head = path.join(path.resolve(dir, m[1].trim()), 'HEAD');
    }
    const s = fs.readFileSync(head, 'utf8').trim();
    const m = /^ref: refs\/heads\/(.+)$/.exec(s);
    return m ? m[1] : s.slice(0, 7);
  } catch { return null; }
}

async function dirtyOf(dir) {
  if (!exists(path.join(dir, '.git'))) return null;
  const r = await runGit(dir, ['status', '--porcelain=v1', '--untracked-files=normal'], { timeout: 3000 });
  return r.ok ? r.out.split('\n').filter(Boolean).length : null;
}

export async function describeProject(dir) {
  const stacks = new Set();
  for (const [f, s] of STACK_FILES) if (exists(path.join(dir, f))) stacks.add(s);
  const ai = new Set();
  for (const [f, t] of AI_FILES) if (exists(path.join(dir, f))) ai.add(t);
  const md = countMd(dir);
  let lm = md.last;
  try { lm = Math.max(lm, fs.statSync(dir).mtimeMs); } catch { /* ignore */ }
  return {
    name: path.basename(dir), path: dir, stacks: [...stacks], aiTools: [...ai], mdFiles: md.n,
    lastModified: Math.floor(lm), hasAgentneuron: exists(path.join(dir, '.agentneuron')),
    git: { branch: branchOf(dir), dirty: await dirtyOf(dir) },
    running: null,
  };
}

export function workspaceRoot(ctx) {
  return path.resolve(ctx.config?.workspaceRoot || path.dirname(ctx.root));
}

/** Find project dirs under `root` (depth ≤ 2). Pure fs sniffing. */
export function findProjects(root, maxDepth = 2) {
  const found = [];
  const walk = (dir, depth) => {
    for (const n of listDirs(dir)) {
      const p = path.join(dir, n);
      if (isProject(p)) found.push(p);
      else if (depth < maxDepth) walk(p, depth + 1);
    }
  };
  walk(root, 1);
  return found;
}

const cache = new Map(); // root -> { ts, list }
export async function scanWorkspace(root, { ttl = 60000, force = false, now = Date.now() } = {}) {
  const c = cache.get(root);
  if (!force && c && now - c.ts < ttl) return c.list;
  const dirs = findProjects(root);
  const list = [];
  for (let i = 0; i < dirs.length; i += 6) list.push(...await Promise.all(dirs.slice(i, i + 6).map((d) => describeProject(d))));
  list.sort((a, b) => b.lastModified - a.lastModified);
  cache.set(root, { ts: now, list });
  return list;
}
export function clearCache() { cache.clear(); }

export async function workspace(ctx, opts = {}) {
  const root = workspaceRoot(ctx);
  const list = await scanWorkspace(root, opts);
  const cur = path.resolve(ctx.root);
  const projects = list.map((p) => ({ ...p, running: p.path === cur ? (ctx.url ? { url: ctx.url } : p.running) : (instances.runningUrl(p.path) ? { url: instances.runningUrl(p.path) } : null) }));
  return { root, current: cur, projects };
}

/** Is `dir` an existing directory inside the workspace root (or the current project)? */
export function resolveProjectDir(ctx, dir) {
  if (typeof dir !== 'string' || !dir || dir.includes('\0')) return null;
  const wr = workspaceRoot(ctx);
  let abs;
  try { abs = fs.realpathSync(path.resolve(wr, dir)); } catch { return null; }
  let base; try { base = fs.realpathSync(wr); } catch { return null; }
  const rel = path.relative(base, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  try { if (!fs.statSync(abs).isDirectory()) return null; } catch { return null; }
  return abs;
}
