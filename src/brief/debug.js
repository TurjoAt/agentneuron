// Bug detective (#5): a diagnostic report from an error / stack trace (pasted, or the last failing run):
// frames mapped to project files, recent changes to them (git + agent sessions), related env/config keys,
// dependency versions, failing tests, similar past failures and ranked hypotheses with how to confirm each.
// Read-only and deterministic; the input text is never stored here.
import path from 'node:path';
import { readRegularAsync } from '../files/safeio.js';
import { envKeys } from '../project/util.js';
import { rangeFloor, versionOf } from '../verify/semver.js';
import { projectSessions } from '../insights/transcripts.js';
import { tokens, jaccard } from '../insights/text.js';
import { getUsage } from '../usage/index.js';
import { maskSecretsInText } from '../health/secrets.js';
import { fileIndex, gitCommits, safeCall, clipText, relPath, isRel } from './util.js';
import { debugMarkdown } from './markdown.js';

export const MAX_ERROR = 64 * 1024;
const DAY = 864e5;

const FRAME_RES = [
  // JS / TS: "at fn (file:line:col)" or "at file:line:col"
  [/^\s*at\s+(?:(.+?)\s+\()?(?:file:\/\/)?([^\s()]+?):(\d+):(\d+)\)?\s*$/, (m) => ({ fn: m[1] || null, file: m[2], line: +m[3], col: +m[4] })],
  // Python
  [/^\s*File "([^"]+)", line (\d+)(?:, in (.+))?/, (m) => ({ fn: m[3] || null, file: m[1], line: +m[2] })],
  // PHP stack "#0 /path/file.php(12): fn()" and "in /path/file.php:12" / "in /path/file.php on line 12"
  [/^\s*#\d+\s+(.+?\.php)\((\d+)\):\s*(.+)?$/, (m) => ({ fn: m[3] || null, file: m[1], line: +m[2] })],
  [/\bin\s+(\S+\.php)(?::| on line )(\d+)/, (m) => ({ fn: null, file: m[1], line: +m[2] })],
  // Rust "--> src/main.rs:12:5", Go "\t/path/x.go:12 +0x1d"
  [/^\s*-->\s+(\S+?):(\d+):(\d+)/, (m) => ({ fn: null, file: m[1], line: +m[2], col: +m[3] })],
  [/^\s+(\S+\.go):(\d+)(?:\s|$)/, (m) => ({ fn: null, file: m[1], line: +m[2] })],
  // Java "at a.b.C.m(File.java:12)"
  [/^\s*at\s+([\w.$<>]+)\(([\w$]+\.(?:java|kt|scala)):(\d+)\)/, (m) => ({ fn: m[1], file: m[2], line: +m[3] })],
  // generic "path/file.ext:12[:3]" (test runners, compilers)
  [/(?:^|[\s(])((?:\.{0,2}\/)?[\w@./-]+\.[A-Za-z]{1,6}):(\d+)(?::(\d+))?/, (m) => ({ fn: null, file: m[1], line: +m[2], col: m[3] ? +m[3] : null })],
];

/** Error type + first message line. */
export function errorHead(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const hit = lines.find((l) => /^(?:Uncaught\s+)?([\w.]*(?:Error|Exception|Failure)|panic|Fatal error|PHP Fatal error|error(?:\[\w+\])?|FAIL|Traceback)\b/i.test(l)) || lines[0] || '';
  const m = /^(?:Uncaught\s+)?([\w.\\]*(?:Error|Exception)|panic|Fatal error|PHP Fatal error|error(?:\[\w+\])?)\s*:?\s*(.*)$/i.exec(hit);
  if (/^Traceback/i.test(hit)) {
    const last = [...lines].reverse().find((l) => /^[\w.]+(?:Error|Exception)\b/.test(l));
    if (last) { const mm = /^([\w.]+)\s*:?\s*(.*)$/.exec(last); return { type: mm[1], message: mm[2] || last }; }
  }
  return m ? { type: m[1], message: m[2] || hit } : { type: 'Error', message: hit };
}

/** Parse stack frames and map them to project files. idx: file index (paths Set). */
export function parseFrames(text, root, idx) {
  const out = [];
  const seen = new Set();
  const files = idx?.files || [];
  for (const raw of String(text || '').split('\n').slice(0, 2000)) {
    for (const [re, fn] of FRAME_RES) {
      const m = re.exec(raw);
      if (!m) continue;
      const f = fn(m);
      if (!f.file || /^(node:|internal\/|<anonymous>|native)/.test(f.file) || !Number.isFinite(f.line) || f.line <= 0) break;
      let file = f.file.replace(/^file:\/\//, '');
      if (process.platform === 'win32') file = file.replace(/^\/([A-Za-z]:)/, '$1'); // file:///C:/x
      const fwd = file.replace(/\\/g, '/'); // Windows traces use backslashes
      const nm = /(?:^|\/)node_modules\/((?:@[\w.-]+\/)?[\w.-]+)/.exec(fwd);
      const vendor = /(?:^|\/)vendor\/([\w.-]+\/[\w.-]+)\//.exec(fwd);
      let rel = path.isAbsolute(file) ? relPath(root, file) : file.replace(/^\.\//, '');
      if (rel && !idx?.paths?.has(rel)) {
        // suffix match ("Foo.java", "src/x.ts" from a different checkout path)
        const cands = files.filter((x) => x.path === rel || x.path.endsWith(`/${rel}`));
        rel = cands.length === 1 ? cands[0].path : (idx?.paths?.has(rel) ? rel : null);
      } else if (!rel && path.isAbsolute(file)) {
        rel = null;
        for (const k of [3, 2]) {
          const tail = fwd.split('/').slice(-k).join('/');
          const cands = files.filter((x) => x.path === tail || x.path.endsWith(`/${tail}`));
          if (cands.length === 1) { rel = cands[0].path; break; }
        }
      }
      const dep = nm ? nm[1] : vendor ? vendor[1] : null;
      const inProject = !!rel && !dep;
      const key = `${rel || file}:${f.line}`;
      if (seen.has(key)) break;
      seen.add(key);
      out.push({ path: inProject ? rel : isRel(file) ? file : path.basename(file), line: f.line, col: f.col ?? null, fn: f.fn ? clipText(f.fn, 120) : null, inProject, dep });
      break;
    }
    if (out.length >= 50) break;
  }
  return out;
}

async function readText(root, rel, max = 256 * 1024) {
  try { const r = await readRegularAsync(path.join(root, rel), { maxBytes: max, confine: root }); return r ? r.buf.toString('utf8') : null; } catch { return null; }
}
async function readJson(root, rel) { const t = await readText(root, rel); if (t == null) return null; try { return JSON.parse(t); } catch { return null; } }

const pkgName = (spec) => { const s = String(spec); if (s.startsWith('@')) return s.split('/').slice(0, 2).join('/'); return s.split('/')[0]; };
const BUILTIN = new Set(['fs', 'path', 'os', 'http', 'https', 'crypto', 'url', 'util', 'events', 'stream', 'child_process', 'net', 'tls', 'zlib', 'assert', 'buffer', 'readline', 'worker_threads', 'module', 'process', 'timers', 'dns', 'querystring', 'vm', 'test']);

/** Similar failures from session history: [{ session, ts, command, quote, fix }]. */
async function pastFailures(b, msgTokens) {
  let ss = [];
  try { ss = await projectSessions({ root: b.root, home: b.home, sessions: b.sessions }, { limit: 60 }); } catch { ss = []; }
  const out = [];
  for (const s of ss) {
    const cmds = s.events.filter((e) => e.k === 'cmd');
    cmds.forEach((e, i) => {
      if (e.ok !== false || !e.err) return;
      const sim = jaccard(msgTokens, tokens(e.err));
      if (sim < 0.4) return;
      const fix = cmds.slice(i + 1, i + 8).find((x) => x.ok === true && x.cmd.split(' ')[0] === e.cmd.split(' ')[0]);
      const edits = s.events.filter((x) => x.k === 'edit' && x.ts >= e.ts && (!fix || x.ts <= fix.ts) && x.inRoot !== false).map((x) => x.path).slice(0, 5);
      out.push({ session: s.sessionId, ts: e.ts, command: clipText(e.cmd, 200), quote: clipText(e.err, 200), fix: fix ? clipText(fix.cmd, 200) : null, edits: [...new Set(edits)], similarity: Math.round(sim * 100) / 100 });
    });
  }
  return out.sort((a, c) => c.similarity - a.similarity || c.ts - a.ts).slice(0, 5);
}

/**
 * Build the diagnostic report. input: { error (text), run (run id or 'last') }. opts.sessionData: include
 * similar failures from session history (false for roles that may not see prompts).
 */
export async function buildDebug(b, { error = '', run = null } = {}, { sessionData = true, now = Date.now() } = {}) {
  let text = typeof error === 'string' ? error.slice(0, MAX_ERROR) : '';
  let source = 'error', runRef = null, failingRun = null;
  const runs = await safeCall(b.deps.listRuns, [b.root, { limit: 20 }], []) || [];
  const failing = runs.filter((r) => r && (r.failed > 0 || (r.exitCode != null && r.exitCode !== 0))).sort((a, c) => (c.endedAt || c.startedAt || 0) - (a.endedAt || a.startedAt || 0));
  if (!text.trim()) {
    failingRun = run && run !== 'last' ? failing.find((r) => r.id === run) : failing[0];
    if (!failingRun) throw Object.assign(new Error(run && run !== 'last' ? 'run not found or not failing' : 'no error text and no failing run recorded'), { status: run && run !== 'last' ? 404 : 400 });
    source = 'run';
    runRef = { id: failingRun.id, kind: failingRun.kind, command: failingRun.command || null, endedAt: failingRun.endedAt || null };
    text = (failingRun.failures || []).map((f) => [f.name, f.message, f.file && `    at ${f.file}`].filter(Boolean).join('\n')).join('\n\n').slice(0, MAX_ERROR) || `${failingRun.kind} failed with exit code ${failingRun.exitCode}`;
  }
  text = maskSecretsInText(text);
  const idx = await fileIndex(b.root);
  const head = errorHead(text);
  const frames = parseFrames(text, b.root, idx);
  const own = frames.filter((f) => f.inProject);
  const ownPaths = [...new Set(own.map((f) => f.path))].slice(0, 10);
  const msgTokens = tokens(`${head.type} ${head.message}`);
  const hyps = [];
  const H = (id, title, confidence, evidence, check) => hyps.push({ id, title, confidence: Math.round(Math.max(0.05, Math.min(0.95, confidence)) * 100) / 100, evidence, check });
  const related = { files: ownPaths, commits: [], sessions: [], config: [], deps: [], tests: [] };

  // recent changes to the frame files: git + agent sessions
  const commits = ownPaths.length ? await gitCommits(b.root, { paths: ownPaths, since: now - 14 * DAY, limit: 20 }) : [];
  related.commits = commits.slice(0, 10).map((c) => ({ hash: c.hash, short: c.short, subject: c.subject, ts: c.ts, files: c.files.filter((f) => ownPaths.includes(f)) }));
  let sessEdits = [];
  if (ownPaths.length) {
    try {
      const list = (await getUsage({ root: b.root, config: b.config, home: b.home, store: b.store, usageBudgetMs: b.usageBudgetMs ?? 1500 }).sessions({ range: '7d' })).sessions || [];
      sessEdits = list.filter((s) => (s.filesTouched || []).some((p) => ownPaths.includes(p))).slice(0, 5).map((s) => ({ sessionId: s.sessionId, lastAt: s.lastAt, files: s.filesTouched.filter((p) => ownPaths.includes(p)) }));
    } catch { sessEdits = []; }
  }
  for (const f of own) f.recent = commits.some((c) => c.files.includes(f.path)) || sessEdits.some((s) => s.files.includes(f.path));
  const top = own[0] || null;
  const changed = [...new Set([...commits.flatMap((c) => c.files.filter((p) => ownPaths.includes(p))), ...sessEdits.flatMap((s) => s.files)])];
  for (const p of changed.slice(0, 3)) {
    const cs = commits.filter((c) => c.files.includes(p));
    const se = sessEdits.filter((s) => s.files.includes(p));
    const newest = Math.max(0, ...cs.map((c) => c.ts), ...se.map((s) => s.lastAt || 0));
    const isTop = top && top.path === p;
    H(`recent:${p}`, `Regression from a recent change to ${p}`, 0.35 + (isTop ? 0.2 : 0) + (now - newest < DAY ? 0.1 : 0) + (cs.length + se.length > 1 ? 0.05 : 0),
      [...(isTop ? [{ kind: 'file', ref: `${p}:${top.line}`, label: 'Top project frame of the stack trace' }] : [{ kind: 'file', ref: p, label: 'File appears in the stack trace' }]),
        ...cs.slice(0, 3).map((c) => ({ kind: 'commit', ref: c.short, label: `Commit: ${c.subject}` })),
        ...se.slice(0, 2).map((s) => ({ kind: 'session', ref: s.sessionId, label: 'An agent session edited this file in the last 7 days' }))],
      cs[0] ? `Inspect the change with \`git log -p -3 -- ${p}\`; if reverting ${cs[0].short} on a scratch branch makes the error go away, this is the cause.` : `Diff the file against its last checkpoint or \`git diff -- ${p}\` and re-run the failing command.`);
  }

  // missing modules / packages
  const mm = /Cannot find module ['"]([^'"]+)['"]|Module not found:[^'"]*['"]([^'"]+)['"]|No module named ['"]([^'"]+)['"]|Cannot find package ['"]([^'"]+)['"]|Failed to resolve import ['"]([^'"]+)['"]|Class ["']?([\w\\]+)["']? not found/.exec(text);
  if (mm) {
    const spec = mm.slice(1).find(Boolean);
    if (spec.startsWith('.') || spec.startsWith('/')) {
      const base = path.posix.basename(spec).replace(/\.\w+$/, '');
      const near = idx.files.filter((f) => path.posix.basename(f.path).replace(/\.\w+$/, '') === base).slice(0, 3).map((f) => f.path);
      H('import-path', `Import path ${spec} does not resolve`, near.length ? 0.7 : 0.55,
        [{ kind: 'error', ref: spec, label: 'Module resolution failed for a relative path' }, ...near.map((p) => ({ kind: 'file', ref: p, label: 'A file with that name exists elsewhere (moved or renamed?)' }))],
        `Check the import in ${top ? `${top.path}:${top.line}` : 'the importing file'} against the real file location${near[0] ? ` (${near[0]})` : ''}, including the extension (ESM needs ".js").`);
    } else if (!mm[6]) {
      const name = mm[3] ? spec.split('.')[0] : pkgName(spec);
      if (!BUILTIN.has(name.replace(/^node:/, ''))) {
        const pkg = mm[3] ? null : await readJson(b.root, 'package.json');
        const declared = pkg ? (pkg.dependencies?.[name] || pkg.devDependencies?.[name] || pkg.peerDependencies?.[name] || pkg.optionalDependencies?.[name] || null) : null;
        const installed = mm[3] ? null : (await readJson(b.root, `node_modules/${name}/package.json`))?.version || null;
        related.deps.push({ name, declared, installed });
        if (mm[3]) {
          const req = await readText(b.root, 'requirements.txt', 64 * 1024), py = await readText(b.root, 'pyproject.toml', 64 * 1024);
          const listed = new RegExp(`(^|[\\s"'])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s=<>~!\\[;"']|$)`, 'im').test(`${req || ''}\n${py || ''}`);
          H(`pydep:${name}`, listed ? `Python package ${name} is declared but not installed in this environment` : `Python package ${name} is not declared`, listed ? 0.65 : 0.6,
            [{ kind: 'error', ref: name, label: 'Import failed' }, { kind: 'file', ref: listed ? 'requirements.txt / pyproject.toml' : 'pyproject.toml', label: listed ? 'Listed in the manifest' : 'Not found in requirements.txt or pyproject.toml' }],
            listed ? 'Activate the project virtualenv and install the dependencies, then re-run.' : `Confirm the package name exists (agentneuron packages / check_package) before adding it; it may be a typo or a hallucinated name.`);
        } else if (declared && !installed) {
          H(`notinstalled:${name}`, `${name} is declared in package.json but not installed`, 0.75,
            [{ kind: 'file', ref: 'package.json', label: `Declared as ${declared}` }, { kind: 'file', ref: `node_modules/${name}`, label: 'Missing from node_modules' }],
            'Run the package manager install (the lockfile decides which one) and re-run.');
        } else if (!declared) {
          H(`undeclared:${name}`, `${name} is not a dependency of this project`, installed ? 0.5 : 0.7,
            [{ kind: 'file', ref: 'package.json', label: 'Not in dependencies or devDependencies' }, ...(installed ? [{ kind: 'file', ref: `node_modules/${name}`, label: `Installed transitively (${installed})` }] : [])],
            'Check the name is real (agentneuron packages / check_package) and add it with the project package manager, or fix the import.');
        } else {
          H(`exports:${name}`, `${name} is installed but the import path or module format does not match`, 0.4,
            [{ kind: 'file', ref: `node_modules/${name}/package.json`, label: `Installed ${installed}, declared ${declared}` }],
            `Check the "exports" field of ${name} for the subpath you import, and ESM vs CommonJS.`);
        }
      }
    }
  }

  // dependencies in the stack
  const depNames = [...new Set(frames.filter((f) => f.dep && !f.dep.includes('/') || (f.dep && f.dep.startsWith('@'))).map((f) => f.dep))].slice(0, 3);
  if (depNames.length) {
    const pkg = await readJson(b.root, 'package.json');
    for (const name of depNames) {
      if (related.deps.some((d) => d.name === name)) continue;
      const declared = pkg ? (pkg.dependencies?.[name] || pkg.devDependencies?.[name] || null) : null;
      const installed = (await readJson(b.root, `node_modules/${name}/package.json`))?.version || null;
      related.deps.push({ name, declared, installed });
      const floor = declared ? rangeFloor(declared) : null, inst = installed ? versionOf(installed) : null;
      const mismatch = floor && inst && floor.major !== null && inst.major !== null && inst.major !== floor.major;
      H(`dep:${name}`, mismatch ? `Installed ${name} ${installed} does not match the declared ${declared}` : `The error is raised inside ${name}`, mismatch ? 0.55 : 0.3,
        [{ kind: 'file', ref: `node_modules/${name}/package.json`, label: `Installed ${installed || 'unknown'}` }, { kind: 'file', ref: 'package.json', label: `Declared ${declared || 'not declared (transitive)'}` }, ...(top ? [{ kind: 'file', ref: `${top.path}:${top.line}`, label: 'Project code that calls into it' }] : [])],
        mismatch ? 'Reinstall from the lockfile and compare the version; check the changelog for breaking changes between the two versions.' : `Check how ${top ? top.path : 'the project'} calls ${name} (arguments, version-specific API) against its docs for ${installed || declared || 'the installed version'}.`);
    }
  }

  // env / config keys
  const envNames = [...new Set([...text.matchAll(/\b([A-Z][A-Z0-9]*_[A-Z0-9_]{2,})\b/g)].map((m) => m[1]))].filter((k) => !/^(ERR|ENOENT|EACCES|ECONN|SQLSTATE|HTTP|UTF|ISO)/.test(k)).slice(0, 10);
  if (envNames.length || /process\.env|getenv|\benv\(|environment variable|is not set|missing.*(key|secret|token)/i.test(text)) {
    const example = new Set();
    for (const f of ['.env.example', '.env.sample', '.env.dist', '.env.template']) { const t = await readText(b.root, f, 64 * 1024); if (t) envKeys(t).forEach((k) => example.add(k)); }
    const local = new Set();
    for (const f of ['.env', '.env.local']) { const t = await readText(b.root, f, 64 * 1024); if (t) envKeys(t).forEach((k) => local.add(k)); }
    for (const k of envNames) {
      const inEx = example.has(k), inLocal = local.has(k);
      related.config.push({ key: k, label: `${k}: ${inEx ? 'in .env.example' : 'not in .env.example'}, ${inLocal ? 'set in .env' : 'not set in .env'}` });
      if (inEx && !inLocal) H(`env:${k}`, `${k} is documented but not set locally`, 0.6, [{ kind: 'config', ref: '.env.example', label: `${k} is listed` }, { kind: 'config', ref: '.env', label: `${k} is missing` }], `Set ${k} in .env (see .env.example) and restart the process.`);
      else if (!inEx && !inLocal && /env|config|not set|undefined|missing/i.test(text)) H(`env:${k}`, `${k} is not configured anywhere`, 0.4, [{ kind: 'config', ref: '.env.example', label: `${k} is not documented` }], `Find where ${k} is read (search the code) and add it to .env and .env.example.`);
    }
  }
  const conn = /ECONNREFUSED\s+([\w.:[\]]+)|connect ECONNREFUSED ([\w.:]+)|Connection refused|could not connect to server/i.exec(text);
  if (conn) H('service-down', `A service is not reachable${conn[1] || conn[2] ? ` at ${conn[1] || conn[2]}` : ''}`, 0.6, [{ kind: 'error', ref: conn[0], label: 'Connection refused' }], 'Check the database / API / cache this code calls is running (docker compose ps) and that the host and port in .env match.');
  const port = /EADDRINUSE[^\d]*(\d{2,5})|address already in use[^\d]*(\d{2,5})?/i.exec(text);
  if (port) H('port-in-use', `Port ${port[1] || port[2] || ''} is already in use`.trim(), 0.75, [{ kind: 'error', ref: port[0], label: 'Address in use' }], 'Stop the other process on that port (lsof -i) or start on a different port.');

  // database schema / migrations
  if (/no such table|relation "[^"]+" does not exist|Base table or view not found|Unknown column|SQLSTATE\[42S0[12]\]|column "[^"]+" does not exist|table .* doesn't exist/i.test(text)) {
    const migs = idx.files.filter((f) => /(^|\/)(migrations?|db\/migrate)\//.test(f.path)).map((f) => f.path).sort().slice(-3);
    H('migration', 'The database schema is behind the code (pending or missing migration)', migs.length ? 0.6 : 0.45,
      [{ kind: 'error', ref: head.type, label: 'Missing table or column' }, ...migs.map((p) => ({ kind: 'file', ref: p, label: 'Recent migration file' }))],
      'Check the migration status (php artisan migrate:status, prisma migrate status, rails db:migrate:status) and run pending migrations on a local database.');
  }

  // syntax / null / type errors
  if (/SyntaxError|ParseError|Unexpected token|IndentationError|unexpected end of|expected .* found/i.test(text) && top) {
    H('syntax', `Syntax error in ${top.path}:${top.line}`, 0.55 + (top.recent ? 0.15 : 0), [{ kind: 'file', ref: `${top.path}:${top.line}`, label: 'Location reported by the parser' }, ...(top.recent ? [{ kind: 'file', ref: top.path, label: 'Changed recently' }] : [])],
      `Open ${top.path} at line ${top.line} (and the lines above it) and run the linter or type checker on that file.`);
  }
  if (/Cannot read propert(?:y|ies) of (?:undefined|null)|undefined is not (?:a function|an object)|is not a function|'NoneType' object|null pointer|nil pointer|Call to a member function .* on null|Attempt to read property/i.test(text)) {
    H('null-value', `A value is null or undefined${top ? ` at ${top.path}:${top.line}` : ''}`, top ? 0.45 : 0.3,
      [{ kind: 'error', ref: head.type, label: 'Null / undefined access' }, ...(top ? [{ kind: 'file', ref: `${top.path}:${top.line}`, label: top.fn ? `In ${top.fn}` : 'Top project frame' }] : [])],
      `Log the value just before ${top ? `${top.path}:${top.line}` : 'the failing line'} and trace where it is set; check callers changed recently and missing awaits.`);
  }

  // failing tests
  for (const r of failing.slice(0, 3)) {
    for (const f of (r.failures || []).slice(0, 20)) {
      if (related.tests.length >= 10) break;
      const fileHit = f.file && ownPaths.some((p) => p === f.file);
      const sim = f.message ? jaccard(msgTokens, tokens(f.message)) : 0;
      if (source === 'run' || fileHit || sim >= 0.3) related.tests.push({ run: r.id, kind: r.kind, name: clipText(f.name, 200), file: isRel(f.file) ? f.file : null });
    }
  }
  if (related.tests.length && source !== 'run') H('failing-tests', related.tests.length === 1 ? 'A recorded failing test shares this error' : `${related.tests.length} recorded failing tests share this error`, 0.5, related.tests.slice(0, 3).map((t) => ({ kind: 'run', ref: t.run, label: `${t.kind}: ${t.name}` })), 'Run just those tests; if they fail the same way, fix them first.');

  // similar past failures (session history)
  if (sessionData && msgTokens.size >= 2) {
    const past = await pastFailures(b, msgTokens);
    related.sessions = past;
    const fixed = past.find((p) => p.fix || p.edits.length);
    if (fixed) H('seen-before', 'This failure was seen before in an agent session', 0.45 + fixed.similarity * 0.3,
      [{ kind: 'session', ref: fixed.session, label: 'Same error earlier', quote: fixed.quote }, ...(fixed.fix ? [{ kind: 'session', ref: fixed.session, label: 'A later command passed', quote: fixed.fix }] : []), ...fixed.edits.slice(0, 3).map((p) => ({ kind: 'file', ref: p, label: 'Edited before it passed' }))],
      fixed.fix ? 'Look at what changed between the failure and the passing command in that session (open the replay) and apply the same fix.' : 'Open the session replay and see which edits made it pass.');
  }

  hyps.sort((a, c) => c.confidence - a.confidence || (a.title < c.title ? -1 : 1));
  const out = {
    generatedAt: Date.now(), source, run: runRef,
    error: { type: clipText(head.type, 120), quote: clipText(head.message, 500) },
    frames, hypotheses: hyps.slice(0, 10), related,
  };
  out.markdown = debugMarkdown(out);
  return out;
}
