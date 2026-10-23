// Append-only JSONL files with size-based rotation (file -> file.1 -> .2 -> .3).
import fs from 'node:fs';
import path from 'node:path';

export const MAX_BYTES = 20 * 1024 * 1024;
export const KEEP = 3;

export function createJsonl(file, { maxBytes = MAX_BYTES, keep = KEEP } = {}) {
  let size = -1;
  function curSize() {
    if (size < 0) { try { size = fs.statSync(file).size; } catch { size = 0; } }
    return size;
  }
  function rotate() {
    try {
      try { fs.unlinkSync(`${file}.${keep}`); } catch { /* none */ }
      for (let i = keep - 1; i >= 1; i--) {
        try { fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`); } catch { /* none */ }
      }
      fs.renameSync(file, `${file}.1`);
    } catch { /* best effort */ }
    size = 0;
  }
  function append(obj) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const line = JSON.stringify(obj) + '\n';
      if (curSize() + line.length > maxBytes) rotate();
      fs.appendFileSync(file, line);
      size = curSize() + Buffer.byteLength(line);
      return true;
    } catch { return false; }
  }
  /** All parsed rows, oldest first (rotated files included). */
  function readAll() {
    const rows = [];
    for (let i = keep; i >= 0; i--) {
      const f = i === 0 ? file : `${file}.${i}`;
      let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
      for (const l of txt.split('\n')) {
        if (!l) continue;
        try { rows.push(JSON.parse(l)); } catch { /* skip torn line */ }
      }
    }
    return rows;
  }
  return { file, append, readAll, rotate };
}

export function filterRange(rows, { from, to, limit } = {}) {
  const f = from == null || from === '' ? -Infinity : Number(from);
  const t = to == null || to === '' ? Infinity : Number(to);
  let out = rows.filter((r) => r.ts >= f && r.ts <= t);
  const n = Number(limit);
  if (n > 0 && out.length > n) out = out.slice(out.length - n);
  return out;
}
