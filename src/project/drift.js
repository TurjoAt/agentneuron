// Doc drift: docs that mention code files which changed (git) after the doc did.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';

const DOC_RE = /\.(md|mdc|mdx|markdown)$/i;
const PATH_RE = /(?<![\w@:/.-])((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z][A-Za-z0-9]{0,5})(?![\w-])/g;
const CODE_EXT = new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'svelte', 'vue', 'astro', 'php', 'py', 'go', 'rs', 'rb', 'java', 'kt', 'cs', 'c', 'h', 'cpp', 'css', 'scss', 'html', 'json', 'yml', 'yaml', 'toml', 'sh', 'sql', 'xml', 'env', 'lock', 'blade']);

function gitLog(root) {
  return new Promise((resolve) => {
    execFile('git', ['log', '--relative', '--name-only', '--no-renames', '--format=%x1e%ct', '-n', '3000'], { cwd: root, timeout: 15000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' } },
      (err, out) => resolve(err ? null : out));
  });
}

/** Extract existing code-file mentions (project-relative) from a markdown text. */
export function extractMentions(root, docPath, text) {
  const clean = text.replace(/https?:\/\/\S+/g, ' ');
  const found = new Set();
  const docDir = path.posix.dirname(docPath);
  for (const m of clean.matchAll(PATH_RE)) {
    const raw = m[1];
    const ext = raw.split('.').pop().toLowerCase();
    if (!CODE_EXT.has(ext) || DOC_RE.test(raw)) continue;
    for (const cand of [path.posix.normalize(path.posix.join(docDir, raw)), path.posix.normalize(raw)]) {
      if (cand.startsWith('..') || path.posix.isAbsolute(cand)) continue;
      try {
        const abs = path.resolve(root, cand);
        if (abs.startsWith(path.resolve(root) + path.sep) && fs.statSync(abs).isFile()) { found.add(cand); break; }
      } catch { /* not a file */ }
    }
  }
  return [...found];
}

export async function docDrift(root, files = [], git = null) {
  try { if (git && typeof git.available === 'function' && !(await git.available())) return []; } catch { return []; }
  const out = await gitLog(root);
  if (!out) return [];
  const times = new Map(); // path -> [{c, ts}] newest first
  const ts = [];
  out.split('\x1e').slice(1).forEach((blk, c) => {
    const lines = blk.split('\n');
    const t = Number(lines[0]) * 1000; ts[c] = t;
    for (const l of lines.slice(1)) {
      const f = l.trim(); if (!f) continue;
      if (!times.has(f)) times.set(f, []);
      times.get(f).push({ c, ts: t });
    }
  });
  const res = [];
  const docs = files.filter((f) => DOC_RE.test(f.path) && !/(^|\/)CHANGELOG/i.test(f.path)).slice(0, 400);
  for (const d of docs) {
    let text; try { text = await fsp.readFile(path.join(root, d.path), 'utf8'); } catch { continue; }
    const docEntries = times.get(d.path);
    let docChangedAt = docEntries?.[0]?.ts;
    if (!docChangedAt) { try { docChangedAt = (await fsp.stat(path.join(root, d.path))).mtimeMs; } catch { continue; } }
    const mentions = extractMentions(root, d.path, text);
    let codeChangedAt = 0; const commits = new Set(); const stale = [];
    for (const m of mentions) {
      const es = times.get(m); if (!es?.length) continue;
      if (es[0].ts > docChangedAt) {
        stale.push(m);
        codeChangedAt = Math.max(codeChangedAt, es[0].ts);
        for (const e of es) if (e.ts > docChangedAt) commits.add(e.c);
      }
    }
    if (!stale.length) continue;
    const days = (codeChangedAt - docChangedAt) / 86400000;
    const severity = days > 60 || commits.size >= 10 ? 'high' : days > 14 || commits.size >= 3 ? 'medium' : 'low';
    res.push({ doc: d.path, mentions: stale, docChangedAt, codeChangedAt, commitsSince: commits.size, severity });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return res.sort((a, b) => rank[a.severity] - rank[b.severity] || b.commitsSince - a.commitsSince);
}
