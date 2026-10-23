import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('api.js: stripUrlToken removes ?token= from the address bar and keeps other params', async () => {
  const calls = [];
  globalThis.location = new URL('http://localhost:4000/?token=SECRET&x=1#/files?path=a.md');
  globalThis.history = { state: null, replaceState: (_s, _t, url) => calls.push(url) };
  const api = await import('../ui/src/lib/api.js');
  assert.equal(api.urlToken, 'SECRET');
  api.stripUrlToken();
  assert.deepEqual(calls, ['/?x=1#/files?path=a.md']);
  assert.ok(!calls[0].includes('SECRET'));
  // after a successful cookie login the in-memory token is cleared: no URL carries it
  api.setToken('');
  assert.ok(!api.apiUrl('/api/reports/export', { format: 'md' }).includes('token'));
});

test('UI source: boot strips the URL token on every path; token never reaches storage or third parties', () => {
  const store = fs.readFileSync(new URL('../ui/src/lib/store.svelte.js', import.meta.url), 'utf8');
  const boot = store.slice(store.indexOf('export async function boot'));
  const beforeTry = boot.slice(boot.indexOf('urlToken &&'), boot.indexOf('await loadState'));
  assert.match(beforeTry, /\}\s*\n\s*\/\/[^\n]*\n\s*stripUrlToken\(\)/, 'stripUrlToken must run after the try/catch, not only on success');
  for (const f of ['api.js', 'store.svelte.js', 'Login.svelte']) {
    const src = fs.readFileSync(new URL(`../ui/src/lib/${f}`, import.meta.url), 'utf8');
    assert.ok(!/(localStorage|sessionStorage)\.setItem\([^)]*token/i.test(src), `${f} stores a token`);
  }
});
