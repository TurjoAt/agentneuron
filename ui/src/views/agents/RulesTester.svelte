<script>
  import { untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import { app, openFile } from '../../lib/store.svelte.js';
  import { fmtNum } from '../../lib/format.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import { toolKey } from './shared.js';

  let { initial = '' } = $props();
  let path = $state(untrack(() => initial || ''));
  let res = $state(null);
  let err = $state('');
  let busy = $state(false);
  let seq = 0;

  const REASON = {
    always: ['always', 'ok', 'Loaded for every file'],
    hierarchy: ['hierarchy', 'info', 'Inherited from a parent directory'],
    glob: ['glob', 'accent', 'Matches a glob'],
    description: ['by description', 'warn', 'Model decides from the rule description'],
  };
  const fileByPath = $derived(new Map(app.files.map((f) => [f.path, f])));
  const suggestions = $derived(app.files.map((f) => f.path).slice(0, 400));
  const total = $derived((res || []).reduce((a, r) => a + (fileByPath.get(r.path)?.tokens || 0), 0));
  const groups = $derived.by(() => {
    const m = new Map();
    for (const r of res || []) (m.get(r.tool) || m.set(r.tool, []).get(r.tool)).push(r);
    return [...m.entries()];
  });

  async function run() {
    const p = path.trim().replace(/^\.?\//, '');
    if (!p) { res = null; return; }
    const my = ++seq;
    busy = true;
    err = '';
    try {
      const r = await api('/api/agents/rules-for', { path: p });
      if (my === seq) res = Array.isArray(r) ? r : [];
    } catch (e) {
      if (my === seq) { err = e.message; res = null; }
    } finally {
      if (my === seq) busy = false;
    }
  }
  // Re-run only when the URL-provided path changes (not on every keystroke).
  $effect(() => {
    const i = initial;
    if (i) untrack(() => { path = i; run(); });
  });
</script>

<section class="card">
  <div class="card-h">Which rules apply to a file? <span class="sub">instruction files, hierarchy and scoped rules</span></div>
  <div class="card-b col" style="gap:14px">
    <form class="row" style="gap:8px" onsubmit={(e) => (e.preventDefault(), run())}>
      <input class="input grow mono" list="rt-files" placeholder="apps/web/src/Button.tsx" bind:value={path} aria-label="File path" />
      <datalist id="rt-files">{#each suggestions as s (s)}<option value={s}></option>{/each}</datalist>
      <button class="btn primary" disabled={!path.trim() || busy}><Icon name="search" size={14} /> Check</button>
    </form>
    {#if err}
      <div class="faint small">{err}</div>
    {:else if res && !res.length}
      <Empty icon="info" title="No rules apply">Nothing in this project's AI context targets that file.</Empty>
    {:else if res}
      <div class="sum faint small">{res.length} source{res.length === 1 ? '' : 's'} · about <b class="tnum">{fmtNum(total)}</b> tokens in context</div>
      {#each groups as [tool, items] (tool)}
        <div class="grp" style="--c:var(--tool-{toolKey(tool)})">
          <div class="gh"><span class="d"></span><b>{tool}</b></div>
          {#each items as r (r.path + r.reason)}
            {@const m = REASON[r.reason] || [r.reason, '', '']}
            <button class="list-row" onclick={() => openFile(r.path, { drawer: true })}>
              <span class="mono small ellipsis grow">{r.path}</span>
              {#if r.glob}<code class="gl">{r.glob}</code>{/if}
              <span class="badge {m[1]}" title={m[2]}>{m[0]}</span>
            </button>
          {/each}
        </div>
      {/each}
    {:else}
      <div class="faint small">Enter a path to see exactly which instruction files and scoped rules each tool would load for it.</div>
    {/if}
  </div>
</section>

<style>
  .small { font-size: 12.5px; }
  .grp { border: 1px solid var(--border); border-radius: 12px; padding: 8px; display: flex; flex-direction: column; gap: 2px; }
  .gh { display: flex; align-items: center; gap: 8px; padding: 2px 6px 6px; text-transform: capitalize; font-size: 13px; }
  .d { width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
  .gl { font-family: var(--mono); font-size: 11px; background: var(--inset); border: 1px solid var(--border); border-radius: 5px; padding: 1px 6px; color: var(--text-2); }
</style>
