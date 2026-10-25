// Coordination helpers shared by the HTTP routes and the MCP server, plus per-role views of live data.
import { FileError } from '../files/paths.js';
import { cleanId } from './claims.js';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

/** Board assignee for an agent session: "claude.1a2b3c4d" (the board accepts [A-Za-z][\w.-]{0,40}). */
export function assigneeFor(agent, sessionId) {
  let a = String(agent || 'agent').replace(/[^\w-]/g, '-').replace(/^[^A-Za-z]+/, '').slice(0, 24) || 'agent';
  const s = String(sessionId || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  if (s && s !== 'default') a += '.' + s;
  return a.slice(0, 41);
}

/** Claim a board task for an agent session: assignee + in-progress column, and advisory claims on its files. */
export async function claimTask(board, claims, { id, agent, sessionId, ttlMs, force } = {}, role = 'admin') {
  if (typeof id !== 'string' || !id || id.length > 200) throw new FileError(400, 'task id required');
  const who = { agent: cleanId(agent, 'agent', 40), sessionId: cleanId(sessionId, 'default') };
  const state = board.get(role);
  const task = state.tasks.find((t) => t.id === id);
  if (!task) throw new FileError(404, 'task not found');
  const cols = state.columns;
  const doing = cols.find((c) => c.id === 'doing') || cols[Math.min(2, cols.length - 1)];
  const assignee = assigneeFor(who.agent, who.sessionId);
  const prev = task.assignee || null;
  const r = await board.update(id, { assignee, status: doing.id }, role);
  const t = r.task || task;
  const files = (t.files || []).filter((f) => typeof f === 'string' && f.trim());
  let lock = { granted: [], conflicts: [] };
  if (files.length) {
    try { lock = claims.claim({ ...who, paths: files.slice(0, 50), ttlMs, taskId: t.id, note: `task: ${t.title}`.slice(0, 200), force }); } catch (e) { lock = { granted: [], conflicts: [], error: e.message }; }
  }
  return { task: t, assignee, previousAssignee: prev && prev !== assignee ? prev : null, claims: lock };
}

/** Who may see prompts / diff hunks. Prompts: default on for a loopback bind, off otherwise; viewers need live.viewerPrompts. */
export function liveAccess(config = {}) {
  const lc = config.live && typeof config.live === 'object' ? config.live : {};
  const loop = LOOPBACK.has(String(config.host || '127.0.0.1').toLowerCase());
  const show = typeof lc.showPrompts === 'boolean' ? lc.showPrompts : loop;
  return {
    showPrompts: show,
    prompts: (role) => show && (role === 'admin' || lc.viewerPrompts === true),
    diffs: (role) => role === 'admin' || lc.viewerDiffs === true,
  };
}

export const stripEdit = (e) => ({ ...e, hunk: [], hunkHidden: true });
/** Session without prompt text (prompt-derived title included); `title` is only ever a transcript summary. */
export const stripSession = ({ lastPrompt, lastThinking, promptTitle, ...s }) => s; // eslint-disable-line no-unused-vars

/** Snapshot as one role may see it. */
export function snapshotFor(snap, role, access) {
  const p = access.prompts(role), d = access.diffs(role);
  return {
    ...snap,
    showPrompts: p, showDiffs: d,
    sessions: p ? snap.sessions : snap.sessions.map(stripSession),
    edits: d ? snap.edits : snap.edits.map(stripEdit),
    notes: p ? snap.notes : [],
  };
}
