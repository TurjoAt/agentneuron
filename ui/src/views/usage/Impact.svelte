<script>
  // Code impact: lines added/removed (exact or estimated), churn over time, most-edited files.
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { app, openFile } from '../../lib/store.svelte.js';
  import { fmtNum, timeAgo, basename, dirname } from '../../lib/format.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';
  import ToolBadge from '../../lib/ToolBadge.svelte';
  import BarChart from '../../lib/viz/BarChart.svelte';
  import Skeleton from '../../lib/viz/Skeleton.svelte';
  import { usageQuery, dayMs } from './shared.js';

  let { params = {}, range = '30d', agent = 'all' } = $props();
  const res = resource(() => api('/api/usage/impact', usageQuery(range, agent)), { key: () => [range, agent] });
  const d = $derived(res.data);
  const churn = $derived(Array.isArray(d?.churn) ? d.churn : []);
  const files = $derived(Array.isArray(d?.files) ? d.files : []);
  let shown = $state(15);
  const maxLines = $derived(Math.max(1, ...files.map((f) => (f.linesAdded || 0) + (f.linesRemoved || 0))));
  const net = $derived(d?.linesAdded != null && d?.linesRemoved != null ? d.linesAdded - d.linesRemoved : null);
  const hasChurn = $derived(churn.some((c) => c.added || c.removed));
</script>

{#if res.error && !d}
  <div class="card"><Empty icon="alert" title="Impact data unavailable">{res.error.message}<div class="mt"><button class="btn sm" onclick={() => res.reload()}><Icon name="refresh" size={13} /> Retry</button></div></Empty></div>
{:else if !d}
  <Skeleton kind="kpis" count={4} label="Loading code impact" />
  <section class="card gap"><div class="card-b pad"><Skeleton kind="chart" height={200} /></div></section>
  <section class="card gap"><div class="card-b pad"><Skeleton kind="table" /></div></section>
{:else if !files.length && !d.linesAdded && !d.linesRemoved}
  <div class="card"><Empty icon="edit" title="No agent edits in this range">Files changed by Claude Code or Codex show up here.</Empty></div>
{:else}
  <div class="strip">
    <div class="card stat">
      <div class="top"><span class="eyebrow">Lines added</span>{#if d.exact}<span class="badge ok xs" title="From Claude Code cost-state">exact</span>{:else}<span class="badge warn xs" title="Counted from edit diffs in transcripts; may differ from git">estimated</span>{/if}</div>
      <div class="big tnum add">+{fmtNum(d.linesAdded)}</div>
    </div>
    <div class="card stat"><div class="eyebrow">Lines removed</div><div class="big tnum del">−{fmtNum(d.linesRemoved)}</div></div>
    <div class="card stat"><div class="eyebrow">Net</div><div class="big tnum">{net == null ? '—' : `${net >= 0 ? '+' : '−'}${fmtNum(Math.abs(net))}`}</div></div>
    <div class="card stat"><div class="eyebrow">Files touched</div><div class="big tnum">{fmtNum(files.length)}</div></div>
  </div>

  <section class="card gap">
    <div class="card-h">Churn over time <span class="sub">lines per day</span></div>
    <div class="cb">
      {#if hasChurn && churn.length > 1}
        <BarChart buckets={churn.map((c) => dayMs(c.date))} series={[{ key: 'added', label: 'Added', values: churn.map((c) => c.added || 0), color: 'var(--ok)' }, { key: 'removed', label: 'Removed', values: churn.map((c) => c.removed || 0), color: 'var(--err)' }]} bucket="day" height={200} label="Lines added and removed per day" />
      {:else}<div class="ph faint">No churn to chart in this range.</div>{/if}
    </div>
  </section>

  <section class="card gap">
    <div class="card-h">Most-edited files <span class="sub">{files.length}</span></div>
    <div class="tw">
      <table class="tbl">
        <thead><tr><th>File</th><th class="num">Edits</th><th class="num">Sessions</th><th>Lines</th><th>Agents</th><th class="num">Last</th><th></th></tr></thead>
        <tbody>
          {#each files.slice(0, shown) as f (f.path)}
            <tr>
              <td class="fp"><EntityLink kind="file" id={f.path} title={f.path}><span class="bn">{basename(f.path)}</span>{#if dirname(f.path)}<span class="dn faint">{dirname(f.path)}/</span>{/if}</EntityLink></td>
              <td class="num tnum"><b>{fmtNum(f.edits)}</b></td>
              <td class="num tnum">{fmtNum(f.sessions)}</td>
              <td>
                <div class="lines" title="+{f.linesAdded} / −{f.linesRemoved}">
                  <span class="lb" aria-hidden="true"><span class="a" style="width:{((f.linesAdded || 0) / maxLines) * 100}%"></span><span class="r" style="width:{((f.linesRemoved || 0) / maxLines) * 100}%"></span></span>
                  <span class="tnum add tiny">+{fmtNum(f.linesAdded)}</span><span class="tnum del tiny">−{fmtNum(f.linesRemoved)}</span>
                </div>
              </td>
              <td><span class="tools">{#each f.tools || [] as t (t)}<ToolBadge tool={t} compact />{/each}</span></td>
              <td class="num faint tiny">{timeAgo(f.lastAt, app.now)}</td>
              <td class="num"><button class="btn ghost sm icon" title="Open in Files" aria-label="Open {f.path} in Files" onclick={() => openFile(f.path)}><Icon name="external" size={12} /></button></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if files.length > shown}<div class="more"><button class="btn sm" onclick={() => (shown += 25)}>Show more ({files.length - shown})</button></div>{/if}
  </section>
{/if}

<style>
  .mt { margin-top: 10px; }
  .gap { margin-top: 14px; }
  .pad { padding-top: 14px; }
  .strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
  .stat { padding: 13px 15px; display: flex; flex-direction: column; gap: 3px; }
  .top { display: flex; align-items: center; gap: 6px; }
  .xs { font-size: 10px; height: 17px; padding: 0 6px; }
  .big { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
  .add { color: var(--ok); }
  .del { color: var(--err); }
  .tiny { font-size: 11px; }
  .cb { padding: 2px 16px 14px; }
  .ph { height: 160px; display: grid; place-items: center; font-size: 13px; }
  .tw { overflow-x: auto; padding: 0 6px 8px; }
  .tbl { min-width: 640px; }
  .tbl th.num, .tbl td.num { text-align: right; }
  .fp { max-width: 340px; }
  .fp :global(a) { display: inline-flex; gap: 6px; align-items: baseline; min-width: 0; max-width: 100%; border-bottom: 0; }
  .bn { font-family: var(--mono); font-size: 12.5px; }
  .dn { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lines { display: flex; align-items: center; gap: 6px; }
  .lb { width: 90px; height: 6px; border-radius: 99px; background: var(--panel-active); display: inline-flex; overflow: hidden; }
  .lb .a { background: var(--ok); }
  .lb .r { background: var(--err); }
  .tools { display: inline-flex; gap: 6px; }
  .more { padding: 0 16px 14px; }
  @media (max-width: 640px) { .strip { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
