// Cross-platform spawn without a shell. On Windows, npm/pnpm/yarn/npx/composer... are .cmd/.bat
// shims that CreateProcess cannot run (and Node >= 18.20.2 refuses: CVE-2024-27980). We resolve the
// command on PATH ourselves and run batch files via `cmd.exe /d /s /c "<escaped line>"` with
// verbatim arguments, escaping like cross-spawn (meta chars double-escaped because shims re-parse %*).
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';

const META = /([()\][%!^"`<>&|;, *?])/g;
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';
const RUNNABLE = /\.(com|exe|bat|cmd)$/i;
const BATCH = /\.(bat|cmd)$/i;

const envGet = (env, key) => { const k = Object.keys(env || {}).find((n) => n.toUpperCase() === key); return k ? env[k] : undefined; };
const defaultIsFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/** Caret-escape cmd.exe meta characters (used for the command path). */
export function escapeCommand(s) { return String(s).replace(META, '^$1'); }

/** Quote one argument for the MSVCRT parser, then caret-escape it for cmd.exe (twice for batch shims). */
export function escapeArgument(arg, doubleEscape = false) {
  let s = String(arg).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  s = `"${s}"`.replace(META, '^$1');
  return doubleEscape ? s.replace(META, '^$1') : s;
}

/**
 * Windows command lookup: PATH entries only (never cwd: actions run inside untrusted projects),
 * absolute entries only, extensions from PATHEXT limited to .com/.exe/.bat/.cmd, extensionless
 * files ignored (npm ships sh scripts named `npm` next to npm.cmd). Returns an absolute path or null.
 */
export function resolveWindowsCommand(cmd, { env = process.env, cwd, isFile = defaultIsFile } = {}) {
  const w = path.win32;
  const exts = String(envGet(env, 'PATHEXT') || DEFAULT_PATHEXT).split(';').map((e) => e.trim().toLowerCase()).filter((e) => RUNNABLE.test(e));
  const candidates = (base) => (RUNNABLE.test(base) ? [base] : exts.map((e) => base + e));
  const find = (base) => candidates(base).find((c) => isFile(c)) || null;
  if (/[\\/]/.test(cmd)) {
    const base = w.isAbsolute(cmd) ? cmd : (cwd && w.isAbsolute(cwd) ? w.resolve(cwd, cmd) : null);
    return base ? find(w.normalize(base)) : null;
  }
  for (const dir of String(envGet(env, 'PATH') || '').split(';')) {
    const d = dir.trim().replace(/^"(.*)"$/, '$1');
    if (!d || !w.isAbsolute(d)) continue;
    const hit = find(w.join(d, cmd));
    if (hit) return hit;
  }
  return null;
}

/**
 * Pure: what to actually spawn. sys = { platform, env, comspec, isFile } for tests.
 * Non-Windows and unresolvable commands are returned unchanged (so ENOENT surfaces as usual).
 */
export function resolveSpawn(cmd, args = [], options = {}, sys = {}) {
  const platform = sys.platform || process.platform;
  if (platform !== 'win32' || options.shell) return { file: cmd, args, options };
  const env = sys.env || options.env || process.env;
  const resolved = resolveWindowsCommand(cmd, { env, cwd: options.cwd, isFile: sys.isFile });
  if (!resolved) return { file: cmd, args, options };
  if (!BATCH.test(resolved)) return { file: resolved, args, options };
  if (args.some((a) => /[\r\n\0]/.test(String(a)))) throw Object.assign(new Error('arguments for a .cmd/.bat command must not contain line breaks'), { code: 'EINVAL' });
  const line = [escapeCommand(path.win32.normalize(resolved)), ...args.map((a) => escapeArgument(a, true))].join(' ');
  const comspec = sys.comspec || envGet(process.env, 'COMSPEC') || 'cmd.exe';
  return { file: comspec, args: ['/d', '/s', '/c', `"${line}"`], options: { ...options, shell: false, windowsVerbatimArguments: true } };
}

/** child_process.spawn with Windows shim support. */
export function spawn(cmd, args = [], options = {}) {
  const r = resolveSpawn(cmd, args, options);
  return cp.spawn(r.file, r.args, r.options);
}

/** child_process.execFile with Windows shim support. */
export function execFile(cmd, args = [], options = {}, cb) {
  const r = resolveSpawn(cmd, args, options);
  return cp.execFile(r.file, r.args, r.options, cb);
}

/** Kill a child and its descendants. On Windows a shim runs under cmd.exe, so kill the whole tree. */
export function killTree(child, signal = 'SIGTERM') {
  if (!child?.pid || child.exitCode != null || child.signalCode != null) return; // never taskkill a PID that may have been reused
  if (process.platform === 'win32') {
    try {
      const tk = path.join(envGet(process.env, 'SYSTEMROOT') || 'C:\\Windows', 'System32', 'taskkill.exe');
      const k = cp.spawn(tk, ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      k.on('error', () => { try { child.kill(signal); } catch { /* gone */ } });
    } catch { try { child.kill(signal); } catch { /* gone */ } }
    return;
  }
  try { child.kill(signal); } catch { /* gone */ }
}
