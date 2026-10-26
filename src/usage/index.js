// Usage analytics over Claude Code / Codex local data. Shapes: docs/internal/usage-contract.md.
// Scaffold: every method returns an empty, correctly shaped payload until the reader lands.

const rangeOf = (spec = '30d', now = Date.now()) => {
  if (spec === 'all') return { from: 0, to: now };
  const m = /^(\d+)(h|d)$/.exec(String(spec));
  const ms = m ? Number(m[1]) * (m[2] === 'h' ? 3600e3 : 86400e3) : 30 * 86400e3;
  return { from: now - ms, to: now };
};
const coverage = () => ({ sessions: 0, exactCostSessions: 0, durationTurns: 0, transcripts: 0 });
const env = (o = {}) => ({ range: rangeOf(o.range), coverage: coverage(), generatedAt: Date.now() });

export function getUsage(_ctx) {
  return {
    async summary(o = {}) {
      return { ...env(o), kpis: { usd: 0, usdExact: 0, sessions: 0, prompts: 0, toolCalls: 0, toolErrors: 0, linesAdded: 0, linesRemoved: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cacheHitRate: null, cacheSavedUsd: 0, activeMs: 0, medianTurnMs: null, p90TurnMs: null },
      series: [], byModel: [], byBranch: [], byProject: [], byAgent: [],
      budget: { dailyUsd: null, todayUsd: 0, burnPerHourUsd: 0, projectedTodayUsd: 0, over: false }, anomalies: [], tips: [] };
    },
    async sessions(o = {}) { return { ...env(o), sessions: [] }; },
    async session(_id) { return { session: null, timeline: [], agents: [], files: [] }; },
    async fileVersion() { return { path: null, before: null, after: null, ts: null, truncated: false }; },
    async tools(o = {}) { return { ...env(o), tools: [], mcpServers: [], skills: [], hooks: { runs: 0, errors: 0, preventedStops: 0 }, interrupts: 0, denials: 0, loops: [] }; },
    async prompts(o = {}) { return { ...env(o), stats: { total: 0, avgLength: 0, interruptedRate: 0, reworkRate: 0 }, prompts: [], repeated: [] }; },
    async fleet(o = {}) { return { ...env(o), runs: [] }; },
    async impact(o = {}) { return { ...env(o), exact: false, linesAdded: 0, linesRemoved: 0, files: [], churn: [] }; },
    async activity(o = {}) {
      return { ...env(o), heatmap: [], hourly: Array(24).fill(0), weekHour: Array.from({ length: 7 }, () => Array(24).fill(0)),
        turns: { count: 0, medianMs: null, p90Ms: null, maxMs: null }, sessions: [], focusMs: 0, awayCount: 0 };
    },
    async memory() { return { memory: [], plans: [] }; },
    async settings() { return { settings: {}, permissionModes: {}, mcpNeedsAuth: [], findings: [] }; },
    async entity(kind, id) { return { kind, id, title: id, subtitle: '', stats: [], related: { sessions: [], files: [], commits: [], tasks: [], tools: [] }, links: [] }; },
  };
}
