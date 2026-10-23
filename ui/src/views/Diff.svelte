<script>
  import { api } from '../lib/api.js';
  import { app, navigate, openFile } from '../lib/store.svelte.js';
  import { resource } from '../lib/resource.svelte.js';
  import { timeAgo, fmtDate } from '../lib/format.js';
  import DiffView from '../lib/DiffView.svelte';
  import Icon from '../lib/Icon.svelte';
  import Empty from '../lib/Empty.svelte';
  import ToolBadge from '../lib/ToolBadge.svelte';

  let { params = {} } = $props();

  const path = $derived(params.path || '');
  const history = resource((p) => (p ? api('/api/history', { path: p }) : Promise.resolve([])), { key: () => path });
  const versions = $derived(Array.isArray(history.data) ? history.data : []);

  // defaults: previous snapshot → current
  const from = $derived(params.from || versions[1]?.id || versions[0]?.id || 'git:HEAD');
  const to = $derived(params.to || 'current');

  const diff = resource((k) => (k.path ? api('/api/diff', k) : Promise.resolve(null)), {
    key: () => ({ path, from, to }),
    enabled: () => !!path && (!!params.from || history.data !== undefined),
  });

  function set(p) {
    navigate('diff', { path, from, to, ...p });
  }

  const label = (id) => {
    if (id === 'current') return 'Working copy (current)';
    if (id === 'git:HEAD') return 'Git HEAD';
    const v = versions.find((x) => x.id === id);
    return v ? `${fmtDate(v.ts)} · ${timeAgo(v.ts, app.now)}` : id;
  };

  const recent = $derived.by(() => {
    const seen = new Set();
    const out = [];
    for (const e of app.events) {
      if (e.type !== 'change' || seen.has(e.path)) continue;
      seen.add(e.path);
      out.push(e);
      if (out.length >= 12) break;
    }
    return out;
  });
  const fileBy = $derived(new Map(app.files.map((f) => [f.path, f])));
</script>

<div class="page">
  <div class="page-h">
    <div>
      <h1>Diff</h1>
      <p>Compare any two local snapshots, git HEAD, or the working copy.</p>
    </div>
  </div>

  <div class="card controls">
    <label class="fld grow">
      <span class="eyebrow">File</span>
      <select class="input mono" value={path} onchange={(e) => navigate('diff', { path: e.currentTarget.value })}>
        <option value="">Select a file…</option>
        {#each app.files.map((f) => f.path).sort() as p (p)}<option value={p}>{p}</option>{/each}
      </select>
    </label>
    {#if path}
      <label class="fld">
        <span class="eyebrow">From</span>
        <select class="input" value={from} onchange={(e) => set({ from: e.currentTarget.value })}>
          <option value="git:HEAD">Git HEAD</option>
          {#each versions as v (v.id)}<option value={v.id}>{label(v.id)}</option>{/each}
        </select>
      </label>
      <button class="btn icon swap" title="Swap" aria-label="Swap from and to" onclick={() => set({ from: to === 'current' ? versions[0]?.id || 'git:HEAD' : to, to: from === 'git:HEAD' ? 'current' : from })}>⇄</button>
      <label class="fld">
        <span class="eyebrow">To</span>
        <select class="input" value={to} onchange={(e) => set({ to: e.currentTarget.value })}>
          <option value="current">Working copy (current)</option>
          {#each versions as v (v.id)}<option value={v.id}>{label(v.id)}</option>{/each}
        </select>
      </label>
    {/if}
  </div>

  {#if !path}
    <div class="card" style="margin-top:16px">
      <div class="card-h">Recently changed</div>
      <div class="card-b col" style="gap:2px">
        {#each recent as e (e.path)}
          <a class="list-row" href="#/diff?path={encodeURIComponent(e.path)}{e.historyId ? '&to=' + encodeURIComponent(e.historyId) : ''}">
            <ToolBadge tool={fileBy.get(e.path)?.tool} compact />
            <span class="mono grow ellipsis">{e.path}</span>
            {#if e.stats}<span class="add">+{e.stats.added}</span><span class="del">−{e.stats.removed}</span>{/if}
            <span class="faint small">{timeAgo(e.ts, app.now)}</span>
          </a>
        {:else}
          <Empty icon="diff" title="No recent changes">Pick a file above to compare versions.</Empty>
        {/each}
      </div>
    </div>
  {:else}
    <div class="result">
      <div class="row head">
        <span class="mono strong">{path}</span>
        <span class="faint small">{label(from)} → {label(to)}</span>
        <span class="spacer"></span>
        {#if diff.data}
          <span class="add big tnum">+{diff.data.added}</span>
          <span class="del big tnum">−{diff.data.removed}</span>
        {/if}
        <button class="btn sm" onclick={() => openFile(path)}><Icon name="file" size={13} /> Open file</button>
      </div>
      {#if diff.error}
        <Empty icon="alert" title="Could not compute diff">{diff.error.message}</Empty>
      {:else if diff.data}
        <DiffView hunks={diff.data.hunks || []} />
      {:else}
        <div class="skel" style="height:280px"></div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .controls { display: flex; align-items: flex-end; gap: 12px; padding: 14px 16px; flex-wrap: wrap; }
  .fld { display: flex; flex-direction: column; gap: 5px; min-width: 200px; }
  .fld .input { width: 100%; }
  .swap { margin-bottom: 1px; font-size: 16px; }
  .result { margin-top: 16px; display: flex; flex-direction: column; gap: 10px; }
  .head { flex-wrap: wrap; }
  .strong { font-weight: 600; }
  .small { font-size: 12px; }
  .add { color: var(--ok); font: 600 12px var(--mono); }
  .del { color: var(--err); font: 600 12px var(--mono); }
  .big { font-size: 14px; }
  a.list-row { color: inherit; text-decoration: none; }
  @media (max-width: 600px) {
    .fld { min-width: 100%; }
  }
</style>
