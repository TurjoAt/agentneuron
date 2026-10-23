// ctx.notify(type, payload): SSE `notify` + webhooks (Slack/Discord compatible). Never throws.
// Webhooks are SSRF-guarded: http(s) only, no redirects, and private / loopback / link-local /
// metadata addresses are refused (checked on the address actually connected to, so DNS rebinding
// cannot slip past) unless `notifications.allowPrivate` (or the hook's own `allowPrivate`) is true.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

export const NOTIFY_TYPES = ['secret', 'conflict', 'health-drop', 'job-failed', 'job-done'];
const LEVELS = { secret: 'error', conflict: 'warn', 'health-drop': 'warn', 'job-failed': 'error', 'job-done': 'info' };
const MAX_RESPONSE = 64 * 1024;
const MAX_FIELD = 2000;
const BLOCKED_NAMES = /^(localhost|metadata\.google\.internal|metadata|instance-data)\.?$|\.localhost\.?$|\.internal\.?$/i;

function v4Private(a, b) {
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
}

/** True for loopback, private, link-local, CGNAT, unspecified, multicast, ULA and cloud-metadata addresses. */
export function isPrivateAddress(ip) {
  const fam = net.isIP(ip);
  if (fam === 4) { const [a, b] = ip.split('.').map(Number); return v4Private(a, b); }
  if (fam !== 6) return true; // not an IP: treat as unsafe
  const low = ip.toLowerCase().replace(/%.*$/, '');
  // expand to 8 hextets
  let [head, tail] = low.split('::');
  const toParts = (x) => (x ? x.split(':') : []);
  let hp = toParts(head); const tp = toParts(tail);
  const v4tail = (arr) => { // trailing dotted quad -> two hextets
    const last = arr[arr.length - 1];
    if (last && last.includes('.')) { const q = last.split('.').map(Number); arr.splice(arr.length - 1, 1, ((q[0] << 8) | q[1]).toString(16), ((q[2] << 8) | q[3]).toString(16)); }
    return arr;
  };
  hp = v4tail(hp); const tp2 = v4tail(tp);
  const parts = low.includes('::') ? [...hp, ...Array(Math.max(0, 8 - hp.length - tp2.length)).fill('0'), ...tp2] : hp;
  const w = parts.map((x) => parseInt(x || '0', 16));
  if (w.length !== 8 || w.some((x) => !Number.isFinite(x))) return true;
  const embedded = (hi) => v4Private(hi >> 8, hi & 255);
  if (w.every((x) => x === 0) || (w.slice(0, 7).every((x) => x === 0) && w[7] === 1)) return true; // :: and ::1
  if ((w[0] & 0xffc0) === 0xfe80) return true; // link-local
  if ((w[0] & 0xfe00) === 0xfc00) return true; // unique local
  if ((w[0] & 0xff00) === 0xff00) return true; // multicast
  if (w.slice(0, 5).every((x) => x === 0) && w[5] === 0xffff) return embedded(w[6], w[7]); // ::ffff:a.b.c.d
  if (w.slice(0, 6).every((x) => x === 0)) return embedded(w[6], w[7]); // ::a.b.c.d (deprecated)
  if (w[0] === 0x64 && w[1] === 0xff9b) return embedded(w[6], w[7]); // NAT64
  if (w[0] === 0x2002) return embedded(w[1], w[2]); // 6to4
  return false;
}

export function guardedLookup(allowPrivate) {
  return (hostname, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    dns.lookup(hostname, { all: true }, (err, addrs) => {
      if (err) return cb(err);
      if (!allowPrivate && addrs.some((a) => isPrivateAddress(a.address))) return cb(Object.assign(new Error('webhook target resolves to a private address'), { code: 'EBLOCKED' }));
      if (opts && opts.all) return cb(null, addrs);
      return cb(null, addrs[0].address, addrs[0].family);
    });
  };
}

/** POST JSON to a webhook. Resolves { status } or rejects. Exported for tests. */
export function postWebhook(urlStr, payload, { timeoutMs = 5000, allowPrivate = false } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch { return reject(new Error('invalid webhook url')); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject(new Error('webhook url must be http(s)'));
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (!allowPrivate) {
      if (net.isIP(host) ? isPrivateAddress(host) : BLOCKED_NAMES.test(host)) return reject(new Error('webhook target is a private or loopback address'));
    }
    const body = Buffer.from(JSON.stringify(payload));
    const mod = u.protocol === 'https:' ? https : http;
    let done = false;
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); err ? reject(err) : resolve(val); };
    const req = mod.request({
      protocol: u.protocol, hostname: host, port: u.port || undefined, path: `${u.pathname}${u.search}`, method: 'POST',
      auth: u.username ? `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}` : undefined,
      headers: { 'content-type': 'application/json', 'content-length': body.length },
      lookup: guardedLookup(allowPrivate), timeout: timeoutMs,
    }, (res) => { // redirects are never followed: a 3xx is simply the end of the exchange
      let n = 0;
      res.on('data', (d) => { n += d.length; if (n > MAX_RESPONSE) { res.destroy(); finish(null, { status: res.statusCode }); } });
      res.on('end', () => finish(null, { status: res.statusCode }));
      res.on('error', (e) => finish(e));
    });
    const timer = setTimeout(() => { req.destroy(new Error('webhook timeout')); }, timeoutMs);
    timer.unref?.();
    req.on('timeout', () => req.destroy(new Error('webhook timeout')));
    req.on('error', (e) => finish(e));
    req.end(body);
  });
}

export function createNotifier(ctx, { timeoutMs = 5000 } = {}) {
  return function notify(type, payload = {}) {
    try {
      const n = {
        type,
        title: String(payload.title || type).slice(0, MAX_FIELD),
        body: String(payload.body || '').slice(0, MAX_FIELD),
        level: payload.level || LEVELS[type] || 'info',
        ts: Date.now(),
      };
      if (payload.path) n.path = payload.path;
      ctx.broadcast('notify', n);
      const hooks = ctx.config.notifications?.webhooks || [];
      for (const h of hooks) {
        if (!h || typeof h.url !== 'string' || !/^https?:\/\//i.test(h.url)) continue;
        if (Array.isArray(h.events) && h.events.length && !h.events.includes(type)) continue;
        const text = `[agentneuron] ${n.title}${n.body ? ' - ' + n.body : ''}`;
        const allowPrivate = h.allowPrivate === true || ctx.config.notifications?.allowPrivate === true;
        postWebhook(h.url, { text, content: text, ...n }, { timeoutMs, allowPrivate }).catch(() => {});
      }
      return n;
    } catch { return null; }
  };
}

export function maskUrl(u) {
  try { const x = new URL(u); return `${x.protocol}//${x.host}/…`; } catch { return '…'; }
}
