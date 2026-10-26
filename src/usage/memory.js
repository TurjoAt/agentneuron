// Claude Code memory files (~/.claude/projects/<dir>/memory/*.md) and plans (~/.claude/plans/*.md).
import fs from 'node:fs';
import path from 'node:path';
import { maskSecretsInText } from '../health/secrets.js';
import { safeRead, safeReaddir } from './guard.js';

const MAX_BODY = 20000;
const MAX_FILES = 200;

/** Minimal frontmatter: `key: value` pairs and one level of nesting (metadata:\n  type: x). */
export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data = {};
  let parent = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(\s*)([\w.-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const val = kv[3].replace(/^["']|["']$/g, '').trim();
    if (kv[1].length && parent) { if (typeof data[parent] !== 'object' || data[parent] === null) data[parent] = {}; data[parent][kv[2]] = val; continue; }
    if (val === '') { parent = kv[2]; data[kv[2]] = {}; } else { parent = null; data[kv[2]] = val; }
  }
  return { data, body: text.slice(m[0].length) };
}

const str = (v, n = 300) => (typeof v === 'string' ? maskSecretsInText(v).slice(0, n) : null);

/** Backticked repo paths in a memory body that no longer exist under root. */
async function staleClaims(body, root) {
  if (!root) return [];
  const out = [];
  const seen = new Set();
  for (const m of body.matchAll(/`((?:\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)+\.\w{1,8})`/g)) {
    const p = m[1];
    if (seen.has(p) || p.startsWith('/') || p.includes('..') || out.length >= 20) continue;
    seen.add(p);
    try { await fs.promises.access(path.join(root, p)); } catch { out.push({ claim: p, reason: 'path not found in the project' }); }
  }
  return out;
}

export async function readMemory({ dirs, home, root }) {
  const memory = [];
  for (const { dir, name } of dirs) {
    const md = path.join(dir, 'memory');
    const ents = (await safeReaddir(md, home)).filter((e) => e.isFile() && e.name.endsWith('.md')).slice(0, MAX_FILES);
    for (const e of ents) {
      const r = await safeRead(path.join(md, e.name), home, { maxBytes: 1024 * 1024 });
      if (!r) continue;
      const text = r.buf.toString('utf8');
      const { data, body } = frontmatter(text);
      const meta = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
      const links = [...new Set([...body.matchAll(/\]\(([^)\s]+\.md)\)/g)].map((m) => m[1]))].slice(0, 50);
      memory.push({
        project: name, file: e.name, name: str(data.name, 200) || e.name.replace(/\.md$/, ''), description: str(data.description, 500),
        type: str(meta.type || data.type, 40) || (e.name === 'MEMORY.md' ? 'index' : null),
        body: maskSecretsInText(body.slice(0, MAX_BODY)), updatedAt: r.st.mtimeMs, links, stale: await staleClaims(body, root),
      });
    }
  }
  return memory.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Plans whose file name matches a slug seen in the given sessions (all plans when `slugs` is null). */
export async function readPlans({ home, slugs }) {
  const dir = path.join(home, '.claude', 'plans');
  const ents = (await safeReaddir(dir, home)).filter((e) => e.isFile() && e.name.endsWith('.md'));
  const plans = [];
  for (const e of ents) {
    const base = e.name.replace(/\.md$/, '');
    if (slugs && !slugs.has(base)) continue;
    const r = await safeRead(path.join(dir, e.name), home, { maxBytes: 1024 * 1024 });
    if (!r) continue;
    const text = r.buf.toString('utf8');
    const h = /^#\s+(.+)$/m.exec(text);
    plans.push({ file: e.name, title: str(h ? h[1] : base, 200), updatedAt: r.st.mtimeMs, body: maskSecretsInText(text.slice(0, MAX_BODY)) });
    if (plans.length >= MAX_FILES) break;
  }
  return plans.sort((a, b) => b.updatedAt - a.updatedAt);
}
