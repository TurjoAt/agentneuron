// `agentneuron ci`: lint + truth check + security audit + context budget, as GitHub annotations, Markdown
// or JSON. With --base <ref>, only issues that are new compared to that git revision are reported.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHeadlessCtx } from '../core/headless.js';
import { verifyContext, loadFacts } from '../verify/index.js';
import { auditAgentConfig } from '../audit/index.js';
import { effectiveContext } from '../analysis/context.js';
import { validRev } from '../git2/run.js';
import { maskSecretsInText } from '../health/secrets.js';

export const CI_FORMATS = ['github', 'markdown', 'json'];
export const FAIL_ON = ['error', 'warn', 'never'];
const DEFAULT_BUDGET = 20000;
const MAX_ROWS = 100;
const LEVEL = { error: 'error', warn: 'warning', info: 'notice' };
const AUDIT_LEVEL = { high: 'error', medium: 'warning', low: 'notice', info: 'notice' };
const norm = (s) => String(s || '').replace(/\d[\d,.]*/g, '#');

/** Collect every CI issue for one project directory. */
export async function collect(root, { budget = DEFAULT_BUDGET, stableFacts = false } = {}) {
  const ctx = await createHeadlessCtx(root, {}, { git: false });
  const files = ctx.allFiles();
  const contents = ctx.store.contents;
  const { issues, health } = await ctx.analysis();
  const out = [];
  for (const i of issues) {
    if (i.rule === 'false-claim') continue; // reported from the truth check below, with its suggestion
    out.push({ check: 'lint', rule: i.rule, level: LEVEL[i.severity] || 'notice', file: i.path, line: i.line ?? null, message: i.message, fix: i.hint || null, key: `lint|${i.rule}|${i.path}|${norm(i.message)}` });
  }
  // node_modules/.bin is not part of a git revision: ignore it so base and head are judged alike
  let facts = loadFacts(ctx.root);
  if (stableFacts) facts = { ...facts, bins: null };
  const v = verifyContext({ root: ctx.root, files, contents, facts });
  for (const c of v.claims) {
    if (c.status !== 'false' || c.kind === 'path') continue; // paths: the missing-path lint rule already reports them
    out.push({ check: 'verify', rule: 'false-claim', level: 'warning', file: c.file, line: c.line, message: `\`${c.text}\`: ${c.evidence}`, fix: c.suggestion, key: `verify|${c.file}|${c.kind}|${c.text}` });
  }
  const a = auditAgentConfig({ root: ctx.root, files, contents });
  for (const f of a.findings) {
    if (f.rule === 'context-secret') continue; // same scanner as the "secret" lint rule
    out.push({ check: 'audit', rule: f.rule, level: AUDIT_LEVEL[f.severity], file: f.file, line: f.line, message: f.title, fix: f.fix, key: `audit|${f.rule}|${f.file}|${norm(f.title)}` });
  }
  const tools = {};
  for (const tool of ['claude', 'codex', 'cursor']) {
    try {
      const r = effectiveContext('', files, contents, tool);
      if (!r.chain?.length) continue;
      tools[tool] = r.tokens;
      if (r.tokens > budget) {
        const first = r.chain.find((c) => c.path)?.path || r.chain[0]?.path || 'CLAUDE.md';
        out.push({ check: 'budget', rule: 'context-budget', level: 'warning', file: first, line: null, message: `${tool} loads ~${r.tokens.toLocaleString('en-US')} tokens of context at the project root (budget ${budget.toLocaleString('en-US')})`, fix: 'Move rarely needed sections into linked docs or path-scoped rules.', key: `budget|${tool}` });
      }
    } catch { /* context resolution is best-effort */ }
  }
  for (const i of out) { i.message = maskSecretsInText(i.message); if (i.fix) i.fix = maskSecretsInText(i.fix); }
  return { root: ctx.root, files: files.length, issues: out, health, verify: v.summary, audit: { score: a.score, level: a.level, counts: a.counts }, budget: { limit: budget, tools } };
}

function git(cwd, args, env = {}) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 120000, maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', ...env } },
      (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || err?.message || '') }));
  });
}

/** Check out `ref` into a temp dir without touching the repo's index or worktree; returns the project dir in it. */
export async function materializeBase(root, ref) {
  if (!validRev(ref)) throw new Error(`invalid --base revision: ${ref}`);
  const top = await git(root, ['rev-parse', '--show-toplevel']);
  if (!top.ok) throw new Error('--base needs a git repository');
  const commit = await git(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
  if (!commit.ok || !commit.out.trim()) throw new Error(`unknown revision "${ref}" (in CI, fetch it first, e.g. actions/checkout with fetch-depth: 0)`);
  const prefix = (await git(root, ['rev-parse', '--show-prefix'])).out.trim();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-base-'));
  const tree = path.join(tmp, 'tree');
  const env = { GIT_INDEX_FILE: path.join(tmp, 'index') };
  // a private index + checkout-index: the repository's own index, HEAD and worktree are never modified;
  // symlinks are written as plain files so a hostile base tree cannot point outside the temp dir
  const r1 = await git(top.out.trim(), ['-c', 'core.symlinks=false', 'read-tree', commit.out.trim()], env);
  const r2 = r1.ok && await git(top.out.trim(), ['-c', 'core.symlinks=false', 'checkout-index', '-a', '-f', `--prefix=${tree.split(path.sep).join('/')}/`], env);
  if (!r1.ok || !r2.ok) { rmrf(tmp); throw new Error(`could not check out ${ref}: ${(r1.ok ? r2.err : r1.err).trim().slice(0, 300)}`); }
  const dir = path.join(tree, ...prefix.split('/').filter(Boolean));
  fs.mkdirSync(dir, { recursive: true });
  return { dir, cleanup: () => rmrf(tmp), commit: commit.out.trim() };
}

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp dir: left for the OS */ } }

const escData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (s) => escData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

export function annotations(issues, prefix = '') {
  const lines = [];
  for (const i of issues) {
    if (i.level === 'notice' && i.check === 'lint') continue; // orphan/duplicate info would drown the PR
    const props = [`file=${escProp(prefix ? path.posix.join(prefix, i.file) : i.file)}`];
    if (i.line) props.push(`line=${i.line}`);
    props.push(`title=${escProp(`agentneuron ${i.check}: ${i.rule}`)}`);
    lines.push(`::${i.level} ${props.join(',')}::${escData(i.message + (i.fix ? `\n${i.fix}` : ''))}`);
  }
  return lines;
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function markdown(res) {
  const { issues, failed, failOn, base } = res;
  const count = (check, level) => issues.filter((i) => (!check || i.check === check) && i.level === level).length;
  const row = (label, check) => `| ${label} | ${count(check, 'error')} | ${count(check, 'warning')} | ${count(check, 'notice')} |`;
  const L = [`## AgentNeuron context CI: ${failed ? 'FAILED' : 'passed'}`, ''];
  L.push(`Fails on: **${failOn}**. ${res.files} tracked files. Health ${res.health.score}/100 (${res.health.grade}); truth check ${res.verify.false} false of ${res.verify.total} claims; agent-config risk ${res.audit.score}/100 (${res.audit.level}).`);
  if (base) L.push('', `Only issues introduced since \`${cell(base.ref)}\` are listed (${base.preexisting} pre-existing issue${base.preexisting === 1 ? '' : 's'} hidden, ${base.fixed} fixed).`);
  L.push('', '| Check | Errors | Warnings | Notices |', '|---|---:|---:|---:|', row('Lint', 'lint'), row('Truth check', 'verify'), row('Security audit', 'audit'), row('Context budget', 'budget'), '');
  const shown = issues.filter((i) => i.level !== 'notice').slice(0, MAX_ROWS);
  if (shown.length) {
    L.push('| Level | Check | Location | Issue | Suggested fix |', '|---|---|---|---|---|');
    for (const i of shown) L.push(`| ${i.level} | ${i.check} | \`${cell(i.file)}${i.line ? ':' + i.line : ''}\` | ${cell(i.message)} | ${cell(i.fix || '')} |`);
    const more = issues.filter((i) => i.level !== 'notice').length - shown.length;
    if (more > 0) L.push('', `…and ${more} more.`);
  } else L.push('No errors or warnings.');
  return L.join('\n') + '\n';
}

export async function runCi(root, { format = 'markdown', failOn = 'error', base = null, budget = DEFAULT_BUDGET } = {}) {
  const head = await collect(root, { budget, stableFacts: !!base });
  let issues = head.issues;
  let baseInfo = null;
  if (base) {
    const b = await materializeBase(root, base);
    try {
      const old = await collect(b.dir, { budget, stableFacts: true });
      const keys = new Set(old.issues.map((i) => i.key));
      const now = new Set(issues.map((i) => i.key));
      const fresh = issues.filter((i) => !keys.has(i.key));
      baseInfo = { ref: base, commit: b.commit, preexisting: issues.length - fresh.length, fixed: old.issues.filter((i) => !now.has(i.key)).length };
      issues = fresh;
    } finally { b.cleanup(); }
  }
  const failed = failOn === 'never' ? false : issues.some((i) => i.level === 'error' || (failOn === 'warn' && i.level === 'warning'));
  return { ...head, issues, base: baseInfo, failOn, failed, format };
}

export async function cmdCi(root, flags, log = console) {
  const format = flags.format === undefined || flags.format === true ? (process.env.GITHUB_ACTIONS === 'true' ? 'github' : 'markdown') : String(flags.format).toLowerCase();
  if (!CI_FORMATS.includes(format)) { log.error(`agentneuron: --format must be one of ${CI_FORMATS.join(', ')}`); return 2; }
  const failOn = flags['fail-on'] === undefined ? 'error' : String(flags['fail-on']).toLowerCase();
  if (!FAIL_ON.includes(failOn)) { log.error(`agentneuron: --fail-on must be one of ${FAIL_ON.join(', ')}`); return 2; }
  const budget = flags.budget === undefined ? DEFAULT_BUDGET : Number(flags.budget);
  if (!Number.isFinite(budget) || budget <= 0) { log.error('agentneuron: --budget must be a positive number of tokens'); return 2; }
  if (flags.base === true) { log.error('agentneuron: --base needs a git ref, e.g. --base origin/main'); return 2; }
  const base = flags.base === undefined || flags.base === '' ? null : String(flags.base);
  let res;
  try { res = await runCi(root, { format, failOn, base, budget }); } catch (e) { log.error(`agentneuron ci: ${e.message}`); return 2; }
  if (format === 'json') {
    const { format: _f, ...rest } = res;
    log.log(JSON.stringify({ schema: 'agentneuron.ci/v1', ...rest }, null, 2));
  } else if (format === 'github') {
    const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } }; // macOS /var -> /private/var
    const rel = path.relative(real(process.cwd()), real(res.root)).split(path.sep).join('/');
    for (const l of annotations(res.issues, rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : '')) log.log(l);
    const md = markdown(res);
    const summary = process.env.GITHUB_STEP_SUMMARY;
    let wrote = false;
    if (summary) { try { fs.appendFileSync(summary, md); wrote = true; } catch (e) { log.error(`agentneuron ci: could not write GITHUB_STEP_SUMMARY: ${e.message}`); } }
    if (!wrote) log.log(md);
  } else log.log(markdown(res));
  return res.failed ? 1 : 0;
}
