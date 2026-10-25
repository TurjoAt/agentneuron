// Actions registry + job runner. See docs/internal/CONTRACT-v0.2.md.
import { spawn } from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';
import { HttpError } from '../server/router.js';
import fs from 'node:fs';
import { maskSecretsInText } from '../health/secrets.js';
import { maskDeep } from '../server/mask.js';

const PARAM_TYPES = new Set(['string', 'number', 'boolean', 'enum', 'path', 'text', 'string[]']);
const LEVELS = new Set(['read', 'state', 'edit', 'exec', 'danger']);
const MAX_CONCURRENT = 3;
const LOG_CAP = 2 * 1024 * 1024;
const KEEP_JOBS = 100;
const CAPTURE_CAP = 5 * 1024 * 1024;

/** Project-relative POSIX path check; returns normalized path or null. */
export function safeRelPath(p) {
  if (typeof p !== 'string' || !p || p.includes('\0')) return null;
  p = p.replace(/\\/g, '/');
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.split('/').includes('..')) return null;
  return p.replace(/^\.\//, '') || '.';
}

export function howToEnable(level) {
  if (level === 'state') return 'requires the admin role (log in with the admin token)';
  return `enable actions.${level} in .agentneuron/config.json (or start agentneuron with --enable ${level})`;
}

function validateDef(def) {
  if (!def || typeof def !== 'object') throw new Error('action definition required');
  if (!/^[a-z][\w-]*(\.[\w-]+)+$|^[a-z][\w-]*$/i.test(def.id || '')) throw new Error(`bad action id: ${def.id}`);
  if (typeof def.run !== 'function') throw new Error(`${def.id}: run() required`);
  if (!LEVELS.has(def.level) || def.level === 'read') throw new Error(`${def.id}: level must be state|edit|exec|danger`);
  if (!def.title) throw new Error(`${def.id}: title required`);
  for (const [k, p] of Object.entries(def.params || {})) {
    if (!PARAM_TYPES.has(p.type)) throw new Error(`${def.id}.${k}: bad param type ${p.type}`);
    if (p.type === 'enum' && !Array.isArray(p.enum)) throw new Error(`${def.id}.${k}: enum values required`);
    if (p.pattern) new RegExp(p.pattern);
  }
}

/** Validate + coerce params against a schema. Throws HttpError(400). Unknown keys are dropped. */
export function validateParams(schema = {}, input = {}) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'params must be an object');
  const out = {};
  for (const [k, p] of Object.entries(schema)) {
    let v = input[k];
    if (v === undefined || v === null || v === '') {
      if (p.default !== undefined) { out[k] = p.default; continue; }
      if (p.required) throw new HttpError(400, `param "${k}" is required`);
      continue;
    }
    const bad = (m) => new HttpError(400, `param "${k}": ${m}`);
    switch (p.type) {
      case 'string': case 'text': {
        if (typeof v !== 'string') throw bad('must be a string');
        if (v.includes('\0')) throw bad('contains NUL');
        if (v.length > (p.maxLength || (p.type === 'text' ? 1e6 : 4096))) throw bad('too long');
        if (p.pattern && !new RegExp(p.pattern).test(v)) throw bad('invalid format');
        break;
      }
      case 'number': {
        v = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
        if (typeof v !== 'number' || !Number.isFinite(v)) throw bad('must be a number');
        if (p.min !== undefined && v < p.min) throw bad(`must be >= ${p.min}`);
        if (p.max !== undefined && v > p.max) throw bad(`must be <= ${p.max}`);
        break;
      }
      case 'boolean': {
        if (v === 'true') v = true; else if (v === 'false') v = false;
        if (typeof v !== 'boolean') throw bad('must be a boolean');
        break;
      }
      case 'enum': if (!p.enum.includes(v)) throw bad(`must be one of ${p.enum.join(', ')}`); break;
      case 'path': {
        const s = safeRelPath(v); if (s == null) throw bad('must be a project-relative path');
        v = s; break;
      }
      case 'string[]': {
        if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || x.includes('\0'))) throw bad('must be an array of strings');
        if (v.length > 1000) throw bad('too many items');
        if (p.pattern) { const re = new RegExp(p.pattern); if (!v.every((x) => re.test(x))) throw bad('invalid item format'); }
        break;
      }
    }
    out[k] = v;
  }
  return out;
}

const publicParams = (schema) => Object.fromEntries(Object.entries(schema || {}).map(([k, p]) => {
  const { ...rest } = p; return [k, rest];
}));

function defineHidden(o, props) {
  for (const [k, v] of Object.entries(props)) Object.defineProperty(o, k, { value: v, enumerable: false, writable: true, configurable: true });
}

export function createRegistry(ctx) {
  const defs = new Map();
  const jobs = new Map(); // id -> job
  const queue = [];
  let running = 0;
  const runningCats = new Set();

  const audit = (e) => { try { ctx.persist?.audit?.log(e); } catch { /* ignore */ } };
  const emitJob = (job) => { try { ctx.broadcast('job', summary(job)); } catch { /* ignore */ } };

  function summary(job) {
    const { id, actionId, title, params, level, status, startedAt, endedAt, exitCode, result, error, command, queuedAt, by } = job;
    return { id, actionId, title, params: maskedParams(job), level, status, queuedAt, startedAt, endedAt, exitCode, result: maskDeep(result), error: maskDeep(error), command: maskDeep(command), by };
  }
  function maskedParams(job) {
    try { return JSON.parse(maskSecretsInText(JSON.stringify(job.params))); } catch { return {}; }
  }

  function availableReason(def, role) {
    if (!ctx.can(def.level, role)) {
      return { enabled: false, reason: howToEnable(def.level) };
    }
    if (def.flag && !(ctx.config.actions && ctx.config.actions[def.flag])) {
      return { enabled: false, reason: howToEnable(def.flag) };
    }
    return { enabled: true };
  }

  const registry = {
    register(def) {
      validateDef(def);
      if (defs.has(def.id)) throw new Error(`action already registered: ${def.id}`);
      defs.set(def.id, def);
      return registry;
    },
    get: (id) => defs.get(id) || null,
    ids: () => [...defs.keys()],

    /** async: `available()` hooks may be async. */
    async list(role = 'admin') {
      const out = [];
      await Promise.all([...defs.values()].map(async (def) => {
        if (def.available) {
          let ok = true;
          let t;
          try { ok = await Promise.race([Promise.resolve(def.available(ctx)), new Promise((r) => { t = setTimeout(() => r(false), 3000); })]); } catch { ok = false; } finally { clearTimeout(t); }
          if (!ok) return;
        }
        out.push({
          id: def.id, title: def.title, category: def.category, level: def.level, description: def.description || '',
          params: publicParams(def.params), ...availableReason(def, role),
        });
      }));
      return out.sort((a, b) => a.id.localeCompare(b.id));
    },

    async preview(id, params = {}) {
      const def = defs.get(id);
      if (!def) throw new HttpError(404, `unknown action: ${id}`);
      const clean = validateParams(def.params, params);
      if (!def.preview) return { command: null, summary: def.description || def.title, params: clean };
      let p;
      try { p = await def.preview(clean, ctx); } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(Number.isInteger(e?.status) && e.status >= 400 && e.status < 500 ? e.status : 400, String(e?.message || e));
      }
      return { ...p, params: clean };
    },

    async run(id, params = {}, { role = 'admin', by = null } = {}) {
      const def = defs.get(id);
      if (!def) throw new HttpError(404, `unknown action: ${id}`);
      const gate = availableReason(def, role);
      if (!gate.enabled) {
        audit({ role, by, action: id, params, status: 403 });
        throw new HttpError(403, `action "${id}" (level ${def.level}) is disabled: ${gate.reason}`);
      }
      if (def.available) {
        let ok = false; try { ok = await def.available(ctx); } catch { /* unavailable */ }
        if (!ok) throw new HttpError(409, `action "${id}" is not available in this project`);
      }
      const clean = validateParams(def.params, params);
      const job = makeJob(def, clean, by, role);
      jobs.set(job.id, job);
      trimJobs();
      audit({ role, by, action: id, params: clean, status: 'started', jobId: job.id });
      queue.push(job);
      emitJob(job);
      pump();
      return job;
    },

    getJob: (id) => jobs.get(id) || null,
    listJobs: () => [...jobs.values()].reverse().slice(0, KEEP_JOBS),
    summary,
    cancel(id) {
      const job = jobs.get(id);
      if (!job) return false;
      if (job.status === 'queued') {
        const i = queue.indexOf(job); if (i >= 0) queue.splice(i, 1);
        finish(job, 'cancelled', null, 'cancelled'); return true;
      }
      if (job.status === 'running') { job.controller.abort(); return true; }
      return false;
    },
    cancelAll() { for (const j of [...jobs.values()]) if (j.status === 'queued' || j.status === 'running') registry.cancel(j.id); },
  };

  function trimJobs() {
    if (jobs.size <= KEEP_JOBS * 2) return;
    for (const [id, j] of jobs) {
      if (jobs.size <= KEEP_JOBS) break;
      if (j.status !== 'queued' && j.status !== 'running') jobs.delete(id);
    }
  }

  function makeJob(def, params, by, role) {
    const controller = new AbortController();
    const job = {
      id: crypto.randomBytes(8).toString('hex'), actionId: def.id, title: def.title, params, level: def.level,
      status: 'queued', queuedAt: Date.now(), startedAt: null, endedAt: null, exitCode: null, result: null, error: null,
      command: null, by,
    };
    let logSize = 0;
    const logBuf = [];
    let resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    defineHidden(job, {
      def, role, controller, signal: controller.signal, logBuf, done, resolveDone,
      category: def.category || 'misc',
      log(stream, text) {
        text = maskSecretsInText(String(text ?? ''));
        if (!text) return;
        const s = ['stdout', 'stderr', 'info'].includes(stream) ? stream : 'info';
        const chunk = { ts: Date.now(), stream: s, text };
        logBuf.push(chunk); logSize += text.length;
        while (logSize > LOG_CAP && logBuf.length > 1) logSize -= logBuf.shift().text.length;
        try { ctx.broadcast('joblog', { id: job.id, stream: s, text }); } catch { /* ignore */ }
      },
      exec(cmd, args = [], opts = {}) { return execJob(job, cmd, args, opts); },
    });
    return job;
  }

  function execJob(job, cmd, args, { cwd = '.', env, timeoutMs = 600000 } = {}) {
    return new Promise((resolve, reject) => {
      if (typeof cmd !== 'string' || !cmd || cmd.includes('\0')) return reject(new Error('bad command'));
      if (!Array.isArray(args) || args.some((a) => typeof a !== 'string' || a.includes('\0'))) return reject(new Error('args must be strings'));
      const rel = safeRelPath(cwd);
      if (rel == null) return reject(new Error('cwd must be project-relative'));
      let abs = path.resolve(ctx.root, rel);
      if (abs !== path.resolve(ctx.root) && !abs.startsWith(path.resolve(ctx.root) + path.sep)) return reject(new Error('cwd escapes project root'));
      try { // a symlinked directory must not lead out of the project
        const realRoot = fs.realpathSync(ctx.root); abs = fs.realpathSync(abs);
        if (abs !== realRoot && !abs.startsWith(realRoot + path.sep)) return reject(new Error('cwd escapes project root'));
      } catch { return reject(new Error('cwd does not exist')); }
      if (job.signal.aborted) return resolve({ code: null, stdout: '', stderr: '' });
      job.command = [cmd, ...args];
      job.log('info', `$ ${[cmd, ...args].join(' ')}`);
      let child;
      try {
        child = spawn(cmd, args, { cwd: abs, env: { ...process.env, ...(env || {}) }, shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      } catch (e) { return reject(e); }
      let stdout = '', stderr = '';
      const cap = (s, d) => (s.length < CAPTURE_CAP ? s + d : s);
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8'); // multi-byte chars split across chunks stay intact
      child.stdout.on('data', (d) => { const t = String(d); stdout = cap(stdout, t); job.log('stdout', t); });
      child.stderr.on('data', (d) => { const t = String(d); stderr = cap(stderr, t); job.log('stderr', t); });
      let killTimer = null;
      const kill = (why) => {
        if (why) job.log('info', why);
        try { child.kill('SIGTERM'); } catch { /* gone */ }
        killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 3000);
        killTimer.unref?.();
      };
      const onAbort = () => kill('cancelled');
      job.signal.addEventListener('abort', onAbort, { once: true });
      const to = setTimeout(() => kill(`timeout after ${timeoutMs} ms`), timeoutMs);
      to.unref?.();
      const end = () => { clearTimeout(to); clearTimeout(killTimer); job.signal.removeEventListener('abort', onAbort); };
      child.on('error', (e) => { end(); reject(e); });
      child.on('close', (code, signal) => {
        end();
        if (code == null) job.log('info', `terminated by ${signal}`);
        job.exitCode = code;
        resolve({ code, stdout, stderr });
      });
    });
  }

  function finish(job, status, result, error) {
    job.status = status; job.endedAt = Date.now();
    if (status === 'ok') job.result = result ?? null;
    if (error) job.error = maskSecretsInText(String(error));
    audit({ role: job.role, by: job.by, action: job.actionId, params: job.params, status, jobId: job.id, exitCode: job.exitCode, error: job.error });
    emitJob(job);
    if (status === 'ok') ctx.notify?.('job-done', { title: `${job.title} finished`, body: job.actionId });
    else if (status === 'error') ctx.notify?.('job-failed', { title: `${job.title} failed`, body: maskSecretsInText(job.error || ''), level: 'error' });
    job.resolveDone(job);
  }

  async function start(job) {
    running++; runningCats.add(job.category);
    job.status = 'running'; job.startedAt = Date.now();
    emitJob(job);
    try {
      if (job.signal.aborted) throw Object.assign(new Error('cancelled'), { cancelled: true });
      const result = await job.def.run(job.params, ctx, job);
      if (job.signal.aborted) finish(job, 'cancelled', null, 'cancelled');
      else finish(job, 'ok', result);
    } catch (e) {
      if (job.signal.aborted || e?.cancelled) finish(job, 'cancelled', null, 'cancelled');
      else finish(job, 'error', null, e?.message || e);
    } finally {
      running--; runningCats.delete(job.category);
      pump();
    }
  }

  function pump() {
    for (let i = 0; i < queue.length && running < MAX_CONCURRENT;) {
      const job = queue[i];
      if (runningCats.has(job.category)) { i++; continue; }
      queue.splice(i, 1);
      start(job);
    }
  }

  return registry;
}
