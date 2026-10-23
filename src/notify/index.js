// ctx.notify(type, payload): SSE `notify` + webhooks (Slack/Discord compatible). Never throws.
export const NOTIFY_TYPES = ['secret', 'conflict', 'health-drop', 'job-failed', 'job-done'];
const LEVELS = { secret: 'error', conflict: 'warn', 'health-drop': 'warn', 'job-failed': 'error', 'job-done': 'info' };

export function createNotifier(ctx, { timeoutMs = 5000 } = {}) {
  return function notify(type, payload = {}) {
    try {
      const n = {
        type,
        title: String(payload.title || type),
        body: String(payload.body || ''),
        level: payload.level || LEVELS[type] || 'info',
        ts: Date.now(),
      };
      if (payload.path) n.path = payload.path;
      ctx.broadcast('notify', n);
      const hooks = ctx.config.notifications?.webhooks || [];
      for (const h of hooks) {
        if (!h || typeof h.url !== 'string' || !/^https?:\/\//i.test(h.url)) continue;
        if (Array.isArray(h.events) && h.events.length && !h.events.includes(type)) continue;
        const text = `[mdctl] ${n.title}${n.body ? ' - ' + n.body : ''}`;
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), timeoutMs);
        t.unref?.();
        fetch(h.url, {
          method: 'POST', signal: ac.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, content: text, ...n }),
        }).then((r) => r.body?.cancel?.(), () => {}).finally(() => clearTimeout(t));
      }
      return n;
    } catch { return null; }
  };
}

export function maskUrl(u) {
  try { const x = new URL(u); return `${x.protocol}//${x.host}/…`; } catch { return '…'; }
}
