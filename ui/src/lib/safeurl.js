// Navigation safety helpers (pure, no framework imports so they can be unit-tested in Node).

/**
 * Validate a workspace URL returned by the server before the UI navigates to it
 * (for example the result of `workspace.open`). Only http(s) URLs on the SAME
 * hostname as the current page, with an explicit port, are allowed; credentials
 * are rejected and any query/fragment (e.g. a `?token=`) is dropped.
 * @returns {string|null} normalized URL, or null when unsafe
 */
export function safeWorkspaceUrl(value, current = typeof location !== 'undefined' ? location.href : '') {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\u0000-\u001f\u007f\\]/.test(value)) return null;
  let u, here;
  try {
    here = new URL(current);
    u = new URL(value);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (!u.port) return null;
  if (u.hostname.toLowerCase() !== here.hostname.toLowerCase()) return null;
  return `${u.protocol}//${u.host}${u.pathname}`;
}
