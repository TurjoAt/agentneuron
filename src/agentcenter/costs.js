// Cost estimation (USD) from token usage. Prices are per 1M tokens and only an estimate.
export const DEFAULT_PRICING = {
  'opus-legacy': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  opus: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  sonnet: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  haiku: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  gpt: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  other: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
};

export function modelFamily(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('opus')) return /claude-3-opus|opus-3|opus-4-(?:0|1)(?!\d)|opus-4-20\d{6}|opus-4$/.test(m) ? 'opus-legacy' : 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  if (/gpt|codex|o[134]-|^o[134]$/.test(m)) return 'gpt';
  return 'other';
}

export function priceFor(model, pricing = {}) {
  const fam = modelFamily(model);
  const base = DEFAULT_PRICING[fam] || DEFAULT_PRICING.other;
  const o = pricing?.[model] || pricing?.[fam] || (fam === 'opus-legacy' ? pricing?.opus : null) || {};
  const pick = (k) => (typeof o[k] === 'number' && o[k] >= 0 ? o[k] : base[k]);
  return { input: pick('input'), output: pick('output'), cacheRead: pick('cacheRead'), cacheWrite: pick('cacheWrite') };
}

export function usdOf(usage, model, pricing) {
  const p = priceFor(model, pricing);
  return ((usage.input || 0) * p.input + (usage.output || 0) * p.output + (usage.cacheRead || 0) * p.cacheRead + (usage.cacheWrite || 0) * p.cacheWrite) / 1e6;
}

const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0 });
const round = (n) => Math.round(n * 10000) / 10000;
const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10);

/**
 * @param sessionsList sessions.list() output
 * @param transcripts Map|object  sessionId -> { models, days } (from readTranscriptUsage) | null
 * @param pricing config.pricing overrides (keyed by family or model id)
 * @param range optional { from, to } ms epoch (filters sessions by lastAt and days by date)
 */
export function estimateCosts(sessionsList, transcripts = {}, pricing = {}, range = {}) {
  const get = (id) => (transcripts instanceof Map ? transcripts.get(id) : transcripts?.[id]) || null;
  const from = range.from || 0, to = range.to || Infinity;
  const daysMap = new Map();
  const sessions = [];
  const total = zero();
  for (const s of sessionsList || []) {
    if (s.lastAt && (s.lastAt < from || (s.startedAt || s.lastAt) > to)) continue;
    const row = { sessionId: s.sessionId, tool: s.tool, title: s.title, startedAt: s.startedAt, lastAt: s.lastAt, ...zero(), models: [], estimated: false };
    const t = get(s.sessionId);
    const days = {};
    if (t && t.models && Object.keys(t.models).length) {
      for (const [model, u] of Object.entries(t.models)) {
        const usd = usdOf(u, model, pricing);
        row.models.push(model);
        for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) row[k] += u[k] || 0;
        row.usd += usd;
      }
      for (const [d, byModel] of Object.entries(t.days || {})) {
        const acc = (days[d] ||= zero());
        for (const [model, u] of Object.entries(byModel)) {
          for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) acc[k] += u[k] || 0;
          acc.usd += usdOf(u, model, pricing);
        }
      }
    } else if (s.tokens) {
      // no transcript: price the session totals with the family guess for its tool
      row.estimated = true;
      const model = s.tool === 'codex' ? 'gpt' : 'sonnet';
      row.models.push(model);
      for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) row[k] = s.tokens[k] || 0;
      row.usd = usdOf(row, model, pricing);
      if (s.lastAt) days[dayOf(s.lastAt)] = { ...row };
    }
    for (const [d, v] of Object.entries(days)) {
      const ms = Date.parse(d);
      if (ms + 86400000 <= from || ms > to) continue;
      const acc = daysMap.get(d) || { day: d, ...zero(), sessions: 0 };
      for (const k of ['input', 'output', 'cacheRead', 'cacheWrite', 'usd']) acc[k] += v[k] || 0;
      acc.sessions++;
      daysMap.set(d, acc);
    }
    row.usd = round(row.usd);
    for (const k of ['input', 'output', 'cacheRead', 'cacheWrite', 'usd']) total[k] += row[k];
    sessions.push(row);
  }
  const daysOut = [...daysMap.values()].map((d) => ({ ...d, usd: round(d.usd) })).sort((a, b) => a.day.localeCompare(b.day));
  total.usd = round(total.usd);
  return { sessions: sessions.sort((a, b) => b.usd - a.usd), days: daysOut, total, currency: 'USD', note: 'Estimate from token usage and list prices; actual billing may differ.' };
}
