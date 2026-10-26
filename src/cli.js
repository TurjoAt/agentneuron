import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { loadConfig, ensureAgentneuronDir, parseEnable } from './core/config.js';
import { createHeadlessCtx } from './core/headless.js';
import { startServer, VERSION } from './server/app.js';

const HELP = `agentneuron ${VERSION} - live monitor for AI-context markdown

Usage:
  agentneuron [command] [dir] [options]

Server:
  start [dir]        start the web UI for one project (default command)
  workspace [dir]    start in workspace mode (dir = folder holding your projects)
  mcp [dir]          run the MCP server on stdio (for AI tools)

Analysis:
  lint [dir]         list issues; exit 1 if any error-level issue (--json)
  status [dir]       short text summary
  export [dir]       write a report (--format ai|json|md|csv|html, --range 7d, --out file)
  verify [dir]       truth check: are the commands/paths/versions in context files real? exit 1 if any false (--json, --fix-preview)
  audit [dir]        security audit of agent config (MCP, permissions, hooks); exit 1 on high risk (--json)
  ci [dir]           lint + verify + audit + budget for CI (--format github|markdown|json, --fail-on, --base <ref>)
  usage [dir]        tokens, cost, cache, tools and anomalies from agent sessions (--range 7d, --json)
  lessons [dir]      rules to learn from agent sessions (corrections, reverts, failing commands) (--json)

Rules:
  compile [dir]      compile .agentneuron/rules/*.md into every tool's files (--dry-run, --check, --tools, --merge-back)
  rules import [dir] create source rules from existing CLAUDE.md / AGENTS.md / Cursor / Copilot files (--dry-run)
  rules list [dir]   list source rules
  generate [dir]     starter AGENTS.md from the code, every line cited (--tool agents|claude|..., --out [file])

Setup & maintenance:
  init [dir]         create .agentneuron/ (config + copy of this bundle)
  doctor [dir]       check Node, git, port, config, permissions, AI tools (--json)
  update             update agentneuron (--check: only compare with npm; --yes: no prompt; --allow-unverified)
  help [command]     show help for a command

Common options:
  --port, -p <n>     port (default 4747; if busy, the next free port is used; 0 = random)
  --strict-port      exit instead of moving to another port when the port is busy
  --host <h>         bind host (default 127.0.0.1; non-loopback requires/auto-creates a token)
  --token <t>        require a token (login screen, ?token=<t> or Authorization: Bearer <t>)
  --admin-token <t>  admin token; then --token becomes the read-only viewer token
  --enable <list>    enable action levels (comma list of: edit, exec, danger, terminal).
                     Everything beyond read/state is OFF by default; or set "actions" in .agentneuron/config.json
  --write            alias for --enable edit
  --open             open the browser
  --json             machine-readable output (lint, doctor, verify, audit)
  --version, -v      print the version
  --help, -h         this help; "agentneuron <command> --help" for one command

Examples:
  agentneuron                          read-only UI for the current folder on 127.0.0.1:4747
  agentneuron ./app --port 5000 --open
  agentneuron lint --json > issues.json
  agentneuron export --format md --range 30d --out report.md
  agentneuron doctor
  agentneuron verify --fix-preview
  agentneuron ci --format github --base origin/main
  agentneuron update --check
`;

const CMD_HELP = {
  verify: `Usage: agentneuron verify [dir] [--json] [--all] [--fix-preview]

Extract checkable claims from context files (CLAUDE.md, AGENTS.md, rules, skills...): commands such as
"npm run x", "pnpm x", "make x", "composer x", "php artisan x", script names, paths, runtime and framework
versions, env var names and ports, and check each one against the repo. Exit 1 if any claim is false.
  --all          also list claims that checked out
  --fix-preview  show the line edit each suggested fix would make (nothing is written)`,
  audit: `Usage: agentneuron audit [dir] [--json]

Audit agent config for risky settings: unpinned or plain-http MCP servers, inline tokens, Bash(*) allow
rules, permission bypass modes, hooks that pipe downloads into a shell, world-writable files and secrets
in context files. Prints a 0-100 risk score; values are always masked. Exit 1 if any finding is high.`,
  ci: `Usage: agentneuron ci [dir] [--format github|markdown|json] [--fail-on error|warn|never] [--base <ref>] [--budget <tokens>]

Run lint, the truth check, the security audit and a context-size budget in one pass.
  --format   github: ::error/::warning annotations + Markdown summary (appended to $GITHUB_STEP_SUMMARY
             when set); markdown (default outside GitHub Actions); json
  --fail-on  exit 1 on any error (default), on any warning too (warn), or never
  --base     only report issues that are new since this git revision (e.g. origin/main); needs the ref
             fetched (actions/checkout fetch-depth: 0)
  --budget   max tokens of root context per tool before a warning (default 20000)`,
  start: `Usage: agentneuron [start] [dir] [--port n] [--strict-port] [--host h] [--token t] [--admin-token t] [--enable levels] [--write] [--open]

Start the server for one project and print the URL (plus network URLs when bound to 0.0.0.0). If the port is busy, the next free one is used. Read-only unless levels are enabled.

  agentneuron ./app --port 5000 --open
  agentneuron --enable edit,exec
  agentneuron --host 0.0.0.0 --admin-token "$ADMIN" --token "$VIEWER"`,
  workspace: `Usage: agentneuron workspace [dir] [start options]

Start the server in workspace mode: dir is a folder holding several projects.`,
  mcp: `Usage: agentneuron mcp [dir] [--level state]

Run the MCP server on stdio (newline-delimited JSON-RPC). stdout carries only protocol messages.
Read-only by default; --level state adds the coordination tools that write .agentneuron/
(claim_task, claim_files, release_files, handoff_note).`,
  lint: `Usage: agentneuron lint [dir] [--json]

Print every issue. Exit code 1 if any issue has severity "error".`,
  status: `Usage: agentneuron status [dir]

Print files, tokens and health in a few lines.`,
  init: `Usage: agentneuron init [dir]

Create .agentneuron/ with config.json and, from the bundled build, a copy of the bundle
(.agentneuron/agentneuron.mjs) so the project can run it with plain node.`,
  export: `Usage: agentneuron export [dir] [--format ai|json|md|csv|html] [--range 7d] [--out file]

Write an activity/health report. Default format "ai" (compact, for pasting into an AI chat).
--range: 24h, 7d, 2w, 90d or all (default 7d). Output goes to stdout unless --out is given.

  agentneuron export > context-report.txt
  agentneuron export --format html --range 30d --out report.html`,
  usage: `Usage: agentneuron usage [dir] [--range 24h|7d|30d|90d|all] [--json] [--scope project|all]

Tokens, cost (exact where Claude Code recorded it), cache hit rate, models, tools and anomalies from local agent sessions.`,
  lessons: `Usage: agentneuron lessons [dir] [--json] [--covered] [--all]

Mine Claude Code and Codex sessions of this project for user corrections, reverted edits, commands
that keep failing and instructions repeated across sessions; print them as proposed rules with
confidence, evidence (secrets masked) and the context file to add them to. Read-only.
--covered  also list lessons an existing rule already covers
--all      also list dismissed / accepted lessons`,
  compile: `Usage: agentneuron compile [dir] [--dry-run] [--check] [--tools claude,cursor,...] [--merge-back] [--force] [--json]

Compile the source rules in .agentneuron/rules/*.md (config: compiler.rulesDir) into CLAUDE.md, AGENTS.md,
GEMINI.md, .cursor/rules/*.mdc, .github/copilot-instructions.md + .github/instructions/*.instructions.md
and .windsurf/rules/*.md. Only the agentneuron:begin/end regions are rewritten; your text around them is kept.
  --dry-run     print what would change, with a diff; write nothing
  --check       exit 1 if any output is stale or was edited by hand (CI)
  --tools       limit to some tools: claude, codex (AGENTS.md), gemini, cursor, copilot, windsurf
  --merge-back  pull edits made inside generated regions back into the source rules, then compile
  --force       overwrite regions that were edited by hand`,
  rules: `Usage: agentneuron rules import [dir] [--dry-run]
       agentneuron rules list [dir] [--json]

import: split the existing context files into source rules (one per ## section, one per Cursor/Copilot/Windsurf
rule file), merging identical rules found in several tools. Never overwrites a rule file.`,
  generate: `Usage: agentneuron generate [dir] [--tool agents|claude|gemini|copilot|cursor|windsurf] [--out [file]] [--force]

Build a starter context file from what the code shows: install/build/test/lint commands, stack and versions,
top-level folders and detected conventions. Each line cites its source. Prints to stdout unless --out is given
(--out alone writes the tool's default path); an existing file is only replaced with --force.`,
  doctor: `Usage: agentneuron doctor [dir] [--json] [--port n] [--host h]

Check the environment: Node version, git, port availability, config validity, enabled
permission levels, write access to .agentneuron/ and detected AI tools. Exit 1 on a failure.`,
  update: `Usage: agentneuron update [--check] [--yes] [--allow-unverified]

--check  compare this version with the latest on npm (5 s timeout) and exit.
Without --check, update the way this copy was installed:
  global npm install   runs "npm install -g agentneuron@latest"
  .agentneuron copy    downloads the GitHub release bundle, verifies its sha256 and requires it to
                       match the bundle in the npm tarball (sha512-verified); keeps a .bak
  npx / other          prints the command to run instead
--allow-unverified  if npm does not have that version yet, accept the GitHub checksum alone.
Asks before replacing anything unless --yes. agentneuron never checks for updates on its own.`,
};

function parseArgs(argv) {
  const o = { _: [], flags: {} };
  const valued = new Set(['port', 'p', 'host', 'token', 'admin-token', 'enable', 'format', 'range', 'out', 'level', 'base', 'fail-on', 'budget', 'tools', 'tool', 'scope']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') || (a.startsWith('-') && a.length === 2)) {
      let [k, v] = a.replace(/^-+/, '').split('=');
      if (v === undefined && valued.has(k) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) v = argv[++i];
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
  if (sd && path.basename(sd) === '.agentneuron') return path.dirname(sd);
  return process.cwd();
}

async function analyze(root, overrides = {}) {
  const ctx = await createHeadlessCtx(root, overrides, { git: false });
  const files = ctx.allFiles();
  const { issues, health, graph } = await ctx.analysis();
  return { config: ctx.config, files, issues, health, graph };
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
  console.log(`agentneuron status for ${root}`);
  console.log(`  files:  ${files.length}  (${Object.entries(byTool).map(([k, v]) => `${k}:${v}`).join(' ') || 'none'})`);
  console.log(`  tokens: ${tokens}`);
  console.log(`  health: ${health.score}/100 (${health.grade})  errors ${health.counts.error}  warnings ${health.counts.warn}  info ${health.counts.info}`);
  console.log(`  issues: ${issues.length}`);
  return 0;
}

function cmdInit(root) {
  ensureAgentneuronDir(root);
  const dir = path.join(root, '.agentneuron');
  const cfg = path.join(dir, 'config.json');
  try {
    fs.writeFileSync(cfg, JSON.stringify({ port: 4747, ignore: [], extraPatterns: [], includeAllMarkdown: true }, null, 2) + '\n', { flag: 'wx' });
    console.log(`created ${path.relative(process.cwd(), cfg) || cfg}`);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    console.log('config.json already exists');
  }
  const self = fileURLToPath(import.meta.url);
  if (globalThis.__AGENTNEURON_UI__ !== undefined && self.endsWith('.mjs')) {
    const dest = path.join(dir, 'agentneuron.mjs');
    if (path.resolve(self) !== path.resolve(dest)) {
      fs.copyFileSync(self, dest); fs.chmodSync(dest, 0o755);
      console.log(`copied bundle to ${dest}`);
    }
    console.log(`run: node ${path.join('.agentneuron', 'agentneuron.mjs')}`);
  } else console.log('(not running as a bundle; bundle copy skipped. Build with npm run build)');
  return 0;
}

async function cmdMcp(root, flags) {
  const { runMcpServer } = await import('./mcp/server.js');
  const lv = flags.level === undefined ? undefined : String(flags.level);
  if (lv !== undefined && lv !== 'read' && lv !== 'state') { console.error('agentneuron: --level must be "read" or "state"'); return 2; }
  const config = loadConfig(root, lv ? { mcpLevel: lv } : {});
  await runMcpServer(root, config);
  return 0;
}

async function cmdStart(root, flags, workspace = false) {
  const overrides = {};
  const port = flags.port ?? flags.p;
  if (port !== undefined) {
    const n = Number(port);
    if (port === true || !Number.isInteger(n) || n < 0 || n > 65535) { console.error('agentneuron: --port must be a number from 0 to 65535'); return 2; }
    overrides.port = n;
  }
  if (flags['strict-port']) overrides.strictPort = true;
  if (flags.host) overrides.host = String(flags.host);
  if (flags.token) overrides.token = String(flags.token);
  else if (process.env.AGENTNEURON_TOKEN) overrides.token = String(process.env.AGENTNEURON_TOKEN);
  if (flags['admin-token']) overrides.adminToken = String(flags['admin-token']);
  if (flags.open) overrides.openBrowser = true;
  let enable;
  try { enable = parseEnable(flags.enable); } catch (e) { console.error(`agentneuron: --enable: ${e.message}`); return 2; }
  if (flags.write) enable.push('edit');
  if (enable.length) overrides.actions = Object.fromEntries(enable.map((l) => [l, true]));
  if (workspace) overrides.workspaceRoot = root;
  const config = loadConfig(root, overrides);
  const srv = await startServer(config);
  console.log('');
  console.log(`  AgentNeuron ${VERSION}  -  AI context control center`);
  console.log(`  project : ${root}`);
  console.log(`  files   : ${srv.store.files.size}`);
  const mask = (t) => (String(t).length >= 12 ? `${String(t).slice(0, 4)}****` : "****"); // never reveal short tokens
  console.log(`  open    : ${srv.ctx.url}`);
  // with an auto-generated token the link carries it (the token is printed once below anyway)
  const withTok = (u) => (srv.token && config.tokenGenerated ? `${u}?token=${srv.token}` : u);
  for (const u of srv.networkUrls || []) console.log(`  network : ${withTok(u)}`);
  if (srv.requestedPort && srv.port !== srv.requestedPort) console.log(`  port    : ${srv.requestedPort} was in use, using ${srv.port} (--strict-port to fail instead)`);
  if (srv.token && config.tokenGenerated) {
    console.log(`  token   : ${srv.token}`);
    console.log('            (auto-generated because the host is not loopback; shown ONCE - it is not stored. Keep it out of logs.)');
  } else if (srv.token || srv.adminToken) {
    console.log(`  token   : required (${config.adminToken ? 'viewer ' : ''}${mask(srv.token || srv.adminToken)}); enter it on the login screen`);
  }
  if (config.adminToken) console.log(`  roles   : admin token set (${mask(config.adminToken)}); --token / config token = read-only viewer`);
  if (config.configWarning) console.error(`  WARNING : ${config.configWarning}`);
  if (config.fileEnabled?.length) {
    console.log(`  WARNING : .agentneuron/config.json enables ${config.fileEnabled.join(', ')}. If you did not write that file (e.g. a cloned repo), stop and review it.`);
  }
  const on = Object.entries(config.actions).filter(([, v]) => v).map(([k]) => k);
  console.log(`  actions : ${on.length ? on.join(', ') + ' enabled' : 'read-only (enable with --enable edit,exec,...)'}`);
  if (workspace) console.log(`  mode    : workspace (${root})`);
  console.log('  Ctrl+C to stop\n');
  if (config.openBrowser) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
    exec(`${cmd} "${srv.url}"`, () => {}); // explicit --open: the tokenised URL is only ever passed to the browser launcher
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

const COMMANDS = new Set(['start', 'lint', 'status', 'init', 'help', 'mcp', 'workspace', 'export', 'doctor', 'update', 'verify', 'audit', 'ci', 'lessons', 'usage', 'compile', 'rules', 'generate']);

export async function main(argv = process.argv.slice(2)) {
  const { _, flags } = parseArgs(argv);
  const explicit = _.length > 0 && COMMANDS.has(_[0]);
  const cmd = explicit ? _.shift() : 'start';
  if (cmd === 'help') {
    console.log(CMD_HELP[_[0]] || HELP); return 0;
  }
  if (flags.help || flags.h) { console.log(explicit ? CMD_HELP[cmd] || HELP : HELP); return 0; }
  if (flags.version || flags.v) { console.log(VERSION); return 0; }
  if (cmd === 'update') {
    const { cmdUpdate } = await import('./commands/update.js');
    return cmdUpdate(flags);
  }
  const sub = cmd === 'rules' ? _.shift() : null;
  const root = resolveRoot(_[0]);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`agentneuron: not a directory: ${root}`); return 2;
  }
  switch (cmd) {
    case 'lint': return cmdLint(root, flags);
    case 'status': return cmdStatus(root);
    case 'init': return cmdInit(root);
    case 'mcp': return cmdMcp(root, flags);
    case 'export': return (await import('./commands/export.js')).cmdExport(root, flags);
    case 'doctor': return (await import('./commands/doctor.js')).cmdDoctor(root, flags);
    case 'verify': return (await import('./commands/verify.js')).cmdVerify(root, flags);
    case 'audit': return (await import('./commands/audit.js')).cmdAudit(root, flags);
    case 'ci': return (await import('./commands/ci.js')).cmdCi(root, flags);
    case 'usage': return (await import('./commands/usage.js')).cmdUsage(root, flags);
    case 'lessons': return (await import('./commands/lessons.js')).cmdLessons(root, flags);
    case 'compile': return (await import('./commands/compile.js')).cmdCompile(root, flags);
    case 'rules': return (await import('./commands/compile.js')).cmdRules(root, sub, flags);
    case 'generate': return (await import('./commands/compile.js')).cmdGenerate(root, flags);
    case 'workspace': return cmdStart(root, flags, true);
    default: return cmdStart(root, flags);
  }
}

const isMain = (() => {
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isMain || globalThis.__AGENTNEURON_UI__ !== undefined) {
  main().then((code) => { if (code) process.exitCode = code; })
    .catch((e) => { console.error('agentneuron:', e.message || e); process.exit(1); });
}
