// agentneuron usage: token, cost and tool analytics from local agent sessions (read-only).
import { loadConfig } from '../core/config.js';
import { getUsage } from '../usage/index.js';

const RANGES = new Set(['24h', '7d', '30d', '90d', 'all']);
const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const int = (n) => (Number(n) || 0).toLocaleString('en-US');
const pct = (n) => (n === null || n === undefined || !Number.isFinite(n) ? 'n/a' : `${Math.round(n * 100)}%`);
const dur = (ms) => {
  if (ms === null || ms === undefined) return 'n/a';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
};
const pad = (s, n) => String(s).padEnd(n);

export async function cmdUsage(root, flags, { log = console, home } = {}) {
  const range = flags.range === undefined ? '30d' : String(flags.range);
  if (!RANGES.has(range)) { (log.error || console.error)(`agentneuron usage: --range must be one of ${[...RANGES].join(', ')}`); return 2; }
  const scope = flags.scope === undefined ? 'project' : String(flags.scope);
  if (scope !== 'project' && scope !== 'all') { (log.error || console.error)('agentneuron usage: --scope must be project or all'); return 2; }
  const config = loadConfig(root);
  // the CLI runs as the local user: no time budget, every transcript in scope is read
  const U = getUsage({ root: config.root, config, home, usageBudgetMs: Infinity });
  const sum = await U.summary({ range, scope });
  if (flags.json) { log.log(JSON.stringify({ schema: 'agentneuron.usage/v1', ...sum }, null, 2)); return 0; }

  const k = sum.kpis;
  const cov = sum.coverage;
  log.log(`Agent usage, ${range === 'all' ? 'all time' : `last ${range}`} (${scope === 'all' ? 'all projects' : config.root})\n`);
  if (!cov.sessions) {
    log.log('No Claude Code or Codex sessions found in this range.');
    if (scope === 'project') log.log('Sessions are matched by the directory they ran in; try --scope all or a wider --range.');
    return 0;
  }
  const exactNote = k.usd ? (k.usdExact >= k.usd - 0.005 ? 'exact' : k.usdExact > 0 ? `${usd(k.usdExact)} exact, rest estimated` : 'estimated') : '';
  log.log(`  Cost       ${usd(k.usd)}${exactNote ? `  (${exactNote})` : ''}`);
  log.log(`  Sessions   ${int(k.sessions)}   prompts ${int(k.prompts)}   active ${dur(k.activeMs)}`);
  log.log(`  Tokens     in ${int(k.tokens.input)}  out ${int(k.tokens.output)}  cache read ${int(k.tokens.cacheRead)}  cache write ${int(k.tokens.cacheWrite)}`);
  log.log(`  Cache      hit rate ${pct(k.cacheHitRate)}, saved ${usd(k.cacheSavedUsd)}`);
  log.log(`  Tools      ${int(k.toolCalls)} calls, ${int(k.toolErrors)} errors${k.toolCalls ? ` (${pct(k.toolErrors / k.toolCalls)})` : ''}`);
  log.log(`  Lines      +${int(k.linesAdded)} / -${int(k.linesRemoved)}`);
  log.log(`  Turns      median ${dur(k.medianTurnMs)}, p90 ${dur(k.p90TurnMs)}`);
  const b = sum.budget;
  log.log(`  Today      ${usd(b.todayUsd)}${b.dailyUsd !== null ? ` of ${usd(b.dailyUsd)} daily budget${b.over ? ' (over)' : ''}` : ''}, projected ${usd(b.projectedTodayUsd)}`);

  if (sum.byModel.length) {
    log.log('\nTop models');
    for (const m of sum.byModel.slice(0, 5)) log.log(`  ${pad(m.model, 32)} ${pad(usd(m.usd), 10)} ${int(m.turns)} turns, ${int(m.tokens)} tokens`);
  }
  const t = await U.tools({ range, scope });
  if (t.tools.length) {
    log.log('\nTop tools');
    for (const x of t.tools.slice(0, 8)) log.log(`  ${pad(x.name, 32)} ${pad(int(x.calls), 7)} calls  ${x.errors ? `${int(x.errors)} errors (${pct(x.errorRate)})` : 'no errors'}`);
  }
  if (sum.anomalies.length) {
    log.log('\nAnomalies');
    for (const a of sum.anomalies.slice(0, 8)) log.log(`  [${a.severity}] ${a.kind}: ${a.message} (session ${String(a.session).slice(0, 8)})`);
  }
  if (sum.tips.length) {
    log.log('\nTips');
    for (const x of sum.tips) log.log(`  - ${x.message}`);
  }
  log.log(`\n${cov.sessions} session(s), ${cov.exactCostSessions} with exact cost recorded by Claude Code; ${cov.transcripts}/${cov.totalTranscripts} transcript(s) read.`);
  return 0;
}
