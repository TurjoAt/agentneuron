// `agentneuron export`: a report from the same data the server's /api/reports/export uses.
import fs from 'node:fs';
import path from 'node:path';
import { createHeadlessCtx } from '../core/headless.js';
import { exportReport } from '../reports/index.js';

export const EXPORT_FORMATS = ['ai', 'json', 'md', 'csv', 'html'];
const UNITS = { h: 3600000, d: 86400000, w: 7 * 86400000 };

const MAX_SPAN = 2000 * UNITS.d; // reports bucket by day and stop after 2000 buckets

/** "7d" | "24h" | "2w" | "all" -> { from, to } ("all": from = null, resolved later), or null when malformed. */
export function parseRangeArg(s, now = Date.now()) {
  const v = String(s ?? '7d').trim().toLowerCase();
  if (v === 'all') return { from: null, to: now };
  const m = /^(\d{1,5})([hdw])$/.exec(v);
  if (!m || Number(m[1]) <= 0 || Number(m[1]) * UNITS[m[2]] > MAX_SPAN) return null;
  return { from: now - Number(m[1]) * UNITS[m[2]], to: now };
}

/** "all" = from the oldest recorded event/metric (30 days when there is none), at most MAX_SPAN. */
export function resolveAll(ctx, to) {
  let min = Infinity;
  for (const q of [ctx.persist?.events, ctx.persist?.metrics]) {
    try { for (const r of q?.query({ limit: 0 }) || []) if (r.ts > 0 && r.ts < min) min = r.ts; } catch { /* unreadable */ }
  }
  for (const e of ctx.store?.events || []) if (e.ts > 0 && e.ts < min) min = e.ts;
  const from = Number.isFinite(min) ? min : to - 30 * UNITS.d;
  return { from: Math.max(from, to - MAX_SPAN + UNITS.d), to };
}

export async function cmdExport(root, flags, log = console) {
  const format = flags.format === undefined ? 'ai' : String(flags.format).toLowerCase();
  if (!EXPORT_FORMATS.includes(format)) { log.error(`agentneuron: --format must be one of ${EXPORT_FORMATS.join(', ')}`); return 2; }
  const range = parseRangeArg(flags.range === true ? undefined : flags.range);
  if (!range) { log.error('agentneuron: --range must look like 24h, 7d, 2w or all (at most 2000 days)'); return 2; }
  if (flags.out === true) { log.error('agentneuron: --out needs a file name'); return 2; }
  const ctx = await createHeadlessCtx(root);
  const out = await exportReport(ctx, range.from === null ? resolveAll(ctx, range.to) : range, format);
  // exportReport falls back to CSV for formats it does not know; never print CSV for another format
  if (format !== 'csv' && /csv/i.test(String(out?.type || ''))) { log.error(`agentneuron: format "${format}" is not supported by this build`); return 2; }
  const body = typeof out.body === 'string' || Buffer.isBuffer(out.body) ? out.body : JSON.stringify(out.body, null, 2);
  if (flags.out) {
    const dest = path.resolve(String(flags.out));
    fs.writeFileSync(dest, body);
    log.error(`wrote ${dest}`);
  } else process.stdout.write(body);
  return 0;
}
