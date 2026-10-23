<script>
  import { api } from '../api.js';
  import { resource } from '../resource.svelte.js';
  import Empty from '../Empty.svelte';
  import BarChart from '../viz/BarChart.svelte';
  import { hue, initials, gx } from './gx.svelte.js';
  import { openFile } from '../store.svelte.js';
  let range = $state('90');
  const stats = resource((k) => api('/api/git/stats', k?.since ? { since: k.since } : {}), {
    key: () => ({ since: range === 'all' ? '' : new Date(Date.now() - Number(range) * 86400000).toISOString().slice(0, 10), t: gx.tick }),
  });
  const d = $derived(stats.data);
  const days = $derived(d?.byDay || []);
  const authors = $derived(d?.byAuthor || []);
  const maxA = $derived(Math.max(1, ...authors.map((a) => a.commits)));
  const maxF = $derived(Math.max(1, ...(d?.topFiles || []).map((a) => a.commits)));
  const total = $derived(days.reduce((a, x) => a + x.commits, 0));
</script>
{#if stats.error}<div class="card"><Empty icon="alert" title="Could not load stats">{stats.error.message}</Empty></div>
{:else if d?.available === false}<div class="card"><Empty icon="git" title="Stats unavailable">{d.reason}</Empty></div>
{:else if !d}<div class="skel" style="height:240px"></div>
{:else}
  <div class="g-bar">
    {#each [['30', '30 days'], ['90', '90 days'], ['365', 'Year'], ['all', 'All time']] as [v, l]}
      <button class="btn sm" class:primary={range === v} onclick={() => (range = v)}>{l}</button>
    {/each}
    <span class="faint small" style="margin-left:auto">{total} commits</span>
  </div>
  <section class="card" style="padding:14px 16px;margin-bottom:16px">
    <div class="eyebrow" style="margin-bottom:8px">Commits by day</div>
    {#if days.length}<BarChart labels={days.map((x) => x.date.slice(5))} series={[{ key: 'commits', label: 'Commits', values: days.map((x) => x.commits) }]} height={180} legend={false} label="Commits by day" />
    {:else}<div class="faint small">No commits in range.</div>{/if}
  </section>
  <div class="g-grid">
    <section class="card">
      <div class="card-h">By author</div>
      <div class="card-b col" style="gap:10px">
        {#each authors as a (a.email || a.author)}
          <div class="col" style="gap:3px">
            <div class="row"><span class="av" style="--h:{hue(a.author)};width:22px;height:22px;font-size:9px">{initials(a.author)}</span><span class="grow ellipsis small">{a.author}</span>
              <span class="faint tiny tnum">{a.commits}{#if a.added != null} · <span class="add">+{a.added}</span> <span class="del">−{a.removed}</span>{/if}</span></div>
            <div class="bar"><i style="width:{(a.commits / maxA) * 100}%;background:hsl({hue(a.author)} 60% 55%)"></i></div>
          </div>
        {:else}<div class="faint small">No authors.</div>{/each}
      </div>
    </section>
    <section class="card">
      <div class="card-h">Top files</div>
      <div class="card-b col" style="gap:8px">
        {#each (d.topFiles || []).slice(0, 12) as f (f.path)}
          <button class="col" style="gap:3px;border:0;background:none;color:inherit;text-align:left;cursor:pointer;padding:0" onclick={() => openFile(f.path, { drawer: true })}>
            <div class="row"><span class="mono small grow ellipsis">{f.path}</span><span class="faint tiny tnum">{f.commits}</span></div>
            <div class="bar"><i style="width:{(f.commits / maxF) * 100}%"></i></div>
          </button>
        {:else}<div class="faint small">No files.</div>{/each}
      </div>
    </section>
  </div>
{/if}
<style>
  .bar { height: 5px; border-radius: 3px; background: var(--panel-active); overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: 3px; background: var(--accent); transition: width .3s var(--ease); }
</style>
