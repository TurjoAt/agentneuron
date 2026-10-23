<script>
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { fmtNum, fmtDate } from '../../lib/format.js';
  import DiffView from '../../lib/DiffView.svelte';
  import Empty from '../../lib/Empty.svelte';
  import { hunksOf } from './shared.js';

  const H = 3_600_000;
  const PRESETS = [['1 hour ago', H], ['6 hours ago', 6 * H], ['yesterday', 24 * H], ['3 days ago', 72 * H], ['1 week ago', 168 * H], ['2 weeks ago', 336 * H], ['1 month ago', 720 * H]];
  let tool = $state('claude');
  let dir = $state('');
  let fromAgo = $state(168 * H);
  let toAgo = $state(0);
  let anchor = $state(Date.now());

  const dirs = resource(() => api('/api/context/dirs').catch(() => []), { live: false });
  const diff = resource(
    () => api('/api/context/diff', { dir, tool, from: anchor - fromAgo, to: anchor - toAgo }),
    { key: () => [dir, tool, fromAgo, toAgo, anchor], live: false }
  );
  const d = $derived(diff.data);
  const delta = $derived(d?.tokenDelta ?? (d ? (d.to?.tokens || 0) - (d.from?.tokens || 0) : 0));
  const stats = $derived.by(() => {
    let a = 0, r = 0;
    for (const h of hunksOf(d?.diff)) { if (h.type === 'add') a++; else if (h.type === 'del') r++; }
    return { a, r };
  });
</script>

<section class="card">
  <div class="card-h">Context time-travel <span class="sub">what the AI was told, then vs. now</span></div>
  <div class="card-b ctl">
    <label class="f"><span class="eyebrow">Tool</span>
      <select class="input" bind:value={tool}><option value="claude">Claude</option><option value="codex">Codex</option><option value="cursor">Cursor</option></select></label>
    <label class="f"><span class="eyebrow">Directory</span>
      <input class="input mono" list="tt-dirs" placeholder="(project root)" bind:value={dir} />
      <datalist id="tt-dirs">{#each Array.isArray(dirs.data) ? dirs.data : [] as x (x)}<option value={x}></option>{/each}</datalist></label>
    <label class="f"><span class="eyebrow">From</span>
      <select class="input" bind:value={fromAgo}>{#each PRESETS as [l, v] (v)}<option value={v}>{l}</option>{/each}</select></label>
    <label class="f"><span class="eyebrow">To</span>
      <select class="input" bind:value={toAgo}><option value={0}>now</option>{#each PRESETS as [l, v] (v)}<option value={v}>{l}</option>{/each}</select></label>
  </div>
  <div class="card-b">
    {#if diff.error}
      <Empty icon="alert" title="Could not compute the diff">{diff.error.message}</Empty>
    {:else if !d}
      <div class="skel" style="height:140px"></div>
    {:else}
      <div class="sum">
        <span class="faint small">{fmtDate(d.from?.ts)} → {fmtDate(d.to?.ts)}</span>
        <span class="badge ok">+{stats.a}</span><span class="badge err">−{stats.r}</span>
        <span class="badge {delta > 0 ? 'warn' : 'info'}">{delta > 0 ? '+' : ''}{fmtNum(delta)} tokens</span>
        {#each d.filesAdded || [] as p (p)}<span class="badge ok mono">+ {p}</span>{/each}
        {#each d.filesRemoved || [] as p (p)}<span class="badge err mono">− {p}</span>{/each}
      </div>
      {#if stats.a + stats.r}
        <div class="dv"><DiffView hunks={hunksOf(d.diff)} /></div>
      {:else}
        <div class="faint small" style="padding:12px 0">The effective context is identical across this range.</div>
      {/if}
    {/if}
  </div>
</section>

<style>
  .ctl { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  .f { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .sum { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
  .small { font-size: 12.5px; }
  .dv { max-height: 520px; overflow: auto; border: 1px solid var(--border); border-radius: 10px; }
</style>
