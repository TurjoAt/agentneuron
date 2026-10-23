// Audit log: .agentneuron/audit.jsonl. Params are masked before they hit disk.
import path from 'node:path';
import { createJsonl } from './jsonl.js';
import { maskSecretsInText } from '../health/secrets.js';

const SENSITIVE_KEY = /token|secret|password|passwd|authorization|api[_-]?key|cookie|credential/i;

export function maskParams(v, depth = 0) {
  if (v == null) return v;
  if (typeof v === 'string') {
    const m = maskSecretsInText(v);
    return m.length > 300 ? m.slice(0, 300) + '…' : m;
  }
  if (typeof v !== 'object') return v;
  if (depth > 4) return '[…]';
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => maskParams(x, depth + 1));
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    out[k] = SENSITIVE_KEY.test(k) ? '***' : (k === 'content' && typeof val === 'string') ? `[${val.length} chars]` : maskParams(val, depth + 1);
  }
  return out;
}

export function createAudit(root, opts) {
  const log = createJsonl(path.join(root, '.agentneuron', 'audit.jsonl'), opts);
  return {
    log(entry) {
      const e = { ts: Date.now(), ...entry };
      if ('params' in e) e.params = maskParams(e.params);
      log.append(e);
      return e;
    },
    /** Newest first. */
    read({ limit = 200 } = {}) {
      const rows = log.readAll();
      return rows.slice(-Math.max(1, Math.min(Number(limit) || 200, 5000))).reverse();
    },
    file: log.file,
  };
}
