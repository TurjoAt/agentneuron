// Connectivity test for an MCP server definition: initialize + tools/list, 15 s hard timeout.
// Never uses a shell; the child is always killed; env/header values are never returned.
import { spawn } from 'node:child_process';
import { maskSecretsInText } from '../health/secrets.js';

export const TEST_TIMEOUT_MS = 15000;
const PROTOCOL = '2025-06-18';

const expand = (v) => String(v).replace(/\$\{([A-Za-z_][\w]*)(?::-([^}]*))?\}/g, (_, n, d) => process.env[n] ?? d ?? '');
const mask = (s) => maskSecretsInText(String(s ?? '')).slice(0, 400);
const MAX_OUT = 1024 * 1024; // cap on buffered server output / HTTP bodies
const MAX_TOOLS = 200;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Reduce an untrusted `serverInfo` / tools/list payload to short, masked plain strings. */
function cleanInfo(info) {
  if (!isObj(info)) return null;
  const out = {};
  if (typeof info.name === 'string') out.name = mask(info.name).slice(0, 100);
  if (typeof info.version === 'string') out.version = mask(info.version).slice(0, 50);
  return out;
}
function cleanTools(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_TOOLS).filter(isObj).map((t) => ({ name: mask(typeof t.name === 'string' ? t.name : '').slice(0, 100), description: mask(typeof t.description === 'string' ? t.description : '').slice(0, 200) }));
}
/** Never echo a spawn error verbatim: it contains the command line (args may hold secrets). */
function spawnError(e) {
  return e?.code === 'ENOENT' ? 'command not found' : e?.code === 'EACCES' ? 'command is not executable' : 'failed to start process';
}

function finish(base, extra) { return { ...base, ms: Date.now() - base.t0, t0: undefined, ...extra }; }

function testStdio(def, { cwd, signal, timeoutMs }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const base = { transport: 'stdio', t0 };
    if (typeof def.command !== 'string' || !def.command || def.command.includes('\0')) return resolve(finish(base, { ok: false, error: 'missing command' }));
    const args = (Array.isArray(def.args) ? def.args : []).filter((a) => typeof a === 'string').map(expand);
    if (args.some((a) => a.includes('\0'))) return resolve(finish(base, { ok: false, error: 'invalid argument' }));
    const env = { ...process.env };
    // the dashboard's own credentials must not leak into spawned servers
    for (const k of Object.keys(env)) if (/^AGENTNEURON_/i.test(k)) delete env[k];
    if (def.env && typeof def.env === 'object') for (const [k, v] of Object.entries(def.env)) if (typeof v === 'string') env[k] = expand(v);
    let child;
    let done = false;
    let buf = '';
    let errTail = '';
    let serverInfo = null;
    const timer = setTimeout(() => end({ ok: false, error: `timeout after ${timeoutMs} ms` }), timeoutMs);
    const end = (res) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      try { child?.stdin?.end(); } catch { /* closed */ }
      killTree('SIGTERM');
      const k = setTimeout(() => killTree('SIGKILL'), 1000);
      k.unref?.();
      resolve(finish(base, res.ok ? res : { ...res, stderr: errTail ? mask(errTail) : undefined }));
    };
    // POSIX: the child leads its own process group so wrappers like `npx` do not leave grandchildren behind
    const killTree = (sig) => {
      try { if (process.platform !== 'win32' && child?.pid) process.kill(-child.pid, sig); else child?.kill(sig); } catch { try { child?.kill(sig); } catch { /* gone */ } }
    };
    const onAbort = () => end({ ok: false, error: 'cancelled' });
    signal?.addEventListener?.('abort', onAbort, { once: true });
    try {
      child = spawn(def.command, args, { cwd, env, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) { return end({ ok: false, error: spawnError(e) }); }
    child.on('error', (e) => end({ ok: false, error: spawnError(e) }));
    child.on('exit', (code) => end({ ok: false, error: `process exited early (code ${code})` }));
    child.stderr.on('data', (d) => { errTail = (errTail + d).slice(-600); });
    child.stdout.on('error', () => {});
    child.stderr.on('error', () => {});
    const send = (m) => { try { child.stdin.write(`${JSON.stringify(m)}\n`); } catch { /* closed */ } };
    child.stdin.on('error', () => {});
    child.stdout.on('data', (d) => {
      buf += d;
      if (buf.length > MAX_OUT) return end({ ok: false, error: 'server output too large' });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        if (!isObj(m)) continue;
        if (m.id === 1 && isObj(m.result)) {
          serverInfo = cleanInfo(m.result.serverInfo);
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        } else if (m.id === 1 && m.error) {
          end({ ok: false, error: mask(m.error?.message || 'initialize failed') });
        } else if (m.id === 2) {
          end(m.error ? { ok: false, error: mask(m.error?.message || 'tools/list failed'), serverInfo } : { ok: true, serverInfo, tools: cleanTools(m.result?.tools) });
        }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'agentneuron', version: '0.2.1' } } });
  });
}

function parseBody(text, ct) {
  if (/event-stream/.test(ct || '')) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (data) { try { return JSON.parse(data); } catch { /* next */ } }
    }
    return null;
  }
  try { return JSON.parse(text); } catch { return null; }
}

async function testHttp(def, { signal, timeoutMs }) {
  const t0 = Date.now();
  const base = { transport: 'http', t0 };
  let url;
  // no ${VAR} expansion in the URL itself: a config must not be able to send environment secrets to a host it names
  try { url = new URL(String(def.url || def.serverUrl || '')); } catch { return finish(base, { ok: false, error: 'invalid url' }); }
  if (!/^https?:$/.test(url.protocol)) return finish(base, { ok: false, error: 'url must be http(s)' });
  if (url.username || url.password) return finish(base, { ok: false, error: 'credentials in the url are not supported; use headers' });
  if (/^(169\.254\.|\[?fe80:|metadata\.google\.internal$|\[?fd00:ec2::254)/i.test(url.hostname)) return finish(base, { ok: false, error: 'link-local / metadata addresses are not allowed' });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const onAbort = () => ac.abort();
  signal?.addEventListener?.('abort', onAbort, { once: true });
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (def.headers && typeof def.headers === 'object') for (const [k, v] of Object.entries(def.headers)) if (typeof v === 'string') headers[k] = expand(v);
  const post = async (body) => {
    // redirects are not followed: they could bounce the request (and its headers) to an arbitrary host
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal, redirect: 'manual' });
    const sid = r.headers.get('mcp-session-id');
    if (sid && sid.length < 200) headers['mcp-session-id'] = sid;
    let text = '';
    const reader = r.body?.getReader?.();
    if (reader) {
      const dec = new TextDecoder();
      let n = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        n += value.length;
        if (n > MAX_OUT) { try { await reader.cancel(); } catch { /* ignore */ } throw new Error('response too large'); }
        text += dec.decode(value, { stream: true });
      }
    }
    return { status: r.status, json: parseBody(text, r.headers.get('content-type')) };
  };
  try {
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'agentneuron', version: '0.2.1' } } });
    if (!isObj(init.json?.result)) return finish(base, { ok: false, error: mask(init.json?.error?.message || `HTTP ${init.status}`) });
    headers['mcp-protocol-version'] = typeof init.json.result.protocolVersion === 'string' && /^[\w.-]{1,20}$/.test(init.json.result.protocolVersion) ? init.json.result.protocolVersion : PROTOCOL;
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => {});
    const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const serverInfo = cleanInfo(init.json.result.serverInfo);
    if (!isObj(list.json?.result)) return finish(base, { ok: false, serverInfo, error: mask(list.json?.error?.message || `HTTP ${list.status}`) });
    return finish(base, { ok: true, serverInfo, tools: cleanTools(list.json.result.tools) });
  } catch (e) {
    return finish(base, { ok: false, error: ac.signal.aborted ? 'timeout or cancelled' : e?.message === 'response too large' ? 'response too large' : 'request failed' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

export async function testMcpServer(def, { cwd, signal, timeoutMs = TEST_TIMEOUT_MS } = {}) {
  if (!def || typeof def !== 'object') return { ok: false, error: 'invalid server definition' };
  if (def.url || def.serverUrl) return testHttp(def, { signal, timeoutMs });
  return testStdio(def, { cwd, signal, timeoutMs });
}
