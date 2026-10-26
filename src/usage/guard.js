// Every file the usage reader opens goes through here: a hard denylist of agent secrets and private state,
// checked on the requested path and on its real path, then a single-descriptor read (files/safeio.js).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readRegularAsync } from '../files/safeio.js';

export const homeOf = (ctx) => ctx?.home || os.homedir();
export const claudeDir = (home) => path.join(home, '.claude');

const DENY_CLAUDE = [/^\.credentials\.json$/, /^sessions\/.*\.key$/, /^remote(\/|$)/, /^state(\/|$)/, /^paste-cache(\/|$)/];
const DENY_CODEX = [/^auth\.json$/];
const DENY_ANY = /(^|\/)\.credentials\.json$/;

function relUnder(base, p) {
  const r = path.relative(base, p);
  return !r || r.startsWith('..') || path.isAbsolute(r) ? null : r.split(path.sep).join('/');
}

/** True when `abs` is a file the usage reader must never open. */
export function isDenied(abs, home) {
  const p = path.resolve(String(abs));
  if (DENY_ANY.test(p.split(path.sep).join('/'))) return true;
  const c = relUnder(path.join(home, '.claude'), p);
  if (c !== null && DENY_CLAUDE.some((re) => re.test(c))) return true;
  const x = relUnder(path.join(home, '.codex'), p);
  if (x !== null && DENY_CODEX.some((re) => re.test(x))) return true;
  return false;
}

/**
 * Read a file for usage analytics: null when denied, missing, not a regular file or too large.
 * opts: { tail, maxBytes, confine } (see readRegularAsync); symlinks are followed but the target is denylist-checked too.
 */
export async function safeRead(abs, home, opts = {}) {
  if (isDenied(abs, home)) return null;
  let real;
  try { real = await fs.promises.realpath(abs); } catch { return null; }
  if (isDenied(real, home)) return null;
  return readRegularAsync(real, { follow: false, ...opts });
}

/** Directory entries ([] when missing or denied). */
export async function safeReaddir(dir, home) {
  if (isDenied(dir, home)) return [];
  try { return await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return []; }
}

export async function safeStat(abs, home) {
  if (isDenied(abs, home)) return null;
  try { return await fs.promises.stat(abs); } catch { return null; }
}

/** Number of entries in ~/.claude/paste-cache (the contents are never read). */
export async function pasteCacheCount(home) {
  try { return (await fs.promises.readdir(path.join(home, '.claude', 'paste-cache'))).length; } catch { return 0; }
}
