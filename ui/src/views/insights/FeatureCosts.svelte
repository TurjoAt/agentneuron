<script>
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { fmtNum } from '../../lib/format.js';
  import Empty from '../../lib/Empty.svelte';
  import BarChart from '../../lib/viz/BarChart.svelte';

  const data = resource(() => api('/api/insights/costs-by-feature'), { live: false });
  const d = $derived(data.data);
  const rows = $derived(d?.features || []);
  const top = $derived(rows.filter((r) => r.cost > 0).slice(0, 12));
  const money = (v) => '$' + (v >= 100 ? Math.round(v) : (v || 0).toFixed(2));
  const dur = (ms) => (ms >= 36e5 ? `${(ms / 36e5).toFixed(1)} h` : `${Math.round(ms / 6e4)} min`);
  const KIND = { task: 'accent', branch: 'info', scope: '', unattributed: 'warn' };
  let openRow = $state(null);
</script>

{#if data.error}
  <Empty icon="alert" title="Could not compute costs">{data.error.message}</Empty>
{:else if !d}
  <div class="skel" style="height:260px"></div>
{:else if !rows.length}
  <Empty icon="activity" title="No sessions or commits yet">Agent sessions, commits and board tasks are joined here once there is some history.</Empty>
{:else}
  <div class="stack">
    <section class="card">
      <div class="card-h">Cost by feature <span class="sub">{money(d.total.cost)} · {fmtNum(d.total.tokens)} tokens · {d.total.sessions} sessions</span></div>
      <div class="card-b">
        {#if top.length}
          <BarChart labels={top.map((r) => (r.feature.length > 18 ? r.feature.slice(0, 17) + '…' : r.feature))} series={[{ key: 'USD', values: top.map((r) => r.cost) }]} height={170} yFormat={money} legend={false} label="Estimated cost per feature" />
        {/if}
        <div class="faint tiny">{d.note}</div>
      </div>
    </section>
    <section class="card">
      <div class="scroll">
        <table class="tbl">
          <thead><tr><th>Feature</th><th>Sessions</th><th>Tokens</th><th>Cost</th><th>Agent time</th><th>Commits</th><th>Files</th><th>Matched by</th></tr></thead>
          <tbody>
            {#each rows as r (r.kind + ':' + (r.taskId || r.branch || r.feature))}
              <tr class="click" onclick={() => (openRow = openRow === r ? null : r)}>
                <td class="ft"><span class="badge {KIND[r.kind] || ''}">{r.kind}</span> {r.feature}</td>
                <td class="tnum">{r.sessions}</td>
                <td class="tnum">{fmtNum(r.tokens)}</td>
                <td class="tnum"><b>{money(r.cost)}</b></td>
                <td class="tnum">{dur(r.timeMs)}</td>
                <td class="tnum">{r.commits}</td>
                <td class="tnum">{r.files}</td>
                <td class="faint tiny">{r.matchedBy.join(', ')}</td>
              </tr>
              {#if openRow === r}
                <tr><td colspan="8" class="det">
                  {#each r.sessionList as s (s.sessionId)}<div class="tiny"><span class="mono faint">{s.tool} {s.sessionId.slice(0, 10)}</span> {s.title} · {money(s.usd)} <span class="faint">({s.matchedBy.join(', ') || 'no match'})</span></div>{/each}
                  {#each r.commitList as c (c.hash)}<div class="tiny"><span class="mono faint">{c.hash.slice(0, 8)}</span> {c.subject}</div>{/each}
                </td></tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  </div>
{/if}

<style>
  .stack { display: flex; flex-direction: column; gap: 14px; }
  .scroll { overflow: auto; max-height: 600px; }
  .ft { min-width: 220px; overflow-wrap: anywhere; }
  .click { cursor: pointer; }
  .det { background: var(--panel-hover); display: table-cell; }
  .tiny { font-size: 11.5px; }
</style>
