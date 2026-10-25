// Live agent activity (SSE agent.* events + GET /api/live snapshot). Incoming events are queued and
// applied once per animation frame; nothing is applied while the tab is hidden (the queue is capped).

import { api, post } from './api.js';
import { app, onStream, onBoot, toast } from './store.svelte.js';

const MAX = { edits: 500, commands: 200, notes: 60, collisions: 50 };
const MAX_QUEUE = 3000;

export const LANES = [
  { id: 'claude', label: 'Claude', tool: 'claude' },
  { id: 'codex', label: 'Codex', tool: 'codex' },
  { id: 'cursor', label: 'Cursor / other', tool: 'cursor' },
  { id: 'human', label: 'Human / unknown', tool: 'generic' },
];
export const laneOf = (tool) => (tool === 'claude' || tool === 'codex' ? tool : !tool || tool === 'human' || tool === 'generic' ? 'human' : 'cursor');
/** Tool key for colours (TOOLS in tools.js): human -> generic. */
export const colorTool = (tool) => (!tool || tool === 'human' ? 'generic' : tool);
export const skey = (s) => `${s.tool}:${s.sessionId}`;

class LiveState {
  loaded = $state(false);
  unsupported = $state(false);
  sessions = $state.raw([]);
  edits = $state.raw([]); // oldest first
  commands = $state.raw([]);
  notes = $state.raw([]);
  collisions = $state.raw([]);
  claims = $state.raw([]);
  handoffs = $state.raw([]);
  showPrompts = $state(false);
  showDiffs = $state(true);
  /** path -> { tool, sessionId, ts, op } of the latest editor (drives pulses / "now editing") */
  editors = $state.raw({});
  /** events applied since load (views use it to know something arrived) */
  seq = $state(0);
}

export const live = new LiveState();

const upsert = (list, item, key, max) => {
  const i = list.findIndex((x) => key(x) === key(item));
  const next = i >= 0 ? list.slice() : list.concat(item);
  if (i >= 0) next[i] = { ...list[i], ...item };
  return next.length > max ? next.slice(next.length - max) : next;
};

export async function loadLive() {
  try {
    const s = await api('/api/live');
    live.sessions = s.sessions || [];
    live.edits = s.edits || [];
    live.commands = s.commands || [];
    live.notes = s.notes || [];
    live.collisions = s.collisions || [];
    live.claims = s.claims || [];
    live.handoffs = s.handoffs || [];
    live.showPrompts = !!s.showPrompts;
    live.showDiffs = s.showDiffs !== false;
    const ed = {};
    for (const e of live.edits) ed[e.path] = { tool: e.tool, sessionId: e.sessionId, ts: e.ts, op: e.op };
    live.editors = ed;
    live.unsupported = false;
  } catch (e) {
    if (e.status === 404) live.unsupported = true;
  }
  live.loaded = true;
}

// ---------------------------------------------------------------- batching
let queue = [];
let scheduled = false;
const hidden = () => typeof document !== 'undefined' && document.hidden;

function schedule() {
  if (scheduled || hidden()) return;
  scheduled = true;
  (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(f, 16))(flush);
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => queue.length && schedule());

function enqueue(name, data) {
  if (!data || typeof data !== 'object') return;
  queue.push([name, data]);
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  schedule();
}

const seenCollision = new Set();
function flush() {
  scheduled = false;
  const batch = queue;
  queue = [];
  if (!batch.length) return;
  let { sessions, edits, commands, notes, collisions } = live;
  let editors = null;
  const pulses = {};
  for (const [name, d] of batch) {
    if (name === 'agent.session') {
      const prev = sessions.find((s) => skey(s) === skey(d));
      sessions = upsert(sessions, prev && !('lastPrompt' in d) ? { ...d, lastPrompt: prev.lastPrompt, lastThinking: prev.lastThinking } : d, skey, 200);
    } else if (name === 'agent.edit') {
      edits = upsert(edits, d, (x) => x.id, MAX.edits);
      editors ??= { ...live.editors };
      const cur = editors[d.path];
      if (!cur || d.ts >= cur.ts) editors[d.path] = { tool: d.tool, sessionId: d.sessionId, ts: d.ts, op: d.op };
      pulses[d.path] = Date.now();
    } else if (name === 'agent.command') commands = upsert(commands, d, (x) => x.id, MAX.commands);
    else if (name === 'agent.prompt' || name === 'agent.thinking') {
      notes = notes.concat(d).slice(-MAX.notes);
      const k = `${d.tool}:${d.sessionId}`;
      sessions = sessions.map((s) => (skey(s) === k ? { ...s, [name === 'agent.prompt' ? 'lastPrompt' : 'lastThinking']: d.text } : s));
    } else if (name === 'agent.collision') {
      collisions = collisions.concat({ ...d, at: Date.now() }).slice(-MAX.collisions);
      const k = `${d.reason}:${d.path}`;
      if (!seenCollision.has(k)) {
        seenCollision.add(k);
        if (seenCollision.size > 200) seenCollision.clear();
        toast(d.reason === 'claim' ? `${d.path} is claimed by ${d.claim?.agent || 'another agent'}` : `Collision: ${d.sessions?.length || 2} sessions editing ${d.path}`, 'warn', 6000);
      }
    } else if (name === 'agent.claims') live.claims = Array.isArray(d.claims) ? d.claims : [];
    else if (name === 'agent.handoff') {
      if (Array.isArray(d.handoffs)) live.handoffs = d.handoffs;
      else if (d.handoff) live.handoffs = [d.handoff, ...live.handoffs].slice(0, 20);
    }
  }
  live.sessions = sessions;
  live.edits = edits;
  live.commands = commands;
  live.notes = notes;
  live.collisions = collisions;
  if (editors) {
    const now = Date.now();
    const keys = Object.keys(editors);
    if (keys.length > 1500) for (const k of keys) if (now - editors[k].ts > 3600000) delete editors[k];
    live.editors = editors;
    // agent edits pulse the brain / file lists even for files the watcher does not track
    const p = {};
    for (const [k, t] of Object.entries(app.pulses)) if (now - t < 10_000) p[k] = t;
    app.pulses = Object.assign(p, pulses);
  }
  live.seq += batch.length;
}

for (const n of ['agent.session', 'agent.edit', 'agent.command', 'agent.prompt', 'agent.thinking', 'agent.collision', 'agent.claims', 'agent.handoff']) onStream(n, (d) => enqueue(n, d));
onBoot(() => loadLive());

/** Tool of whoever edited `path` within `ms` (for agent-coloured pulses), or null. */
export function recentEditor(path, ms = 4000) {
  const e = live.editors[path];
  return e && Date.now() - e.ts < ms ? colorTool(e.tool) : null;
}

/** Active claims touching a board task (by task id or one of its files). */
export function claimsForTask(task) {
  const files = new Set(task?.files || []);
  return live.claims.filter((c) => c.taskId === task?.id || files.has(c.pattern));
}

export async function claimPaths(paths, opts = {}) {
  return post('/api/live/claims', { paths, agent: 'human', sessionId: 'ui', ...opts });
}
export async function releaseClaim(c) {
  return post('/api/live/release', { agent: c.agent, sessionId: c.sessionId, id: c.id });
}
