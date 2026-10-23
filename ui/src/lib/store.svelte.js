// Global reactive app state (Svelte 5 runes) + boot, live stream, routing,
// theme and toasts.

import { api, post, connectStream, enableMock, isMock, mockRequested, urlToken, setToken, stripUrlToken } from './api.js';
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

  /** { role, levels: {read,state,edit,exec,danger,terminal}, tokenRequired } */
  me = $state.raw(null);
  loginError = $state('');
  /** notifications from SSE `notify` (newest first) */
  notifications = $state.raw([]);
  unread = $state(0);
  /** bumped on SSE `board` */
  boardTick = $state(0);
  /** bumped when annotations change (SSE files {changed:'annotations'}) */
  annotTick = $state(0);
  /** global find & replace panel / sidebar sections */
  sideRecentOpen = $state(loadLocal('agentneuron.side.recent', true));
  sidePinnedOpen = $state(loadLocal('agentneuron.side.pinned', true));
  /** pinned files (bookmarks) [{ path, label? }] */
  bookmarks = $state.raw([]);
  /** recently opened files (newest first) */
  recent = $state.raw(loadLocal('agentneuron.recent', []));
  /** in-app navigation stack (hashes) for back/forward */
  navStack = $state.raw([location.hash || '#/overview']);
  navPos = $state(0);
  /** global modal: { kind, props } rendered by App (file dialogs etc.) */
  modal = $state.raw(null);
  /** dirty editors: path → true (warn before leaving) */
  dirty = $state.raw({});
}

function loadLocal(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
export function saveLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
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

let navIntent = 0; // -1 back, +1 forward, 0 new
window.addEventListener('hashchange', () => {
  app.route = parseHash(location.hash);
  app.drawer = null;
  const h = location.hash || '#/overview';
  if (navIntent) {
    app.navPos = Math.max(0, Math.min(app.navStack.length - 1, app.navPos + navIntent));
    navIntent = 0;
  } else if (app.navStack[app.navPos] !== h) {
    // detect browser back/forward to an adjacent entry
    if (app.navStack[app.navPos - 1] === h) app.navPos--;
    else if (app.navStack[app.navPos + 1] === h) app.navPos++;
    else {
      app.navStack = [...app.navStack.slice(0, app.navPos + 1), h].slice(-100);
      app.navPos = app.navStack.length - 1;
    }
  }
  trackRecent();
});

export const canBack = () => app.navPos > 0;
export const canForward = () => app.navPos < app.navStack.length - 1;
export function goBack() {
  if (!canBack()) return;
  navIntent = -1;
  history.back();
}
export function goForward() {
  if (!canForward()) return;
  navIntent = 1;
  history.forward();
}

function trackRecent() {
  const r = app.route;
  if (r.view !== 'files' || !r.params.path) return;
  const p = r.params.path;
  app.recent = [p, ...app.recent.filter((x) => x !== p)].slice(0, 15);
  saveLocal('agentneuron.recent', app.recent);
}
trackRecent();

// ---------------------------------------------------------------- bookmarks (pinned)
export const isBookmarked = (path) => app.bookmarks.some((b) => b.path === path);
let bookmarksLocal = false;
export async function loadBookmarks() {
  try {
    const b = await api('/api/bookmarks');
    app.bookmarks = Array.isArray(b) ? b : b?.bookmarks || [];
    bookmarksLocal = false;
  } catch {
    bookmarksLocal = true;
    app.bookmarks = loadLocal('agentneuron.bookmarks', []);
  }
}
export async function toggleBookmark(path, label) {
  const on = isBookmarked(path);
  const canState = !!app.me?.levels?.state;
  if (bookmarksLocal || !canState) {
    app.bookmarks = on ? app.bookmarks.filter((b) => b.path !== path) : [...app.bookmarks, { path, label, local: true }];
    saveLocal('agentneuron.bookmarks', app.bookmarks.filter((b) => b.local));
    toast(on ? 'Unpinned' : 'Pinned (this browser only — sign in as admin to share pins)', 'info');
    return;
  }
  try {
    if (on) await post('/api/bookmarks/remove', { path });
    else await post('/api/bookmarks', { path, label });
    await loadBookmarks();
    toast(on ? 'Unpinned' : 'Pinned to sidebar', 'ok', 2200);
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ---------------------------------------------------------------- notifications
export function pushNotification(n) {
  const item = { id: Math.random().toString(36).slice(2), ts: Date.now(), level: 'info', ...n };
  app.notifications = [item, ...app.notifications].slice(0, 60);
  app.unread++;
  const kind = item.level === 'error' ? 'error' : item.level === 'warn' ? 'warn' : item.level === 'ok' || item.level === 'success' ? 'ok' : 'info';
  toast(item.title + (item.body ? ` — ${item.body}` : ''), kind, kind === 'error' ? 7000 : 4500);
  try {
    const want = loadLocal('agentneuron.browserNotify', false);
    if (want && typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      new Notification(item.title, { body: item.body || '', tag: item.type || 'agentneuron' });
    }
  } catch {
    /* notifications unavailable */
  }
}

// ---------------------------------------------------------------- stream hooks
const streamHooks = new Map();
/** Subscribe to a named SSE event (job, joblog, board, files, notify…). Returns unsubscribe. */
export function onStream(name, fn) {
  if (!streamHooks.has(name)) streamHooks.set(name, new Set());
  streamHooks.get(name).add(fn);
  return () => streamHooks.get(name)?.delete(fn);
}

// ---------------------------------------------------------------- theme
export function setTheme(t) {
  app.theme = t;
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem('agentneuron.theme', t);
  } catch {
    /* storage unavailable */
  }
}
export const toggleTheme = () => setTheme(app.theme === 'dark' ? 'light' : 'dark');

// ---------------------------------------------------------------- toasts
let toastId = 0;
/**
 * @param {string} message
 * @param {'info'|'ok'|'warn'|'error'} [kind]
 * @param {number} [ms]
 * @param {{ label: string, run: () => void }} [action] optional inline button (e.g. Undo)
 */
export function toast(message, kind = 'info', ms = 4200, action = null) {
  const id = ++toastId;
  app.toasts = [...app.toasts, { id, message, kind, action }].slice(-5);
  setTimeout(() => dismissToast(id), ms);
  return id;
}
export function dismissToast(id) {
  app.toasts = app.toasts.filter((t) => t.id !== id);
}

// ---------------------------------------------------------------- data loading
export async function loadState() {
  const s = await api('/api/state');
  app.state = s;
  if (s?.health) app.health = { ...(app.health || {}), ...s.health };
  if (s?.project?.name) document.title = `${s.project.name} · AgentNeuron`;
}

export async function loadFiles() {
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
  const hooks = streamHooks.get(name);
  if (hooks) for (const fn of hooks) {
    try {
      fn(data);
    } catch (e) {
      console.warn('stream hook', name, e);
    }
  }
  if (name === 'notify' && data) pushNotification(data);
  else if (name === 'board') app.boardTick++;
  else if (name === 'files') {
    const what = data?.changed;
    if (what === 'bookmarks') loadBookmarks();
    else if (what === 'annotations') app.annotTick++;
    else {
      loadFiles().catch(() => {});
      app.dataTick++;
      app.graphTick++;
    }
  }
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

/** GET /api/auth/me; tolerate older servers without the route. */
async function loadMe() {
  try {
    const me = await api('/api/auth/me');
    if (me && !me.role && me.tokenRequired) throw Object.assign(new Error('unauthorized'), { status: 401 });
    app.me = me;
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw e;
    // v0.1 server: no auth routes → derive from /api/state
    const w = app.state?.allowWrite;
    app.me = { role: 'admin', legacy: true, tokenRequired: false, levels: { read: true, state: true, edit: !!w, exec: false, danger: false, terminal: false } };
  }
}

/** POST /api/auth/login → cookie session, then (re)boot. */
export async function login(tok) {
  app.loginError = '';
  try {
    await post('/api/auth/login', { token: tok });
    setToken('');
    stripUrlToken();
    app.authRequired = false;
    app.ready = false;
    await boot(true);
    return true;
  } catch (e) {
    app.loginError = e.status === 401 || e.status === 403 ? 'That token was not accepted.' : e.message;
    return false;
  }
}

export async function logout() {
  try {
    await post('/api/auth/logout', {});
  } catch {
    /* ignore */
  }
  stream?.close();
  app.me = null;
  app.authRequired = true;
}

export async function refreshMe() {
  try {
    await loadMe();
  } catch {
    /* ignore */
  }
}

export async function boot(again = false) {
  if (mockRequested) enableMock();
  app.mock = isMock();
  if (app.mock) app.mockReason = 'Demo mode (?mock=1)';
  // a ?token= in the URL → exchange for a cookie session and strip it
  if (!again && urlToken && !app.mock) {
    try {
      await post('/api/auth/login', { token: urlToken });
      setToken('');
    } catch {
      /* old server or bad token: keep forwarding the token from memory only (v0.1 behaviour) */
    }
    // the secret never stays in the address bar / history / copied links
    stripUrlToken();
  }
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
  try {
    await loadMe();
  } catch (e) {
    app.authRequired = true;
    app.ready = true;
    return;
  }
  await Promise.allSettled([loadFiles(), loadEvents(), loadConflicts(), loadBookmarks()]);
  app.ready = true;
  startStream();
  for (const fn of bootHooks) fn();
}

const bootHooks = new Set();
/** Run after a successful boot (used by actions/jobs). */
export function onBoot(fn) {
  bootHooks.add(fn);
}

setInterval(() => (app.now = Date.now()), 1000);
