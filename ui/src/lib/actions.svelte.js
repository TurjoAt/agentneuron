// Action system state: registry, dialog requests, jobs + live logs.
import { api, post } from './api.js';
import { app, toast, onStream, onBoot } from './store.svelte.js';

const LEVEL_ORDER = ['read', 'state', 'edit', 'exec', 'danger', 'terminal'];

class ActionsState {
  /** registry entries from GET /api/actions */
  list = $state.raw([]);
  loaded = $state(false);
  /** current dialog request { id, def, params, opts, resolve } | null */
  dialog = $state(null);
}
export const actionsState = new ActionsState();

class JobsState {
  /** recent jobs, newest first */
  list = $state.raw([]);
  /** id → [{ts, stream, text}] */
  logs = $state.raw({});
  dock = $state(false); // dock expanded
  dockVisible = $state(false); // dock bar shown at all
  active = $state(null); // selected job id in dock
  get running() {
    return this.list.filter((j) => j.status === 'running' || j.status === 'queued');
  }
}
export const jobs = new JobsState();

const waiters = new Map(); // job id → [resolve]

// ------------------------------------------------------------- permissions
export function canRun(level) {
  if (!level || level === 'read') return true;
  const lv = app.me?.levels;
  if (!lv) return false;
  return !!lv[level];
}

export function levelReason(level) {
  if (canRun(level)) return '';
  if (!app.me) return 'Not signed in';
  if (level === 'state') return 'Requires the admin role (sign in with the admin token)';
  if (app.me.role !== 'admin') return `Requires the admin role — you are signed in as ${app.me.role}`;
  if (level === 'terminal') return 'enable actions.terminal in .agentneuron/config.json (or start with --enable terminal)';
  return `enable actions.${level} in .agentneuron/config.json (or start with --enable ${level})`;
}

export function actionDef(id) {
  return actionsState.list.find((a) => a.id === id) || null;
}

export function actionEnabled(id) {
  const d = actionDef(id);
  if (!d) {
    const lvl = guessLevel(id);
    return { enabled: canRun(lvl), reason: levelReason(lvl), level: lvl, known: false };
  }
  const enabled = d.enabled !== false && canRun(d.level);
  return { enabled, reason: enabled ? '' : d.reason || levelReason(d.level), level: d.level, known: true };
}

function guessLevel(id) {
  if (/discard|delete|drop|purge|migrate|terminal|clear/.test(id)) return 'danger';
  if (/^(packages|scripts|framework)\.|fetch|pull|push|mcp\.test|workspace\.open/.test(id)) return 'exec';
  if (/^agentneuron\.(rescan|snapshot)/.test(id)) return 'state';
  return 'edit';
}

let loading = null;
export function loadActions() {
  loading = api('/api/actions')
    .then((l) => {
      actionsState.list = Array.isArray(l) ? l : [];
      actionsState.loaded = true;
    })
    .catch(() => {
      actionsState.loaded = true;
    });
  return loading;
}

// ------------------------------------------------------------- run
/**
 * @param {string} id
 * @param {Record<string, any>} [params]
 * @param {{title?:string, description?:string, confirm?:boolean, wait?:boolean, silent?:boolean, dock?:boolean}} [opts]
 */
export async function runAction(id, params = {}, opts = {}) {
  if (!actionsState.loaded) await (loading || loadActions());
  const def = actionDef(id) || {
    id,
    title: opts.title || id,
    category: id.split('.')[0],
    level: guessLevel(id),
    description: opts.description || '',
    params: {},
    enabled: true,
  };
  // Always go through the dialog: it shows preview, disabled reason, confirm.
  return new Promise((resolve) => {
    actionsState.dialog = { id, def, params: { ...params }, opts, resolve };
  });
}

/** Called by ActionDialog once the user confirms. */
export async function startJob(id, params, opts = {}) {
  const job = await post('/api/actions/run', { id, params });
  upsertJob(job);
  if (opts.dock !== false) {
    jobs.dockVisible = true;
    jobs.dock = true;
    jobs.active = job.id;
  }
  if (!jobs.logs[job.id]) jobs.logs = { ...jobs.logs, [job.id]: [] };
  if (opts.wait === false || isDone(job)) return job;
  return new Promise((resolve) => {
    const arr = waiters.get(job.id) || [];
    arr.push(resolve);
    waiters.set(job.id, arr);
  });
}

export const isDone = (j) => j && (j.status === 'ok' || j.status === 'error' || j.status === 'cancelled');

export function upsertJob(job) {
  if (!job?.id) return;
  const i = jobs.list.findIndex((j) => j.id === job.id);
  const prev = i >= 0 ? jobs.list[i] : null;
  const merged = { ...(prev || {}), ...job };
  const next = jobs.list.slice();
  if (i >= 0) next[i] = merged;
  else next.unshift(merged);
  jobs.list = next.slice(0, 100);
  if (isDone(merged) && !isDone(prev)) {
    const w = waiters.get(job.id);
    if (w) {
      waiters.delete(job.id);
      for (const r of w) r(merged);
    }
    app.dataTick++;
  }
}

export function appendLog({ id, stream, text, ts }) {
  if (!id) return;
  const cur = jobs.logs[id] || [];
  const next = cur.length > 4000 ? cur.slice(-3000) : cur.slice();
  next.push({ ts: ts || Date.now(), stream: stream || 'stdout', text: String(text ?? '') });
  jobs.logs = { ...jobs.logs, [id]: next };
}

export async function openJob(id) {
  jobs.dockVisible = true;
  jobs.dock = true;
  jobs.active = id;
  try {
    const full = await api('/api/job', { id });
    upsertJob(full);
    if (Array.isArray(full.log) && full.log.length >= (jobs.logs[id]?.length || 0)) {
      jobs.logs = { ...jobs.logs, [id]: full.log };
    }
  } catch {
    /* keep what we have */
  }
}

export async function cancelJob(id) {
  try {
    await post('/api/jobs/cancel', { id });
    toast('Cancel requested', 'info');
  } catch (e) {
    toast(e.message, 'error');
  }
}

export async function loadJobs() {
  try {
    const l = await api('/api/jobs');
    if (Array.isArray(l)) {
      const known = new Map(jobs.list.map((j) => [j.id, j]));
      for (const j of l) known.set(j.id, { ...(known.get(j.id) || {}), ...j });
      jobs.list = [...known.values()].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, 100);
      if (jobs.list.length) jobs.dockVisible = true;
    }
  } catch {
    /* endpoint may be missing */
  }
}

export function levelRank(level) {
  return LEVEL_ORDER.indexOf(level);
}

// wire live updates
onStream('job', (j) => upsertJob(j));
onStream('joblog', (l) => appendLog(l));
onBoot(() => {
  loadActions();
  loadJobs();
});
