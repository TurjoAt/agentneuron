// `agentneuron export`: a report from the same data the server's /api/reports/export uses.
import fs from 'node:fs';
import path from 'node:path';
import { createHeadlessCtx } from '../core/headless.js';
import { exportReport } from '../reports/index.js';

export const EXPORT_FORMATS = ['ai', 'json', 'md', 'csv', 'html'];
const UNITS = { h: 3600000, d: 86400000, w: 7 * 86400000 };

/** "7d" | "24h" | "2w" | "all" -> { from, to }, or null when malformed. */
export function parseRangeArg(s, now = Date.now()) {
  const v = String(s ?? '7d').trim().toLowerCase();
  if (v === 'all') return { from: 1, to: now };
  const m = /^(\d{1,5})([hdw])$/.exec(v);
  if (!m || Number(m[1]) <= 0) return null;
  return { from: now - Number(m[1]) * UNITS[m[2]], to: now };
}

export async function cmdExport(root, flags, log = console) {
  const format = flags.format === undefined ? 'ai' : String(flags.format).toLowerCase();
  if (!EXPORT_FORMATS.includes(format)) { log.error(`agentneuron: --format must be one of ${EXPORT_FORMATS.join(', ')}`); return 2; }
  const range = parseRangeArg(flags.range === true ? undefined : flags.range);
  if (!range) { log.error('agentneuron: --range must look like 24h, 7d, 2w or all'); return 2; }
  if (flags.out === true) { log.error('agentneuron: --out needs a file name'); return 2; }
  const ctx = await createHeadlessCtx(root);
  const out = await exportReport(ctx, range, format);
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
