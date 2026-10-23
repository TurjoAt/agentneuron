// Deep secret masking for anything that leaves the process (API responses, SSE, logs).
import { maskSecretsInText } from '../health/secrets.js';

/** Return a copy of `v` with every string passed through maskSecretsInText. Never throws. */
export function maskDeep(v, depth = 0) {
  try {
    if (typeof v === 'string') return maskSecretsInText(v);
    if (v == null || typeof v !== 'object') return v;
    if (depth > 8) return '[…]';
    if (Array.isArray(v)) return v.map((x) => maskDeep(x, depth + 1));
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = maskDeep(val, depth + 1);
    return out;
  } catch { return null; }
}
