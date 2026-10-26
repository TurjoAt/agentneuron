// Sidebar badges that need a fetch (false claims, usage anomalies, stale memory).
// Loaded once after boot, then at most once a minute when files change. Failures just hide the badge.
import { api } from './api.js';
import { app, onBoot } from './store.svelte.js';

export const navBadges = $state({ verify: 0, usage: 0, memory: 0 });

let last = 0;
let timer = null;

async function load() {
  last = Date.now();
  const [v, u, m] = await Promise.allSettled([api('/api/verify'), api('/api/usage/summary', { range: '24h' }), api('/api/usage/memory')]);
  navBadges.verify = v.status === 'fulfilled' ? Number(v.value?.summary?.false) || 0 : 0;
  navBadges.usage = u.status === 'fulfilled' ? (u.value?.anomalies || []).filter((a) => a.severity === 'high' || a.severity === 'medium').length : 0;
  navBadges.memory = m.status === 'fulfilled' ? (m.value?.memory || []).reduce((a, x) => a + (x.stale?.length || 0), 0) : 0;
}

/** Ask for a refresh; throttled to one fetch per minute. */
export function refreshNavBadges() {
  clearTimeout(timer);
  const wait = Math.max(0, 60_000 - (Date.now() - last));
  timer = setTimeout(() => load().catch(() => {}), wait);
}

onBoot(() => {
  // let the first view load its own data first
  setTimeout(() => load().catch(() => {}), 800);
});

/** Badge counts per view id (reactive). */
export function badgeFor(id) {
  switch (id) {
    case 'health': return { n: app.health?.counts?.error || 0, tone: 'err', title: 'context errors' };
    case 'agents': return { n: app.conflicts.length, tone: 'err', title: 'agents editing the same file' };
    case 'verify': return { n: navBadges.verify, tone: 'warn', title: 'false instructions' };
    case 'usage': return { n: navBadges.usage, tone: 'warn', title: 'usage anomalies (24h)' };
    case 'memory': return { n: navBadges.memory, tone: 'warn', title: 'stale memory claims' };
    default: return { n: 0 };
  }
}
