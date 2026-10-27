// Saved briefs in .agentneuron/briefs/<id>.json (+ .md). A saved resume brief also writes a handoff note
// (generated text only: counts, file paths, run-derived steps, the brief id) so get_handoffs sees it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { agentneuronPath, FileError, atomicJson } from '../files/paths.js';
import { readRegularAsync } from '../files/safeio.js';
import { createHandoffs } from '../live/handoffs.js';
import { maskDeep } from '../server/mask.js';

const MAX_BRIEFS = 200;
const MAX_BYTES = 2 * 1024 * 1024;
const ID = /^b[0-9a-f]{10}$/;

export const briefsDir = (root) => agentneuronPath(root, 'briefs');

/** Persist a brief (resume or debug). Returns { id, path, handoff }. */
export function saveBrief(root, kind, brief, { now = Date.now } = {}) {
  if (!['resume', 'debug'].includes(kind)) throw new FileError(400, 'kind must be resume or debug');
  const id = `b${crypto.randomBytes(5).toString('hex')}`;
  const dir = briefsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const createdAt = now();
  const title = kind === 'resume' ? brief.title || brief.task?.id || brief.source?.session || 'Resume brief' : `${brief.error?.type || 'Error'}: ${brief.error?.quote || ''}`.slice(0, 200);
  const source = kind === 'resume' ? { session: brief.source?.session || null, task: brief.source?.task || null } : { run: brief.run?.id || null, error: brief.source === 'error' };
  const row = maskDeep({ id, kind, title, createdAt, source, brief });
  atomicJson(path.join(dir, `${id}.json`), row);
  try { fs.writeFileSync(path.join(dir, `${id}.md`), String(row.brief.markdown || '')); } catch { /* the json is the record */ }
  let handoff = null;
  if (kind === 'resume') {
    const files = (brief.files || []).map((f) => f.path).filter((p) => typeof p === 'string' && !p.startsWith('/')).slice(0, 30);
    const safeNext = (brief.next || []).filter((n) => ['fix-test', 'verify', 'criterion', 'checkpoint'].includes(n.kind)).map((n) => n.label).slice(0, 10);
    const done = (brief.done || []).filter((d) => d.kind === 'edit' && d.path).map((d) => `Edited ${d.path}`).slice(0, 15);
    try {
      handoff = createHandoffs(root, { now }).add({
        agent: 'agentneuron', sessionId: brief.source?.session || 'brief', taskId: brief.source?.task || undefined,
        summary: `Resume brief ${id}: ${brief.counts?.done ?? 0} done, ${brief.counts?.failed ?? 0} failed attempts, ${brief.counts?.next ?? 0} next steps. Full brief: get_resume_brief { "brief": "${id}" } or .agentneuron/briefs/${id}.md`,
        done, next: safeNext, blockers: (brief.runs || []).filter((r) => r.failed > 0).map((r) => `${r.kind}: ${r.failed} failing`).slice(0, 5), files,
      });
    } catch { handoff = null; }
  }
  prune(dir);
  return { id, path: `.agentneuron/briefs/${id}.json`, handoff: handoff ? handoff.id : null };
}

function prune(dir) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => /^b[0-9a-f]{10}\.json$/.test(n)); } catch { return; }
  if (names.length <= MAX_BRIEFS) return;
  const byAge = names.map((n) => { try { return [n, fs.statSync(path.join(dir, n)).mtimeMs]; } catch { return [n, 0]; } }).sort((a, b) => a[1] - b[1]);
  for (const [n] of byAge.slice(0, names.length - MAX_BRIEFS)) { try { fs.rmSync(path.join(dir, n)); fs.rmSync(path.join(dir, n.replace(/\.json$/, '.md')), { force: true }); } catch { /* ignore */ } }
}

async function readRow(dir, name) {
  try {
    const r = await readRegularAsync(path.join(dir, name), { maxBytes: MAX_BYTES, confine: dir });
    if (!r) return null;
    const o = JSON.parse(r.buf.toString('utf8'));
    return o && typeof o === 'object' && typeof o.id === 'string' && ID.test(o.id) ? o : null;
  } catch { return null; }
}

/** List saved briefs (newest first): [{ id, kind, title, createdAt, source }]. */
export async function listBriefs(root, { limit = 50 } = {}) {
  const dir = briefsDir(root);
  let names = [];
  try { names = (await fs.promises.readdir(dir)).filter((n) => /^b[0-9a-f]{10}\.json$/.test(n)); } catch { return []; }
  const rows = [];
  for (const n of names.slice(0, MAX_BRIEFS)) {
    const o = await readRow(dir, n);
    if (o) rows.push({ id: o.id, kind: o.kind === 'debug' ? 'debug' : 'resume', title: String(o.title || ''), createdAt: Number(o.createdAt) || 0, source: o.source && typeof o.source === 'object' ? o.source : {} });
  }
  return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, Math.max(1, Math.min(200, limit)));
}

/** One saved brief, or throws 404. */
export async function getBrief(root, id) {
  if (typeof id !== 'string' || !ID.test(id)) throw new FileError(400, 'invalid brief id');
  const o = await readRow(briefsDir(root), `${id}.json`);
  if (!o) throw new FileError(404, 'brief not found');
  return maskDeep(o);
}
