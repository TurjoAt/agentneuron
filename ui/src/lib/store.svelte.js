// Global reactive app state (Svelte 5 runes) + boot, live stream, routing,
// theme and toasts.

import { api, connectStream, enableMock, isMock, mockRequested } from './api.js';
import { parseHash, href } from './nav.js';
import { basename } from './format.js';

class AppState {
  ready = $state(false);
  authRequired = $state(false);
  fatal = $state(null);
  mock = $state(false);
  mockReason = $state('');
  /** connecting | live | reconnecting | offline */
  conn = $state('connecting');
  lastPing = $state(0);
  now = $state(Date.now());

  state = $state.raw(null);
  files = $state.raw([]);
  events = $state.raw([]);
  health = $state.raw(null);
  conflicts = $state.raw([]);
  /** path → ts of last change (drives pulse animations) */
  pulses = $state.raw({});
  lastEventId = 0;

  /** bumped on every file change → views re-fetch (debounced) */
  dataTick = $state(0);
  graphTick = $state(0);

  theme = $state(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  route = $state(parseHash(location.hash));
  drawer = $state(null); // { path, line? }
  palette = $state(false);
  toasts = $state([]);
}

export const app = new AppState();

// ---------------------------------------------------------------- file index
let idxRef = null;
let idx = { set: new Set(), byPath: new Map(), byBase: new Map() };
/** Memoized lookup tables over app.files (reactive: reads app.files). */
export function fileIndex() {
  const files = app.files;
  if (files !== idxRef) {
    idxRef = files;
    const set = new Set();
    const byPath = new Map();
    const byBase = new Map();
    for (const f of files) {
      set.add(f.path);
      byPath.set(f.path, f);
      const b = basename(f.path).replace(/\.[^.]+$/, '').toLowerCase();
      if (!byBase.has(b)) byBase.set(b, f.path);
    }
    idx = { set, byPath, byBase };
  }
  return idx;
}

export function isPulsing(path, ms = 2600) {
  const t = app.pulses[path];
  return !!t && app.now - t < ms;
}

// ---------------------------------------------------------------- routing
export function navigate(view, params = {}) {
  const h = href(view, params);
  if (location.hash === h) app.route = parseHash(h);
  else location.hash = h;
}

export function openFile(path, opts = {}) {
  if (opts.drawer) {
    app.drawer = { path, line: opts.line };
    return;
  }
  app.drawer = null;
  navigate('files', { path, line: opts.line, tab: opts.tab });
}

window.addEventListener('hashchange', () => {
  app.route = parseHash(location.hash);
  app.drawer = null;
});

// ---------------------------------------------------------------- theme
export function setTheme(t) {
  app.theme = t;
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem('mdctl.theme', t);
  } catch {
    /* storage unavailable */
  }
}
export const toggleTheme = () => setTheme(app.theme === 'dark' ? 'light' : 'dark');

// ---------------------------------------------------------------- toasts
let toastId = 0;
export function toast(message, kind = 'info', ms = 4200) {
  const id = ++toastId;
  app.toasts = [...app.toasts, { id, message, kind }];
  setTimeout(() => (app.toasts = app.toasts.filter((t) => t.id !== id)), ms);
}

// ---------------------------------------------------------------- data loading
async function loadState() {
  const s = await api('/api/state');
  app.state = s;
  if (s?.health) app.health = { ...(app.health || {}), ...s.health };
  if (s?.project?.name) document.title = `${s.project.name} · mdctl`;
}

async function loadFiles() {
  const files = await api('/api/files');
  app.files = Array.isArray(files) ? files : [];
}

async function loadEvents(since = 0) {
  const evs = await api('/api/events', { since });
  const list = (Array.isArray(evs) ? evs : []).slice().sort((a, b) => a.id - b.id);
  if (since === 0) {
    app.events = list.reverse().slice(0, 300);
    app.lastEventId = list.length ? Math.max(...list.map((e) => e.id)) : 0;
  } else {
    for (const e of list) applyEvent(e);
  }
}

async function loadConflicts() {
  try {
    const c = await api('/api/conflicts');
    app.conflicts = Array.isArray(c) ? c : [];
  } catch {
    app.conflicts = [];
  }
}

let stateTimer = null;
function refreshStateSoon() {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => loadState().catch(() => {}), 900);
}

function applyEvent(ev) {
  if (!ev || typeof ev !== 'object' || !ev.path) return;
  if (ev.id != null) {
    if (ev.id <= app.lastEventId) return;
    app.lastEventId = ev.id;
  }
  app.events = [ev, ...app.events].slice(0, 300);
  const files = app.files;
  const i = files.findIndex((f) => f.path === ev.path);
  if (ev.type === 'unlink') {
    if (i >= 0) app.files = files.filter((_, k) => k !== i);
  } else if (ev.file) {
    const next = files.slice();
    const merged = { ...(i >= 0 ? files[i] : {}), ...ev.file };
    if (i >= 0) next[i] = merged;
    else next.push(merged);
    app.files = next;
  }
  const ts = Date.now();
  const pulses = {};
  for (const [p, t] of Object.entries(app.pulses)) if (ts - t < 10_000) pulses[p] = t;
  pulses[ev.path] = ts;
  app.pulses = pulses;
  app.dataTick++;
  refreshStateSoon();
}

function onStreamEvent(name, data) {
  app.lastPing = Date.now();
  if (name === 'event') applyEvent(data);
  else if (name === 'health' && data) {
    const prev = app.health?.score;
    app.health = { ...(app.health || {}), ...data };
    if (app.state) app.state = { ...app.state, health: { ...app.state.health, ...data } };
    if (prev != null && data.score != null && data.score < prev - 4) toast(`Health dropped to ${data.score} (${data.grade})`, 'warn');
  } else if (name === 'graph') app.graphTick++;
  else if (name === 'conflict') {
    const list = Array.isArray(data) ? data : data?.conflicts || [];
    const had = new Set(app.conflicts.map((c) => c.path));
    for (const c of list) if (!had.has(c.path)) toast(`Conflict: ${c.agents?.length || 2} agents editing ${c.path}`, 'error', 6000);
    app.conflicts = list;
  }
}

let stream = null;
let wasLive = false;
function startStream() {
  stream?.close();
  stream = connectStream({
    onEvent: onStreamEvent,
    onStatus: (s) => {
      app.conn = s;
      if (s === 'live') {
        app.lastPing = Date.now();
        if (wasLive) {
          // reconnected → backfill anything missed
          loadEvents(app.lastEventId).catch(() => {});
          loadFiles().catch(() => {});
          refreshStateSoon();
          app.dataTick++;
          app.graphTick++;
        }
        wasLive = true;
      }
    },
  });
}

export function reconnect() {
  stream?.reconnect();
}

export async function boot() {
  if (mockRequested) enableMock();
  app.mock = isMock();
  if (app.mock) app.mockReason = 'Demo mode (?mock=1)';
  try {
    await loadState();
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      app.authRequired = true;
      app.ready = true;
      return;
    }
    if (!isMock()) {
      enableMock();
      app.mock = true;
      app.mockReason = `API unreachable (${e.message}) — showing demo data`;
      await loadState();
    } else {
      app.fatal = e.message;
      app.ready = true;
      return;
    }
  }
  await Promise.allSettled([loadFiles(), loadEvents(), loadConflicts()]);
  app.ready = true;
  startStream();
}

setInterval(() => (app.now = Date.now()), 1000);
