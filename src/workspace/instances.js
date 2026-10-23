import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const children = new Map(); // abs path -> { child, url, startedAt, pid }
let hooked = false;

export function cliPath() {
  try {
    // Only when running unbundled from src/workspace/ — a bundle's neighbour "../cli.js"
    // could be an unrelated file in the user's project.
    const here = path.dirname(fileURLToPath(import.meta.url));
    if (here.split(path.sep).slice(-2).join('/') === 'src/workspace') {
      const p = path.resolve(here, '../cli.js');
      if (fs.existsSync(p)) return p;
    }
  } catch { /* bundled */ }
  return process.argv[1];
}

export function killAll() {
  for (const [, v] of children) { try { v.child.kill('SIGTERM'); } catch { /* gone */ } }
  children.clear();
}

function hook() {
  if (hooked) return;
  hooked = true;
  process.on('exit', killAll);
}

export function list() {
  return [...children.entries()].map(([p, v]) => ({ path: p, url: v.url, pid: v.pid, startedAt: v.startedAt }));
}
export function runningUrl(p) { return children.get(path.resolve(p))?.url || null; }

/** Spawn `agentneuron start <dir> --port 0` and resolve with its URL. Re-uses a live child. */
export function open(dir, { host = '127.0.0.1', token, cli = cliPath(), timeoutMs = 15000 } = {}) {
  hook();
  const abs = path.resolve(dir);
  const ex = children.get(abs);
  if (ex && ex.child.exitCode === null && !ex.child.killed) return Promise.resolve({ url: ex.url, pid: ex.pid, reused: true });
  const args = [cli, 'start', abs, '--port', '0', '--host', host];
  // token goes through the environment, not argv: argv is world-readable in `ps`
  const env = { ...process.env };
  if (token) env.AGENTNEURON_TOKEN = token; else delete env.AGENTNEURON_TOKEN;
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env }); }
    catch (e) { return reject(e); }
    let buf = '', done = false;
    const finish = (err, val) => {
      if (done) return; done = true; clearTimeout(timer);
      if (err) { try { child.kill('SIGTERM'); } catch { /* gone */ } children.delete(abs); reject(err); } else resolve(val);
    };
    const timer = setTimeout(() => finish(new Error('timed out waiting for agentneuron to print its URL')), timeoutMs);
    timer.unref?.();
    const onData = (d) => {
      buf += d.toString();
      const m = /https?:\/\/[^\s'"]+/.exec(buf);
      if (m) {
        // the child no longer prints its token; hand the admin caller a ready-to-open URL
        const url = token ? `${m[0].replace(/\/?$/, '/')}?token=${encodeURIComponent(token)}` : m[0];
        children.set(abs, { child, url, startedAt: Date.now(), pid: child.pid });
        finish(null, { url, pid: child.pid, reused: false });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (d) => { buf += d.toString(); if (buf.length > 20000) buf = buf.slice(-20000); });
    child.on('error', (e) => finish(e));
    child.on('exit', (code) => {
      if (children.get(abs)?.child === child) children.delete(abs);
      finish(new Error(`agentneuron exited with code ${code} before printing a URL`));
    });
  });
}
