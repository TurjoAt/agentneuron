// `agentneuron doctor`: environment diagnostics. Read-only apart from a probe file it removes again.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig } from '../core/config.js';
import { runGit } from '../git2/run.js';
import { describeProject } from '../workspace/index.js';
import { NODE_MIN, VERSION } from '../server/version.js';

/** Resolves true when host:port can be bound right now. */
export function portFree(port, host) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
}

/** Can we create files in dir? (access(W_OK) is unreliable on Windows, so really try.) */
export function canWrite(dir) {
  const probe = path.join(dir, `.agentneuron-probe-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  try { fs.writeFileSync(probe, '', { flag: 'wx' }); fs.unlinkSync(probe); return true; } catch { return false; }
}

/** -> [{ id, status: 'ok'|'warn'|'fail', message }] */
export async function runDoctor(root, { port, host } = {}) {
  const out = [];
  const add = (id, status, message) => out.push({ id, status, message });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= NODE_MIN ? 'ok' : 'fail', `Node ${process.versions.node} (requires >= ${NODE_MIN})`);

  const g = await runGit(root, ['--version'], { timeout: 5000 });
  if (!g.ok) add('git', 'warn', 'git not found on PATH (git features disabled)');
  else {
    const inside = await runGit(root, ['rev-parse', '--is-inside-work-tree'], { timeout: 5000 });
    add('git', 'ok', `${g.out.trim()}${inside.ok && inside.out.trim() === 'true' ? ', project is a git repository' : ', project is not a git repository'}`);
  }

  const config = loadConfig(root, {});
  const cfgFile = path.join(root, '.agentneuron', 'config.json');
  if (config.configWarning) add('config', 'fail', config.configWarning);
  else add('config', 'ok', fs.existsSync(cfgFile) ? '.agentneuron/config.json is valid' : 'no .agentneuron/config.json (defaults)');

  const p = Number(port ?? config.port ?? 4747), h = String(host || config.host || '127.0.0.1');
  if (!Number.isInteger(p) || p < 0 || p > 65535) add('port', 'fail', `invalid port ${port}`);
  else if (p === 0) add('port', 'ok', 'port 0: a random free port will be used');
  else if (await portFree(p, h)) add('port', 'ok', `${h}:${p} is free`);
  else add('port', 'warn', `${h}:${p} is in use (start picks the next free port; or use --port <n>)`);

  const on = Object.entries(config.actions).filter(([, v]) => v).map(([k]) => k);
  if (!on.length) add('permissions', 'ok', 'read-only (no action levels enabled)');
  else add('permissions', config.fileEnabled.length ? 'warn' : 'ok', `enabled: ${on.join(', ')}${config.fileEnabled.length ? ` (${config.fileEnabled.join(', ')} enabled by .agentneuron/config.json - review it if you did not write it)` : ''}`);
  if (config.token || config.adminToken) add('auth', 'ok', `token configured${config.adminToken ? ' (admin + viewer roles)' : ''}`);

  const dir = path.join(root, '.agentneuron');
  if (fs.existsSync(dir)) {
    if (canWrite(dir)) add('data-dir', 'ok', '.agentneuron/ is writable');
    else add('data-dir', 'fail', '.agentneuron/ is not writable (history and logs will not be saved)');
  } else if (canWrite(root)) add('data-dir', 'ok', 'no .agentneuron/ yet; the project folder is writable (created on start)');
  else add('data-dir', 'warn', 'project folder is not writable (history and logs will not be saved)');

  let tools = [];
  try { tools = (await describeProject(root)).aiTools; } catch { /* unreadable */ }
  add('ai-tools', tools.length ? 'ok' : 'warn', tools.length ? `detected: ${tools.join(', ')}` : 'no AI tool config found (CLAUDE.md, AGENTS.md, .cursor, ...)');
  return out;
}

export async function cmdDoctor(root, flags, log = console) {
  const port = flags.port ?? flags.p;
  const checks = await runDoctor(root, { port: port === undefined ? undefined : Number(port), host: flags.host });
  const failed = checks.filter((c) => c.status === 'fail').length;
  if (flags.json) log.log(JSON.stringify({ version: VERSION, root, ok: failed === 0, checks }, null, 2));
  else {
    log.log(`agentneuron ${VERSION} doctor - ${root}`);
    const mark = { ok: '✓', warn: '!', fail: '✗' };
    for (const c of checks) log.log(`  ${mark[c.status]} ${c.id.padEnd(12)} ${c.message}`);
    log.log(failed ? `\n${failed} problem(s) found` : '\nno problems found');
  }
  return failed ? 1 : 0;
}
