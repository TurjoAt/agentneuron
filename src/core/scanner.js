import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { classify, isCandidate, isIgnored } from './classify.js';
import { estimateTokens } from './tokens.js';
import { readRegularAsync } from '../files/safeio.js';

const DEFAULT_MAX = 1048576;
function findTitle(content) {
  let inFence = false;
  let i = 0;
  const lines = content.split('\n');
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) i = end + 1;
  }
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^#\s+(.+?)\s*#*\s*$/.exec(l);
    if (m) return m[1];
  }
  return null;
}

export function countLines(content) {
  if (!content) return 0;
  const n = content.split('\n').length;
  return content.endsWith('\n') ? n - 1 : n;
}

/** Read one file into a FileEntry plus its content; null if missing, not a file, too big or binary. */
export async function readEntry(root, relPath, maxSize = DEFAULT_MAX, extraPatterns = []) {
  const abs = path.join(root, relPath);
  try {
    const r = await readRegularAsync(abs, { maxBytes: maxSize, confine: root });
    if (!r || r.buf.includes(0)) return null;
    const { buf, st } = r;
    const content = buf.toString('utf8');
    const { tool, kind } = classify(relPath, extraPatterns);
    const name = path.posix.basename(relPath);
    const dir = path.posix.dirname(relPath);
    return {
      entry: {
        path: relPath,
        name,
        dir: dir === '.' ? '' : dir,
        tool,
        kind,
        ext: path.posix.extname(relPath),
        size: st.size,
        mtime: Math.floor(st.mtimeMs),
        hash: crypto.createHash('sha1').update(buf).digest('hex'),
        tokens: estimateTokens(content),
        lines: countLines(content),
        title: findTitle(content),
      },
      content,
    };
  } catch {
    return null;
  }
}

/** Walk the project and return [{ entry, content }] (sorted by path). Each file is read once. */
export async function scanFiles(root, config = {}) {
  const maxSize = config.maxFileSize ?? DEFAULT_MAX;
  const extra = config.extraPatterns || [];
  const out = [];

  async function walk(rel) {
    let dirents;
    try { dirents = await fs.promises.readdir(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const d of dirents) {
      const childRel = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (!isIgnored(childRel, config)) await walk(childRel);
      } else if (d.isFile() && isCandidate(childRel, config)) {
        const r = await readEntry(root, childRel, maxSize, extra);
        if (r) out.push(r);
      }
    }
  }
  await walk('');
  return out.sort((a, b) => (a.entry.path < b.entry.path ? -1 : a.entry.path > b.entry.path ? 1 : 0));
}

/** Walk the project and return FileEntry[] (sorted by path). */
export async function scan(root, config = {}) {
  return (await scanFiles(root, config)).map((r) => r.entry);
}
