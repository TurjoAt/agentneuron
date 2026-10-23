// Connectivity test for an MCP server definition: initialize + tools/list, 15 s hard timeout.
// Never uses a shell; the child is always killed; env/header values are never returned.
import { spawn } from 'node:child_process';
import { maskSecretsInText } from '../health/secrets.js';

export const TEST_TIMEOUT_MS = 15000;
const PROTOCOL = '2025-06-18';

const expand = (v) => String(v).replace(/\$\{([A-Za-z_][\w]*)(?::-([^}]*))?\}/g, (_, n, d) => process.env[n] ?? d ?? '');
const mask = (s) => maskSecretsInText(String(s ?? '')).slice(0, 400);

function finish(base, extra) { return { ...base, ms: Date.now() - base.t0, t0: undefined, ...extra }; }

function testStdio(def, { cwd, signal, timeoutMs }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const base = { transport: 'stdio', t0 };
    if (typeof def.command !== 'string' || !def.command || def.command.includes('\0')) return resolve(finish(base, { ok: false, error: 'missing command' }));
    const args = (Array.isArray(def.args) ? def.args : []).filter((a) => typeof a === 'string').map(expand);
    const env = { ...process.env };
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
      try { child?.kill('SIGTERM'); } catch { /* gone */ }
      const k = setTimeout(() => { try { child?.kill('SIGKILL'); } catch { /* gone */ } }, 1000);
      k.unref?.();
      resolve(finish(base, res.ok ? res : { ...res, stderr: errTail ? mask(errTail) : undefined }));
    };
    const onAbort = () => end({ ok: false, error: 'cancelled' });
    signal?.addEventListener?.('abort', onAbort, { once: true });
    try {
      child = spawn(def.command, args, { cwd, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) { return end({ ok: false, error: mask(e.message) }); }
    child.on('error', (e) => end({ ok: false, error: mask(e.message) }));
    child.on('exit', (code) => end({ ok: false, error: `process exited early (code ${code})` }));
    child.stderr.on('data', (d) => { errTail = (errTail + d).slice(-600); });
    const send = (m) => { try { child.stdin.write(`${JSON.stringify(m)}\n`); } catch { /* closed */ } };
    child.stdin.on('error', () => {});
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1 && m.result) {
          serverInfo = m.result.serverInfo || null;
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        } else if (m.id === 1 && m.error) {
          end({ ok: false, error: mask(m.error.message || 'initialize failed') });
        } else if (m.id === 2) {
          const tools = (m.result?.tools || []).map((t) => ({ name: String(t.name), description: mask(t.description || '').slice(0, 200) }));
          end(m.error ? { ok: false, error: mask(m.error.message), serverInfo } : { ok: true, serverInfo, tools });
        }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'mdctl', version: '0.2.0' } } });
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
  try { url = new URL(expand(def.url || def.serverUrl || '')); } catch { return finish(base, { ok: false, error: 'invalid url' }); }
  if (!/^https?:$/.test(url.protocol)) return finish(base, { ok: false, error: 'url must be http(s)' });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const onAbort = () => ac.abort();
  signal?.addEventListener?.('abort', onAbort, { once: true });
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (def.headers && typeof def.headers === 'object') for (const [k, v] of Object.entries(def.headers)) if (typeof v === 'string') headers[k] = expand(v);
  const post = async (body) => {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal });
    const sid = r.headers.get('mcp-session-id');
    if (sid) headers['mcp-session-id'] = sid;
    const text = await r.text();
    return { status: r.status, json: parseBody(text, r.headers.get('content-type')) };
  };
  try {
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'mdctl', version: '0.2.0' } } });
    if (!init.json?.result) return finish(base, { ok: false, error: mask(init.json?.error?.message || `HTTP ${init.status}`) });
    headers['mcp-protocol-version'] = init.json.result.protocolVersion || PROTOCOL;
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => {});
    const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const tools = (list.json?.result?.tools || []).map((t) => ({ name: String(t.name), description: mask(t.description || '').slice(0, 200) }));
    if (!list.json?.result) return finish(base, { ok: false, serverInfo: init.json.result.serverInfo, error: mask(list.json?.error?.message || `HTTP ${list.status}`) });
    return finish(base, { ok: true, serverInfo: init.json.result.serverInfo || null, tools });
  } catch (e) {
    return finish(base, { ok: false, error: ac.signal.aborted ? `timeout or cancelled` : mask(e.message) });
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
