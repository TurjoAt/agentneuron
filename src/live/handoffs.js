// End-of-session handoff notes (done / next / blockers) in .agentneuron/handoffs.jsonl.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { agentneuronPath, FileError } from '../files/paths.js';
import { createJsonl } from '../persist/jsonl.js';
import { maskSecretsInText } from '../health/secrets.js';
import { cleanId } from './claims.js';

const MAX_ITEMS = 30;
const MAX_ITEM = 500;
const MAX_ROWS = 2000;

function items(v) {
  const arr = Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.split(/\r?\n/) : [];
  return arr.filter((x) => typeof x === 'string' && x.trim()).slice(0, MAX_ITEMS).map((x) => maskSecretsInText(x.trim().replace(/^[-*]\s+/, '')).slice(0, MAX_ITEM));
}
const tid = (v) => (typeof v === 'string' && /^[\w:.-]{1,120}$/.test(v) ? v : null);

/** Validate a stored row (the file is user-editable): only known fields, re-masked. */
function clean(r) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string') return null;
  return {
    id: r.id.slice(0, 40), ts: Number(r.ts) || 0, agent: cleanId(r.agent, 'agent', 40), sessionId: cleanId(r.sessionId, 'default'),
    taskId: tid(r.taskId), summary: maskSecretsInText(String(r.summary || '')).slice(0, 300),
    done: items(r.done), next: items(r.next), blockers: items(r.blockers), files: items(r.files).slice(0, 30),
  };
}

export function createHandoffs(root, { now = Date.now } = {}) {
  const file = agentneuronPath(root, 'handoffs.jsonl');
  const log = createJsonl(file, { maxBytes: 5 * 1024 * 1024, keep: 1 });

  function add({ agent, sessionId, taskId, summary, done, next, blockers, files } = {}) {
    const row = clean({ id: 'h' + crypto.randomBytes(5).toString('hex'), ts: now(), agent, sessionId, taskId, summary, done, next, blockers, files });
    if (!row.summary && !row.done.length && !row.next.length && !row.blockers.length) throw new FileError(400, 'handoff needs a summary, done, next or blockers');
    if (!log.append(row)) throw new FileError(500, 'could not write handoffs.jsonl');
    return row;
  }

  function list({ taskId, sessionId, agent, limit } = {}) {
    const n = Math.max(1, Math.min(200, Math.floor(Number(limit)) || 20));
    const rows = log.readAll().slice(-MAX_ROWS).map(clean).filter(Boolean)
      .filter((r) => (!taskId || r.taskId === taskId) && (!sessionId || r.sessionId === sessionId) && (!agent || r.agent === agent));
    return rows.sort((a, b) => b.ts - a.ts).slice(0, n);
  }

  let sig = '';
  function changed() {
    let s = '';
    try { const st = fs.statSync(file); s = `${st.mtimeMs}:${st.size}`; } catch { /* none */ }
    if (s === sig) return false;
    sig = s;
    return true;
  }
  return { add, list, changed };
}
