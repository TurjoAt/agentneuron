import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { loadConfig, ensureMdctlDir } from './core/config.js';
import { createStore } from './core/store.js';
import { buildGraph } from './analysis/graph.js';
import { lint } from './health/lint.js';
import { healthScore } from './health/score.js';
import { startServer, VERSION } from './server/app.js';

const HELP = `mdctl ${VERSION} - live monitor for AI-context markdown

Usage:
  mdctl [start] [dir] [--port n] [--host h] [--token t] [--open] [--write]
  mdctl lint [--json] [dir]     exit 1 if any error-level issue
  mdctl status [dir]            short text summary
  mdctl init [dir]              create .mdctl/ (config + copy of this bundle)
  mdctl --version | --help

Options:
  --port, -p <n>   port (default 4747; 0 = random)
  --host <h>       bind host (default 127.0.0.1; non-loopback requires/auto-creates a token)
  --token <t>      require ?token=<t> or Authorization: Bearer <t>
  --open           open the browser
  --write          allow write actions (history restore)
  --json           machine-readable output (lint)
`;

function parseArgs(argv) {
  const o = { _: [], flags: {} };
  const valued = new Set(['port', 'p', 'host', 'token']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') || (a.startsWith('-') && a.length === 2)) {
      let [k, v] = a.replace(/^-+/, '').split('=');
      if (v === undefined && valued.has(k)) v = argv[++i];
      o.flags[k] = v === undefined ? true : v;
    } else o._.push(a);
  }
  return o;
}

function scriptDir() {
  try {
    const f = fs.realpathSync(process.argv[1] || '');
    return path.dirname(f);
  } catch { return null; }
}

function resolveRoot(dirArg) {
  if (dirArg) return path.resolve(dirArg);
  const sd = scriptDir();
  if (sd && path.basename(sd) === '.mdctl') return path.dirname(sd);
  return process.cwd();
}

async function analyze(root, overrides = {}) {
  const config = loadConfig(root, overrides);
  const store = createStore(root, config);
  await store.init();
  const files = [...store.files.values()];
  const graph = buildGraph(files, store.contents);
  const issues = lint({ root, files, contents: store.contents, links: graph.edges }) || [];
  const health = healthScore(issues, files);
  return { config, files, issues, health, graph };
}

async function cmdLint(root, flags) {
  const { files, issues, health } = await analyze(root);
  const errors = issues.filter((i) => i.severity === 'error').length;
  if (flags.json) {
    console.log(JSON.stringify({ root, files: files.length, health, issues }, null, 2));
  } else {
    for (const i of issues) console.log(`${i.severity.padEnd(5)} ${i.path}${i.line ? ':' + i.line : ''}  [${i.rule}] ${i.message}`);
    console.log(`\n${files.length} files, ${issues.length} issues, score ${health.score} (${health.grade})`);
  }
  return errors > 0 ? 1 : 0;
}

async function cmdStatus(root) {
  const { files, health, issues } = await analyze(root);
  const tokens = files.reduce((s, f) => s + (f.tokens || 0), 0);
  const byTool = {};
  for (const f of files) byTool[f.tool] = (byTool[f.tool] || 0) + 1;
  console.log(`mdctl status for ${root}`);
  console.log(`  files:  ${files.length}  (${Object.entries(byTool).map(([k, v]) => `${k}:${v}`).join(' ') || 'none'})`);
  console.log(`  tokens: ${tokens}`);
  console.log(`  health: ${health.score}/100 (${health.grade})  errors ${health.counts.error}  warnings ${health.counts.warn}  info ${health.counts.info}`);
  console.log(`  issues: ${issues.length}`);
  return 0;
}

function cmdInit(root) {
  ensureMdctlDir(root);
  const dir = path.join(root, '.mdctl');
  const cfg = path.join(dir, 'config.json');
  if (!fs.existsSync(cfg)) {
    fs.writeFileSync(cfg, JSON.stringify({ port: 4747, ignore: [], extraPatterns: [], includeAllMarkdown: true }, null, 2) + '\n');
    console.log(`created ${path.relative(process.cwd(), cfg) || cfg}`);
  } else console.log('config.json already exists');
  const self = fileURLToPath(import.meta.url);
  if (globalThis.__MDCTL_UI__ !== undefined && self.endsWith('.mjs')) {
    const dest = path.join(dir, 'mdctl.mjs');
    if (path.resolve(self) !== path.resolve(dest)) {
      fs.copyFileSync(self, dest); fs.chmodSync(dest, 0o755);
      console.log(`copied bundle to ${dest}`);
    }
    console.log(`run: node ${path.join('.mdctl', 'mdctl.mjs')}`);
  } else console.log('(not running as a bundle; bundle copy skipped. Build with npm run build)');
  return 0;
}

async function cmdStart(root, flags) {
  const overrides = {};
  const port = flags.port ?? flags.p;
  if (port !== undefined) overrides.port = Number(port);
  if (flags.host) overrides.host = String(flags.host);
  if (flags.token) overrides.token = String(flags.token);
  if (flags.open) overrides.openBrowser = true;
  const config = loadConfig(root, overrides);
  if (flags.write) config.allowWrite = true;
  const srv = await startServer(config);
  console.log('');
  console.log(`  mdctl ${VERSION}  -  AI-context monitor`);
  console.log(`  project : ${root}`);
  console.log(`  files   : ${srv.store.files.size}`);
  console.log(`  open    : ${srv.url}`);
  if (srv.token && config.tokenGenerated) console.log(`  token   : ${srv.token} (auto-generated, host is not loopback)`);
  if (config.allowWrite) console.log('  writes  : enabled (--write)');
  console.log('  Ctrl+C to stop\n');
  if (config.openBrowser) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
    exec(`${cmd} "${srv.url}"`, () => {});
  }
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    console.log('\nshutting down...');
    const t = setTimeout(() => process.exit(0), 2000); t.unref();
    await srv.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

export async function main(argv = process.argv.slice(2)) {
  const { _, flags } = parseArgs(argv);
  if (flags.help || flags.h) { console.log(HELP); return 0; }
  if (flags.version || flags.v) { console.log(VERSION); return 0; }
  const cmds = new Set(['start', 'lint', 'status', 'init', 'help']);
  let cmd = 'start';
  if (_.length && cmds.has(_[0])) cmd = _.shift();
  if (cmd === 'help') { console.log(HELP); return 0; }
  const root = resolveRoot(_[0]);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`mdctl: not a directory: ${root}`); return 2;
  }
  switch (cmd) {
    case 'lint': return cmdLint(root, flags);
    case 'status': return cmdStatus(root);
    case 'init': return cmdInit(root);
    default: return cmdStart(root, flags);
  }
}

const isMain = (() => {
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isMain || globalThis.__MDCTL_UI__ !== undefined) {
  main().then((code) => { if (code) process.exitCode = code; })
    .catch((e) => { console.error('mdctl:', e.message || e); process.exit(1); });
}
