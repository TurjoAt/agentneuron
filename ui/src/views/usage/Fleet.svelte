<script>
  // Agent fleet: per run, which subagents/advisors the main session used, with model, cost and turns.
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { app, navigate } from '../../lib/store.svelte.js';
  import { fmtNum, timeAgo } from '../../lib/format.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';
  import ToolBadge from '../../lib/ToolBadge.svelte';
  import HBars from '../../lib/viz/HBars.svelte';
  import Skeleton from '../../lib/viz/Skeleton.svelte';
  import FleetGraph from './FleetGraph.svelte';
  import { usageQuery, money, pct, modelLabel, sessionLabel } from './shared.js';

  let { params = {}, range = '30d', agent = 'all' } = $props();
  const res = resource(() => api('/api/usage/fleet', usageQuery(range, agent)), { key: () => [range, agent] });
  const runs = $derived(res.data?.runs || []);
  let shown = $state(6);

  const stats = $derived.by(() => {
    let sub = 0, subUsd = 0, total = 0, adv = 0;
    const byName = new Map();
    for (const r of runs) {
      for (const n of r.nodes || []) {
        total += n.usd || 0;
        if (n.kind === 'subagent') {
          sub++;
          subUsd += n.usd || 0;
          const g = byName.get(n.name) || { key: n.name || 'subagent', value: 0, n: 0 };
          g.value += n.usd || 0;
          g.n++;
          byName.set(n.name, g);
        }
        if (n.kind === 'advisor') adv++;
      }
    }
    return { sub, subUsd, total, adv, byName: [...byName.values()].map((g) => ({ ...g, sub: `${g.n}×` })) };
  });
</script>

{#if res.error && !res.data}
  <div class="card"><Empty icon="alert" title="Fleet data unavailable">{res.error.message}<div class="mt"><button class="btn sm" onclick={() => res.reload()}><Icon name="refresh" size={13} /> Retry</button></div></Empty></div>
{:else if !res.data}
  <Skeleton kind="kpis" count={4} label="Loading agent fleet" />
  <div class="runs">{#each Array(2) as _, i (i)}<section class="card"><div class="card-b pad"><Skeleton kind="graph" height={180} /></div></section>{/each}</div>
{:else if !runs.length}
  <div class="card"><Empty icon="users" title="No multi-agent runs in this range">Sessions that spawn subagents (Task / Agent tool) or consult an advisor appear here as a graph.</Empty></div>
{:else}
  <div class="strip">
    <div class="card stat"><div class="eyebrow">Runs with subagents</div><div class="big tnum">{fmtNum(runs.length)}</div></div>
    <div class="card stat"><div class="eyebrow">Subagents spawned</div><div class="big tnum">{fmtNum(stats.sub)}</div><div class="faint tiny">{(stats.sub / runs.length).toFixed(1)} per run</div></div>
    <div class="card stat"><div class="eyebrow">Subagent cost</div><div class="big tnum">{money(stats.subUsd)}</div><div class="faint tiny">{pct(stats.total ? stats.subUsd / stats.total : null, 0)} of these runs</div></div>
    <div class="card stat"><div class="eyebrow">Advisor consults</div><div class="big tnum">{fmtNum(stats.adv)}</div></div>
  </div>

  <div class="layout">
    <div class="runs">
      {#each runs.slice(0, shown) as r (r.sessionId)}
        <section class="card run">
          <div class="card-h">
            <ToolBadge tool={r.tool} compact />
            <EntityLink kind="session" id={r.sessionId} label={sessionLabel(r)} class="ttl ellipsis" />
            <span class="spacer"></span>
            <span class="faint tiny">{timeAgo(r.startedAt, app.now)}</span>
            <b class="tnum">{money(r.usd)}</b>
            <button class="btn ghost sm icon" title="Replay session" aria-label="Replay session" onclick={() => navigate('sessions', { id: r.sessionId })}><Icon name="play" size={12} /></button>
          </div>
          <div class="card-b"><FleetGraph run={r} /></div>
        </section>
      {/each}
      {#if runs.length > shown}<button class="btn sm" onclick={() => (shown += 6)}>Show more runs ({runs.length - shown})</button>{/if}
    </div>
    <aside class="card side">
      <div class="card-h">Subagent cost by type</div>
      <div class="card-b">
        {#if stats.byName.length}<HBars items={stats.byName} format={(v) => money(v)} title="Subagent cost by type" />{:else}<div class="faint tiny">No subagents.</div>{/if}
        <div class="legend">
          <span><i class="lg main"></i>main</span><span><i class="lg sub"></i>subagent</span><span><i class="lg adv"></i>advisor (dashed)</span>
        </div>
        <p class="faint tiny">Model chips open the model; run titles open the session. Cost per node is {runs.some((r) => r.nodes?.some((n) => n.usd == null)) ? 'partly unknown' : 'estimated from each transcript’s token usage'}.</p>
      </div>
    </aside>
  </div>
{/if}

<style>
  .mt { margin-top: 10px; }
  .pad { padding-top: 16px; }
  .strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
  .stat { padding: 13px 15px; display: flex; flex-direction: column; gap: 3px; }
  .big { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
  .tiny { font-size: 11px; }
  .layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 14px; margin-top: 14px; align-items: start; }
  .runs { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .layout > .runs { margin: 0; }
  :global(.ttl) { font-weight: 600; max-width: 60%; }
  .side { position: sticky; top: 12px; }
  .legend { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11.5px; color: var(--text-2); margin: 12px 0 6px; }
  .legend span { display: inline-flex; gap: 5px; align-items: center; }
  .lg { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .lg.main { background: var(--accent); }
  .lg.sub { background: var(--ok); }
  .lg.adv { background: var(--info); }
  @media (max-width: 1000px) { .layout { grid-template-columns: minmax(0, 1fr); } .side { position: static; } }
  @media (max-width: 640px) { .strip { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
