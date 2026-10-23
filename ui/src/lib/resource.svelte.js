// Reactive data loader for views. Re-fetches when `key()` changes (immediately)
// or when live data changes (app.dataTick / graphTick, debounced). Keeps the
// previous data while reloading so the UI never flickers to empty.

import { untrack } from 'svelte';
import { app } from './store.svelte.js';

/**
 * @template T
 * @param {(key:any)=>Promise<T>} fetcher
 * @param {{ key?: ()=>any, live?: boolean|'graph', debounce?: number, enabled?: ()=>boolean }} [opts]
 */
export function resource(fetcher, opts = {}) {
  const { key = () => null, live = true, debounce = 450, enabled = () => true } = opts;
  const r = $state({ data: undefined, loading: false, error: null, reload: () => load() });
  let seq = 0;
  let timer = null;
  let lastKey;
  let currentKey;

  async function load() {
    clearTimeout(timer);
    const my = ++seq;
    r.loading = true;
    try {
      const d = await fetcher(currentKey);
      if (my === seq) {
        r.data = d;
        r.error = null;
      }
    } catch (e) {
      if (my === seq) r.error = e;
    } finally {
      if (my === seq) r.loading = false;
    }
  }

  $effect(() => {
    const k = key();
    const on = enabled();
    if (live === 'graph') void app.graphTick;
    else if (live) void app.dataTick;
    untrack(() => {
      if (!on) return;
      const sk = JSON.stringify(k ?? null);
      currentKey = k;
      if (sk !== lastKey || r.data === undefined) {
        if (lastKey !== undefined && sk !== lastKey) r.data = undefined;
        lastKey = sk;
        load();
      } else {
        clearTimeout(timer);
        timer = setTimeout(load, debounce);
      }
    });
  });

  $effect(() => () => clearTimeout(timer));
  return r;
}
