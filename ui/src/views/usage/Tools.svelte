<script>
  // Tool health: calls, errors, denials, latency per tool; MCP servers, skills, hooks, error loops.
  import { tick } from 'svelte';
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { app, navigate } from '../../lib/store.svelte.js';
  import { fmtNum, timeAgo } from '../../lib/format.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';
  import HBars from '../../lib/viz/HBars.svelte';
  import Skeleton from '../../lib/viz/Skeleton.svelte';
  import { usageQuery, fmtMs, pct, toolNameOf } from './shared.js';

  let { params = {}, range = '30d', agent = 'all' } = $props();
  const res = resource(() => api('/api/usage/tools', usageQuery(range, agent)), { key: () => [range, agent] });
  const d = $derived(res.data);
  const hi = $derived(toolNameOf(params));

  let kind = $state('all');
  let q = $state('');
  let sort = $state({ key: 'calls', dir: -1 });
  const COLS = [['name', 'Tool'], ['kind', 'Kind'], ['calls', 'Calls'], ['errors', 'Errors'], ['errorRate', 'Error rate'], ['denied', 'Denied'], ['avgMs', 'Avg'], ['p90Ms', 'p90'], ['lastAt', 'Last used']];
  const tools = $derived.by(() => {
    const list = (d?.tools || []).filter((t) => (kind === 'all' || t.kind === kind) && (!q || t.name.toLowerCase().includes(q.toLowerCase())));
    const { key, dir } = sort;
    return list.slice().sort((a, b) => {
      const x = a[key] ?? -Infinity;
      const y = b[key] ?? -Infinity;
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
    });
  });
  const maxCalls = $derived(Math.max(1, ...(d?.tools || []).map((t) => t.calls || 0)));
  const totals = $derived.by(() => {
    const t = d?.tools || [];
    const calls = t.reduce((a, x) => a + (x.calls || 0), 0);
    const errors = t.reduce((a, x) => a + (x.errors || 0), 0);
    return { calls, errors, rate: calls ? errors / calls : null };
  });
  const counts = $derived({ all: d?.tools?.length || 0, builtin: (d?.tools || []).filter((t) => t.kind === 'builtin').length, mcp: (d?.tools || []).filter((t) => t.kind === 'mcp').length, skill: (d?.tools || []).filter((t) => t.kind === 'skill').length });
  const sortBy = (key) => (sort = { key, dir: sort.key === key ? -sort.dir : key === 'name' || key === 'kind' ? 1 : -1 });
  const pickTool = (name) => navigate('usage', { tab: 'tools', range: range === '30d' ? undefined : range, agent: agent === 'all' ? undefined : agent, tool: name === hi ? undefined : name });
  const shortName = (n) => n.replace(/^mcp__([^_]+)__/, '$1 · ');
  const rateCls = (r) => (r == null ? '' : r >= 0.15 ? 'bad' : r >= 0.05 ? 'mid' : 'good');

  // bring a highlighted tool into view
  $effect(() => {
    if (!hi || !tools.length) return;
    tick().then(() => document.querySelector(`[data-tool="${CSS.escape(hi)}"]`)?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
  });
</script>

{#if res.error && !d}
  <div class="card"><Empty icon="alert" title="Tool data unavailable">{res.error.message}<div class="mt"><button class="btn sm" onclick={() => res.reload()}><Icon name="refresh" size={13} /> Retry</button></div></Empty></div>
{:else if !d}
  <Skeleton kind="kpis" count={4} label="Loading tool health" />
  <section class="card gap"><div class="card-b"><Skeleton kind="table" count={9} /></div></section>
{:else if !d.tools?.length}
  <div class="card"><Empty icon="terminal" title="No tool calls in this range">Tool calls from Claude Code and Codex transcripts appear here.</Empty></div>
{:else}
  <div class="strip stagger">
    <div class="card stat"><div class="eyebrow">Tool calls</div><div class="big tnum">{fmtNum(totals.calls)}</div><div class="faint tiny">{d.tools.length} distinct tools</div></div>
    <div class="card stat"><div class="eyebrow">Error rate</div><div class="big tnum {rateCls(totals.rate)}">{pct(totals.rate)}</div><div class="faint tiny">{fmtNum(totals.errors)} failed calls</div></div>
    <div class="card stat"><div class="eyebrow">Denied · interrupted</div><div class="big tnum">{fmtNum(d.denials)} <span class="faint sep">·</span> {fmtNum(d.interrupts)}</div><div class="faint tiny">permission denials · user interrupts</div></div>
    <div class="card stat"><div class="eyebrow">Hooks</div><div class="big tnum">{fmtNum(d.hooks?.runs)}</div><div class="faint tiny">{fmtNum(d.hooks?.errors)} errors · {fmtNum(d.hooks?.preventedStops)} prevented stops</div></div>
  </div>

  <section class="card gap">
    <div class="card-h">
      Tools
      {#if hi}<span class="badge accent">highlighting <b class="mono">{shortName(hi)}</b><button class="x" aria-label="Clear highlight" onclick={() => pickTool(hi)}><Icon name="x" size={11} /></button></span>{/if}
      <span class="spacer"></span>
      <input class="input sm" type="search" placeholder="Filter tools" aria-label="Filter tools" bind:value={q} />
      <div class="segc" role="group" aria-label="Kind">
        {#each [['all', 'All'], ['builtin', 'Built-in'], ['mcp', 'MCP'], ['skill', 'Skills']] as [k, l] (k)}
          <button class:on={kind === k} aria-pressed={kind === k} onclick={() => (kind = k)}>{l} <span class="faint">{counts[k]}</span></button>
        {/each}
      </div>
    </div>
    <div class="tw">
      <table class="tbl">
        <thead>
          <tr>
            {#each COLS as [key, label] (key)}
              <th class:num={!['name', 'kind'].includes(key)} aria-sort={sort.key === key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
                <button class="th" onclick={() => sortBy(key)}>{label}{#if sort.key === key}<Icon name={sort.dir > 0 ? 'arrowUp' : 'arrowDown'} size={10} />{/if}</button>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each tools as t (t.name)}
            <tr data-tool={t.name} class:hl={hi === t.name}>
              <td class="nm"><EntityLink kind="tool" id={t.name} label={shortName(t.name)} /></td>
              <td><span class="badge kind-{t.kind}">{t.kind === 'mcp' ? 'MCP' : t.kind === 'skill' ? 'skill' : 'built-in'}</span>{#if t.server}<span class="faint tiny srv">{t.server}</span>{/if}</td>
              <td class="num"><div class="cbar"><span class="tnum">{fmtNum(t.calls)}</span><span class="bt" aria-hidden="true"><span style="width:{(t.calls / maxCalls) * 100}%"></span></span></div></td>
              <td class="num tnum">{t.errors ? fmtNum(t.errors) : '—'}</td>
              <td class="num tnum"><span class="rate {rateCls(t.errorRate)}">{#if t.errorRate >= 0.15}<Icon name="alert" size={11} />{/if}{pct(t.errorRate)}</span></td>
              <td class="num tnum">{t.denied ? fmtNum(t.denied) : '—'}</td>
              <td class="num tnum">{fmtMs(t.avgMs)}</td>
              <td class="num tnum faint">{fmtMs(t.p90Ms)}</td>
              <td class="num faint tiny">{timeAgo(t.lastAt, app.now)}</td>
            </tr>
          {:else}
            <tr><td colspan={COLS.length} class="faint">No tools match.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <div class="grid">
    <section class="card">
      <div class="card-h">MCP servers <span class="sub">{d.mcpServers?.length || 0}</span></div>
      <div class="card-b">
        {#if d.mcpServers?.length}
          <ul class="srvs">
            {#each d.mcpServers as s (s.server)}
              <li>
                <span class="sic"><Icon name="server" size={13} /></span>
                <div class="grow"><b>{s.server}</b><div class="faint tiny">{fmtNum(s.calls)} calls · {fmtNum(s.errors)} errors ({pct(s.calls ? s.errors / s.calls : null)})</div></div>
                {#if s.needsAuth}<span class="badge warn" title="This server is waiting for authentication"><Icon name="key" size={11} /> needs auth</span>{:else}<span class="badge ok"><Icon name="check" size={11} /> ok</span>{/if}
              </li>
            {/each}
          </ul>
        {:else}<div class="faint small">No MCP tool calls in this range.</div>{/if}
      </div>
    </section>

    <section class="card">
      <div class="card-h">Skills <span class="sub">invocations</span></div>
      <div class="card-b">
        {#if d.skills?.length}<HBars items={d.skills.map((s) => ({ key: s.name, value: s.calls }))} format={fmtNum} title="Skill invocations" highlight={hi} onselect={(it) => pickTool(it.key)} />
        {:else}<div class="faint small">No skills used in this range.</div>{/if}
      </div>
    </section>

    <section class="card wide">
      <div class="card-h">Error loops <span class="sub">same tool failing 3+ times in a row</span></div>
      {#if d.loops?.length}
        <ul class="loops">
          {#each d.loops as l, i (i)}
            <li>
              <span class="cnt tnum" title="{l.count} failures in a row">{l.count}×</span>
              <div class="grow">
                <div class="lh"><EntityLink kind="tool" id={l.tool} label={shortName(l.tool)} /><span class="faint tiny">{timeAgo(l.ts, app.now)}</span></div>
                {#if l.sample}<code class="smp">{l.sample}</code>{/if}
              </div>
              <button class="btn sm" onclick={() => navigate('sessions', { id: l.session, ts: l.ts || undefined })}><Icon name="play" size={12} /> Replay</button>
            </li>
          {/each}
        </ul>
      {:else}
        <Empty icon="check" title="No error loops" compact>No tool failed three or more times in a row.</Empty>
      {/if}
    </section>
  </div>
{/if}

<style>
  .mt { margin-top: 10px; }
  .gap { margin-top: 14px; }
  .strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
  .stat { padding: 13px 15px; display: flex; flex-direction: column; gap: 3px; }
  .big { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
  .sep { font-weight: 400; }
  .good { color: var(--ok); }
  .mid { color: var(--warn); }
  .bad { color: var(--err); }
  .tiny { font-size: 11px; }
  .small { font-size: 12.5px; }
  .card-h { flex-wrap: wrap; row-gap: 8px; }
  .input.sm { height: 28px; font-size: 12px; width: 160px; }
  .x { all: unset; cursor: pointer; display: inline-grid; place-items: center; margin-left: 4px; }
  .tw { overflow-x: auto; padding: 0 6px 8px; }
  .tbl { min-width: 760px; }
  .tbl th.num, .tbl td.num { text-align: right; }
  .th { all: unset; cursor: pointer; display: inline-flex; gap: 3px; align-items: center; }
  .th:focus-visible { outline: 2px solid var(--accent); border-radius: 3px; }
  .nm { font-family: var(--mono); font-size: 12px; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  tr.hl td { background: var(--accent-soft) !important; }
  tr.hl td:first-child { box-shadow: inset 3px 0 0 var(--accent); }
  .srv { margin-left: 6px; }
  .kind-mcp { background: var(--info-soft); color: var(--info); }
  .kind-skill { background: var(--accent-soft); color: var(--accent); }
  .cbar { display: inline-flex; align-items: center; gap: 8px; justify-content: flex-end; }
  .bt { width: 70px; height: 5px; border-radius: 99px; background: var(--panel-active); overflow: hidden; display: inline-block; }
  .bt span { display: block; height: 100%; background: var(--accent); border-radius: inherit; }
  .rate { display: inline-flex; gap: 3px; align-items: center; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }
  .wide { grid-column: 1 / -1; }
  .srvs, .loops { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .srvs li { display: flex; gap: 10px; align-items: center; padding: 8px; border-radius: 9px; background: var(--inset); }
  .sic { width: 26px; height: 26px; border-radius: 7px; display: grid; place-items: center; background: var(--info-soft); color: var(--info); flex: none; }
  .loops { padding: 0 12px 12px; }
  .loops li { display: flex; gap: 12px; align-items: center; padding: 9px 10px; border-radius: 9px; border-left: 3px solid var(--err); background: var(--err-soft); }
  .cnt { font-weight: 700; color: var(--err); font-size: 15px; min-width: 30px; }
  .lh { display: flex; gap: 8px; align-items: baseline; font-family: var(--mono); font-size: 12px; }
  .smp { display: block; font-size: 11.5px; color: var(--text-2); margin-top: 3px; overflow-wrap: anywhere; }
  @media (max-width: 900px) { .strip { grid-template-columns: repeat(2, minmax(0, 1fr)); } .grid { grid-template-columns: minmax(0, 1fr); } }
  @media (max-width: 560px) { .input.sm { width: 100%; } .card-h .segc { width: 100%; } .card-h .segc button { flex: 1; justify-content: center; padding: 0 4px; } .loops li { flex-wrap: wrap; } }
</style>
