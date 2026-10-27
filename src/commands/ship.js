// `agentneuron ship`: completion + readiness report. Static by default; --run runs the detected checks first
// (the CLI is the user's own shell, so no exec gate applies here).
import { spawn, killTree } from '../core/spawn.js';
import { validRev } from '../git2/run.js';
import { completionReport, readiness, placeholders, detectChecks } from '../ship/index.js';
import { runChecks, CHECK_TIMEOUT_MS } from '../actions/ship.js';
import { maskDeep } from '../server/mask.js';
import { maskSecretsInText } from '../health/secrets.js';

export const FAIL_ON = ['high', 'medium', 'low'];
const RANK = { high: 0, medium: 1, low: 2 };

/** Minimal job for runChecks(): spawn without a shell, stream nothing unless verbose. */
function localJob(root, log) {
  return {
    id: null,
    log: (stream, text) => { if (stream === 'info') log.error(String(text).trim()); },
    exec(cmd, args, { env, timeoutMs = CHECK_TIMEOUT_MS } = {}) {
      return new Promise((resolve) => {
        let child;
        try { child = spawn(cmd, args, { cwd: root, env: { ...process.env, ...(env || {}) }, shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch (e) { resolve({ code: 127, stdout: '', stderr: String(e.message || e) }); return; }
        let stdout = '', stderr = '';
        const cap = (s, d) => (s.length < 5 * 1024 * 1024 ? s + d : s);
        child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
        child.stdout.on('data', (d) => { stdout = cap(stdout, d); });
        child.stderr.on('data', (d) => { stderr = cap(stderr, d); });
        const to = setTimeout(() => killTree(child, 'SIGKILL'), timeoutMs);
        child.on('error', (e) => { clearTimeout(to); resolve({ code: 127, stdout, stderr: stderr + String(e.message || e) }); });
        child.on('close', (code) => { clearTimeout(to); resolve({ code, stdout, stderr }); });
      });
    },
  };
}

const ICON = { verified: 'VERIFIED', partial: 'PARTIAL', failing: 'FAILING', unverified: 'UNVERIFIED' };

export async function cmdShip(root, flags = {}, log = console) {
  const failOn = flags['fail-on'] === undefined || flags['fail-on'] === true ? 'high' : String(flags['fail-on']);
  if (!FAIL_ON.includes(failOn)) { log.error(`agentneuron ship: --fail-on must be ${FAIL_ON.join('|')}`); return 2; }
  const base = typeof flags.base === 'string' ? flags.base : 'HEAD';
  if (!validRev(base)) { log.error('agentneuron ship: --base must be a git revision'); return 2; }

  if (flags.run) {
    const checks = await detectChecks(root);
    if (!checks.length) log.error('ship: no test, build, lint or typecheck command detected');
    else await runChecks(root, checks, localJob(root, log));
  }
  const [report, ready, ph] = await Promise.all([completionReport(root, { base }), readiness(root, { fresh: true }), placeholders(root)]);
  const atOrAbove = (f) => RANK[f.severity] <= RANK[failOn];
  const blocking = [...ready.findings, ...ph.findings].filter(atOrAbove);
  const code = blocking.length || report.verdict === 'failing' ? 1 : 0;

  if (flags.json) {
    log.log(JSON.stringify(maskDeep({ schema: 'agentneuron.ship/v1', root, failOn, exitCode: code, report, readiness: ready, placeholders: ph }), null, 2));
    return code;
  }
  const L = (s = '') => log.log(maskSecretsInText(s));
  L(`Ship check: ${ICON[report.verdict]}${report.head ? `  (${base}${base === 'HEAD' ? ', uncommitted changes' : '..working tree'})` : ''}`);
  for (const r of report.reasons) L(`  ${r.level === 'ok' ? '+' : r.level === 'err' ? 'x' : '-'} ${r.text}`);
  if (report.git.error) L(`  git: ${report.git.error}`);
  L(`\nChanged: ${report.totals.files} file${report.totals.files === 1 ? '' : 's'}, +${report.totals.added} -${report.totals.removed}`);
  for (const f of report.changedFiles.slice(0, 15)) L(`  ${f.status.padEnd(2)} ${f.path}  +${f.added} -${f.removed}`);
  if (report.changedFiles.length > 15) L(`  ... ${report.changedFiles.length - 15} more`);
  L('\nChecks:');
  if (!report.checks.length) L('  none detected');
  for (const c of report.checks) L(`  ${c.status.padEnd(7)} ${c.label}${c.last ? `  ${c.last.passed} passed, ${c.last.failed} failed${c.stale ? ' (stale)' : ''}` : ''}`);
  for (const f of report.failures.slice(0, 10)) L(`    x ${f.name}${f.file ? `  ${f.file}${f.line ? ':' + f.line : ''}` : ''}${f.message ? `  ${f.message.slice(0, 140)}` : ''}`);
  const s = report.criteriaSummary;
  if (s.criteria) {
    L(`\nCriteria: ${s.criteria} requested: ${s.verified} verified, ${s.incomplete} incomplete, ${s.untested} untested, ${s.failed} failed`);
    for (const c of report.criteria.filter((x) => x.status !== 'verified').slice(0, 12)) L(`  ${c.status.padEnd(10)} ${c.text}  [${c.task.title}]`);
  }
  L(`\nReadiness: ${ready.ready ? 'ready' : `NOT READY (${ready.blockers} blocker${ready.blockers === 1 ? '' : 's'})`}  high ${ready.counts.high}, medium ${ready.counts.medium}, low ${ready.counts.low}`);
  for (const f of ready.findings.filter(atOrAbove).slice(0, 20)) L(`  ${f.severity.padEnd(6)} ${f.title}${f.location.path ? `  ${f.location.path}${f.location.line ? ':' + f.location.line : ''}` : ''}\n         fix: ${f.fix}`);
  L(`\nPlaceholders: ${ph.count}  (high ${ph.counts.high}, medium ${ph.counts.medium}, low ${ph.counts.low})`);
  for (const f of ph.findings.filter(atOrAbove).slice(0, 20)) L(`  ${f.severity.padEnd(6)} ${f.title}  ${f.location.path}:${f.location.line}`);
  if (!flags.run && report.checks.some((c) => c.status === 'never' || c.stale)) L('\nRun the checks with: agentneuron ship --run');
  return code;
}
