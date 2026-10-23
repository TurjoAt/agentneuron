import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { lineDiff } from './diff.js';

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

function safeName(relPath) {
  const enc = encodeURIComponent(relPath).replace(/%/g, '_');
  return enc.length > 150 ? `${enc.slice(0, 60)}-${sha1(relPath).slice(0, 16)}` : enc;
}

/** Local time-travel history stored under <root>/.mdctl/history/<encoded path>/. */
export function createHistory(root, config = {}) {
  const base = path.join(root, '.mdctl', 'history');
  const limit = Math.max(1, config.historyLimitPerFile ?? 200);
  let lastTs = 0;

  const dirOf = (p) => path.join(base, safeName(p));

  function readIndex(p) {
    try {
      const arr = JSON.parse(fs.readFileSync(path.join(dirOf(p), 'index.json'), 'utf8'));
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }

  function writeIndex(p, arr) {
    const dir = dirOf(p);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `index.json.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(arr));
    fs.renameSync(tmp, path.join(dir, 'index.json'));
  }

  const contentFile = (p, id) => path.join(dirOf(p), `${id}.txt`);

  function get(p, id) {
    if (!/^[\w-]+$/.test(String(id))) return null;
    try { return fs.readFileSync(contentFile(p, id), 'utf8'); } catch { return null; }
  }

  function record(p, content) {
    const idx = readIndex(p);
    const hash = sha1(content);
    const last = idx[idx.length - 1];
    if (last && last.hash === hash) return null;
    const prev = last ? get(p, last.id) ?? '' : '';
    const { added, removed } = lineDiff(prev, content);
    let ts = Date.now();
    if (ts <= lastTs) ts = lastTs + 1;
    lastTs = ts;
    const entry = {
      id: `${ts}-${hash.slice(0, 6)}`,
      path: p,
      ts,
      hash,
      size: Buffer.byteLength(content),
      added,
      removed,
    };
    fs.mkdirSync(dirOf(p), { recursive: true });
    fs.writeFileSync(contentFile(p, entry.id), content);
    idx.push(entry);
    while (idx.length > limit) {
      const old = idx.shift();
      try { fs.unlinkSync(contentFile(p, old.id)); } catch { /* already gone */ }
    }
    writeIndex(p, idx);
    return entry;
  }

  function list(p) { return readIndex(p).reverse(); }
  function latest(p) { const i = readIndex(p); return i[i.length - 1] || null; }

  function restore(p, id) {
    const content = get(p, id);
    if (content === null) throw new Error(`History version not found: ${p}@${id}`);
    const abs = path.resolve(root, p);
    if (!abs.startsWith(path.resolve(root) + path.sep)) throw new Error('Path escapes project root');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return record(p, content) || latest(p);
  }

  return { record, list, get, latest, restore };
}
