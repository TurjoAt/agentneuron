// Bounded source-file listing + reading for the static scanners.
// Prefers git's file list (tracked + untracked-not-ignored), falls back to a capped async walk.
// Skips dependency/build/VCS folders, binaries, minified files and lockfiles; caps file count, size and total bytes.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { readRegularAsync } from '../files/safeio.js';
import { trackedFiles, untrackedFiles } from './git.js';

export const LIMITS = { maxFiles: 6000, maxFileBytes: 512 * 1024, maxTotalBytes: 32 * 1024 * 1024, maxWalkEntries: 60000, timeBudgetMs: 6000 };

export const SKIP_DIRS = new Set(['node_modules', 'vendor', 'dist', 'build', '.git', '.hg', '.svn', 'coverage', '.next', '.nuxt', '.svelte-kit', '.output',
  'out', 'target', '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache', '.agentneuron', 'bower_components', '.cache', '.parcel-cache',
  '.turbo', '.vercel', '.netlify', '.serverless', '.terraform', 'storage', 'tmp', '.idea', '.vscode', '.gradle', 'Pods', '.dart_tool', 'public/build', 'jspm_packages']);

const TEXT_EXT = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|php|py|rb|go|rs|java|kt|cs|html?|erb|twig|ya?ml|toml|json|ini|cfg|conf|env|sh|properties|xml|gradle|tf)$/i;
const SKIP_FILE = /(?:\.min\.[jc]ss?$|\.map$|(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|composer\.lock|poetry\.lock|Cargo\.lock|Gemfile\.lock|go\.sum|bun\.lockb?)$)/;
const DOTENV = /(?:^|\/)\.env(?:\.[\w.-]+)?$/;

/** Path filter: true when the scanners should read this file. */
export function scannable(p) {
  if (!p || SKIP_FILE.test(p)) return false;
  const segs = p.split('/');
  for (let i = 0; i < segs.length - 1; i++) if (SKIP_DIRS.has(segs[i]) || (i > 0 && SKIP_DIRS.has(`${segs[i - 1]}/${segs[i]}`))) return false;
  const base = segs[segs.length - 1];
  return TEXT_EXT.test(base) || DOTENV.test(p) || base === 'Dockerfile' || base === 'Procfile';
}

async function walk(root, limits) {
  const out = [];
  const queue = [''];
  let entries = 0;
  let truncated = false;
  while (queue.length) {
    const rel = queue.shift();
    let ents;
    try { ents = await fsp.readdir(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (++entries > limits.maxWalkEntries) { truncated = true; break; }
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !SKIP_DIRS.has(p)) queue.push(p); } else if (e.isFile() && scannable(p)) out.push(p);
    }
    if (truncated) break;
  }
  return { files: out, truncated, source: 'walk' };
}

/** { files: [relPath], tracked: Set|null, source: 'git'|'walk', truncated } */
export async function listSourceFiles(root, limits = LIMITS) {
  const tracked = await trackedFiles(root).catch(() => null);
  if (tracked) {
    const untracked = await untrackedFiles(root, 20000).catch(() => []);
    const all = [...new Set([...tracked, ...untracked])].filter(scannable).sort();
    return { files: all, tracked: new Set(tracked), source: 'git', truncated: false };
  }
  const w = await walk(root, limits);
  return { ...w, files: w.files.sort(), tracked: null };
}

/**
 * Read files with caps. Calls `onFile(path, text, stat)` for each; returns { scanned, skipped, truncated, bytes, ms }.
 * `cached(path, stat)` may return true to skip the read (unchanged since last scan).
 */
export async function readBounded(root, files, { onFile, cached = () => false, limits = LIMITS } = {}) {
  const t0 = Date.now();
  let bytes = 0, scanned = 0, skipped = 0, truncated = false;
  const list = files.slice(0, limits.maxFiles);
  if (files.length > list.length) truncated = true;
  for (let i = 0; i < list.length; i += 32) {
    if (Date.now() - t0 > limits.timeBudgetMs || bytes > limits.maxTotalBytes) { truncated = true; break; }
    const chunk = list.slice(i, i + 32);
    const stats = await Promise.all(chunk.map((p) => fsp.lstat(path.join(root, p)).catch(() => null)));
    await Promise.all(chunk.map(async (p, k) => {
      const st = stats[k];
      if (!st || !st.isFile() || st.size > limits.maxFileBytes) { skipped++; return; }
      if (cached(p, st)) { scanned++; return; }
      const r = await readRegularAsync(path.join(root, p), { maxBytes: limits.maxFileBytes });
      if (!r) { skipped++; return; }
      if (r.buf.includes(0)) { skipped++; return; } // binary
      bytes += r.buf.length;
      scanned++;
      onFile(p, r.buf.toString('utf8'), st);
    }));
  }
  return { scanned, skipped, truncated, bytes, ms: Date.now() - t0 };
}

/** Test, fixture, mock, story, seed, example and docs paths: placeholder rules do not apply there. */
export function isTestLike(p) {
  return /(?:^|\/)(?:tests?|__tests__|__mocks__|spec|specs|e2e|cypress|playwright|fixtures?|mocks?|stubs?|seeds?|seeders|factories|stories|storybook|examples?|demos?|docs?|sandbox|playground)(?:\/|$)/i.test(p)
    || /\.(?:test|spec|stories|story|e2e|cy|mock|fixture)\.[\w]+$/i.test(p)
    || /(?:^|\/)(?:mock|mocks|fixture|fixtures|fake|fakes|stub|stubs|seed|demo|sample)[-._]?[\w-]*\.[\w]+$/i.test(p)
    || /(?:^|\/)test_[\w]+\.py$|_test\.(?:go|py)$|Test\.php$/.test(p);
}
