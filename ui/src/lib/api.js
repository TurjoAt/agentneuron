// REST + SSE client. Same origin; `?token=` from the page URL is forwarded on
// every request and on the EventSource. Transparently swaps to the in-memory
// mock when enabled (?mock=1 or after /api/state fails).

import { createMock } from '../mock.js';

const pageParams = new URLSearchParams(location.search);
let token = pageParams.get('token') || '';
/** Token passed in the page URL (used once for cookie login, then stripped). */
export const urlToken = token;
export function setToken(t) {
  token = t || '';
}
/** Remove ?token= from the address bar (after a successful cookie login). */
export function stripUrlToken() {
  const u = new URL(location.href);
  if (!u.searchParams.has('token')) return;
  u.searchParams.delete('token');
  history.replaceState(history.state, '', u.pathname + u.search + u.hash);
}
export const mockRequested = pageParams.has('mock') && pageParams.get('mock') !== '0';

let mock = null;

export function enableMock() {
  if (!mock) mock = createMock();
}
export const isMock = () => !!mock;

export class ApiError extends Error {
  constructor(status, message, body = null) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export function apiUrl(path, params = {}) {
  const u = new URL(path, location.origin);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  }
  if (token) u.searchParams.set('token', token);
  return u.pathname + u.search;
}

/** GET (or other method via init) a JSON endpoint. */
export async function api(path, params, init = {}) {
  if (mock) {
    try {
      return await mock.request(path, params, init);
    } catch (e) {
      throw new ApiError(e.status || 500, e.message, e.body || null);
    }
  }
  let res;
  try {
    res = await fetch(apiUrl(path, params), {
      ...init,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(init.headers || {}) },
    });
  } catch (e) {
    throw new ApiError(0, 'Network error — is mdctl running?');
  }
  if (!res.ok) {
    let msg = res.statusText;
    let body = null;
    try {
      body = await res.json();
      msg = body.error || body.message || msg;
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, msg || `HTTP ${res.status}`, body);
  }
  return res.json();
}

export function post(path, body) {
  return api(path, null, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const STREAM_EVENTS = ['event', 'health', 'graph', 'conflict', 'ping', 'job', 'joblog', 'notify', 'board', 'files'];

/**
 * Open the live stream with exponential-backoff reconnect.
 * @param {{ onEvent:(name:string, data:any)=>void, onStatus:(s:'connecting'|'live'|'reconnecting'|'offline')=>void }} h
 */
export function connectStream({ onEvent, onStatus }) {
  if (mock) return mock.stream({ onEvent, onStatus });
  if (typeof EventSource === 'undefined') {
    onStatus('offline');
    return { close() {}, reconnect() {} };
  }
  let es = null;
  let timer = null;
  let attempt = 0;
  let closed = false;

  const open = () => {
    clearTimeout(timer);
    onStatus(attempt ? 'reconnecting' : 'connecting');
    es = new EventSource(apiUrl('/api/stream'), { withCredentials: true });
    es.onopen = () => {
      attempt = 0;
      onStatus('live');
    };
    for (const name of STREAM_EVENTS) {
      es.addEventListener(name, (e) => {
        let data = null;
        try {
          data = e.data ? JSON.parse(e.data) : null;
        } catch {
          data = e.data;
        }
        onEvent(name, data);
      });
    }
    es.onerror = () => {
      es?.close();
      if (closed) return;
      attempt++;
      onStatus('reconnecting');
      const delay = Math.min(15000, 600 * 2 ** Math.min(attempt, 5)) + Math.random() * 400;
      timer = setTimeout(open, delay);
    };
  };
  open();

  return {
    close() {
      closed = true;
      clearTimeout(timer);
      es?.close();
    },
    reconnect() {
      es?.close();
      attempt = 0;
      open();
    },
  };
}
