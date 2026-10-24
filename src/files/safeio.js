// Read a regular file through one descriptor, so the file that is checked (type, size, location) is the
// file that is read, even if the path is swapped for a symlink in between.
import fs from 'node:fs';
import path from 'node:path';

const C = fs.constants;
// O_NONBLOCK keeps a FIFO from blocking the open; O_NOFOLLOW refuses a symlink as the last component.
const BASE = C.O_RDONLY | (C.O_NONBLOCK || 0);
const NOFOLLOW = C.O_NOFOLLOW || 0;

const inside = (real, root) => real === root || real.startsWith(root + path.sep);
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;

/**
 * Open `abs` and return `{ buf, st }`, or null if it is missing, not a regular file, larger than `maxBytes`,
 * a symlink (unless `follow`), or (with `confine`, a root directory) located outside `confine`.
 * `tail` reads only the last `tail` bytes.
 */
export function readRegular(abs, { maxBytes = Infinity, follow = false, confine = null, tail = 0 } = {}) {
  let fd;
  try { fd = fs.openSync(abs, BASE | (follow ? 0 : NOFOLLOW)); } catch { return null; }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > maxBytes) return null;
    if (!follow && !NOFOLLOW && fs.lstatSync(abs).isSymbolicLink()) return null;
    if (confine) {
      const real = fs.realpathSync(abs);
      if (!inside(real, fs.realpathSync(confine)) || !same(fs.statSync(real), st)) return null;
    }
    if (tail && st.size > tail) {
      const buf = Buffer.alloc(tail);
      const n = fs.readSync(fd, buf, 0, tail, st.size - tail);
      return { buf: buf.subarray(0, n), st };
    }
    return { buf: fs.readFileSync(fd), st };
  } catch { return null; } finally { try { fs.closeSync(fd); } catch { /* ignore */ } }
}

/** Async twin of readRegular (no `tail`). */
export async function readRegularAsync(abs, { maxBytes = Infinity, follow = false, confine = null } = {}) {
  let fh;
  try { fh = await fs.promises.open(abs, BASE | (follow ? 0 : NOFOLLOW)); } catch { return null; }
  try {
    const st = await fh.stat();
    if (!st.isFile() || st.size > maxBytes) return null;
    if (!follow && !NOFOLLOW && (await fs.promises.lstat(abs)).isSymbolicLink()) return null;
    if (confine) {
      const real = await fs.promises.realpath(abs);
      if (!inside(real, await fs.promises.realpath(confine)) || !same(await fs.promises.stat(real), st)) return null;
    }
    return { buf: await fh.readFile(), st };
  } catch { return null; } finally { await fh.close().catch(() => {}); }
}
