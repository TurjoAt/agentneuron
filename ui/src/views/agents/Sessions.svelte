<script>
  import { api } from '../../lib/api.js';
  import { app, openFile } from '../../lib/store.svelte.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { timeAgo, fmtNum, fmtDate, fmtTime } from '../../lib/format.js';
  import ToolBadge from '../../lib/ToolBadge.svelte';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import BarChart from '../../lib/viz/BarChart.svelte';

  let { list = [], loading = false, error = null } = $props();
  const ACTIVE_MS = 10 * 60_000;
  let showAll = $state(false);
  let openId = $state(null);
  let range = $state(14);
  const shown = $derived(showAll ? list : list.slice(0, 8));
  const tokTotal = (t = {}) => (t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0);
  const maxTok = $derived(Math.max(1, ...list.map((s) => tokTotal(s.tokens))));
  const conflictPaths = $derived(new Set(app.conflicts.map((c) => c.path)));
  const money = (v) => '$' + (v >= 100 ? Math.round(v) : (v || 0).toFixed(2));

  const costs = resource(() => {
    const to = Date.now();
    return api('/api/agents/costs', { from: to - range * 86_400_000, to });
  }, { key: () => range, live: false });
  const costBy = $derived(new Map((costs.data?.sessions || []).map((s) => [s.sessionId || s.id, s])));
  const days = $derived((costs.data?.days || []).map((d) => ({ ...d, t: d.ts || Date.parse(d.day || d.date) })));

  const tl = resource(() => api('/api/agents/session', { id: openId }), { key: () => openId, enabled: () => !!openId, live: false });
  const ICON = { prompt: 'message', edit: 'edit', tool: 'terminal', summary: 'check' };
</script>

<div class="stack">
  <section class="card">
    <div class="card-h">
      Estimated cost <span class="sub">from transcript token usage</span><span class="spacer"></span>
      <div class="segc" role="group" aria-label="Range">
        {#each [7, 14, 30] as d (d)}<button class:on={range === d} onclick={() => (range = d)}>{d}d</button>{/each}
      </div>
    </div>
    <div class="card-b">
      {#if costs.error}
        <div class="faint small">Cost data unavailable: {costs.error.message}</div>
      {:else if !costs.data}
        <div class="skel" style="height:140px"></div>
      {:else}
        <div class="kp">
          <div><div class="eyebrow">Total</div><div class="big tnum">{money(costs.data.total?.usd || 0)}</div></div>
          <div><div class="eyebrow">Input</div><b class="tnum">{fmtNum(costs.data.total?.input || 0)}</b></div>
          <div><div class="eyebrow">Output</div><b class="tnum">{fmtNum(costs.data.total?.output || 0)}</b></div>
          <div><div class="eyebrow">Cache read</div><b class="tnum">{fmtNum(costs.data.total?.cacheRead || 0)}</b></div>
        </div>
        {#if days.length}
          <BarChart buckets={days.map((d) => d.t)} series={[{ key: 'USD', values: days.map((d) => d.usd || 0) }]} bucket="day" height={140} yFormat={money} legend={false} label="Daily cost" />
        {/if}
        <div class="faint tiny">{costs.data.note || 'Estimate from list prices; actual billing may differ.'}</div>
      {/if}
    </div>
  </section>

  <section class="card">
    <div class="card-h">Sessions <span class="sub">most recent first</span></div>
    {#if error}
      <Empty icon="alert" title="Could not load sessions">{error.message}</Empty>
    {:else if loading}
      <div class="card-b"><div class="skel" style="height:160px"></div></div>
    {:else if !list.length}
      <Empty icon="agents" title="No sessions found">No Claude Code or Codex transcripts reference this project yet.</Empty>
    {:else}
      <div class="slist">
        {#each shown as s (s.sessionId)}
          {@const cost = costBy.get(s.sessionId)}
          <article class="sess" class:live={app.now - s.last < ACTIVE_MS} class:open={openId === s.sessionId}>
            <div class="sh">
              <ToolBadge tool={s.tool} />
              <span class="st ellipsis">{s.title || 'Untitled session'}</span>
              {#if app.now - s.last < ACTIVE_MS}<span class="badge ok">active</span>{/if}
              <span class="spacer"></span>
              <span class="faint tiny" title="{fmtDate(s.start)} → {fmtDate(s.last)}">{timeAgo(s.last, app.now)}</span>
            </div>
            {#if s.lastPrompt}<div class="prompt">“{s.lastPrompt}”</div>{/if}
            <div class="sm-row">
              <span class="tiny faint mono">{s.sessionId.slice(0, 13)}</span>
              <span class="tiny muted"><b class="tnum">{fmtNum(s.messages)}</b> msgs</span>
              <span class="tiny muted"><b class="tnum">{fmtNum(tokTotal(s.tokens))}</b> tokens</span>
              <span class="tiny muted"><b class="tnum">{s.filesTouched?.length || 0}</b> files</span>
              {#if cost}<span class="tiny"><b class="tnum">{money(cost.usd)}</b> <span class="faint">{(cost.model || cost.models?.[0] || '').slice(0, 18)}</span></span>{/if}
            </div>
            <div class="tokbar" style="width:{Math.max(4, (tokTotal(s.tokens) / maxTok) * 100)}%">
              {#each [['input', 'var(--accent)'], ['output', 'var(--tool-claude)'], ['cacheRead', 'var(--tool-codex)'], ['cacheWrite', 'var(--tool-windsurf)']] as [k, c] (k)}
                <span style="flex:{s.tokens?.[k] || 0};background:{c}" title="{k}: {fmtNum(s.tokens?.[k] || 0)}"></span>
              {/each}
            </div>
            {#if s.filesTouched?.length}
              <div class="files">
                {#each s.filesTouched.slice(0, 6) as p (p)}
                  <button class="fchip mono" class:hot={conflictPaths.has(p)} onclick={() => openFile(p, { drawer: true })}>{p}</button>
                {/each}
                {#if s.filesTouched.length > 6}<span class="faint tiny">+{s.filesTouched.length - 6} more</span>{/if}
              </div>
            {/if}
            <button class="btn sm" onclick={() => (openId = openId === s.sessionId ? null : s.sessionId)}>
              <Icon name="timeline" size={13} /> {openId === s.sessionId ? 'Hide timeline' : 'Timeline'}
            </button>
            {#if openId === s.sessionId}
              <div class="tl">
                {#if tl.error}<div class="faint small">{tl.error.message}</div>
                {:else if !tl.data}<div class="skel" style="height:80px"></div>
                {:else}
                  <ol>
                    {#each tl.data.timeline || [] as ev, i (i)}
                      <li class="ev {ev.type}">
                        <span class="ic"><Icon name={ICON[ev.type] || 'dot'} size={11} /></span>
                        <div class="eb">
                          <div class="row" style="gap:6px">
                            <span class="faint tiny tnum">{fmtTime(ev.ts)}</span>
                            {#if ev.tool}<span class="badge">{ev.tool}</span>{/if}
                            {#if ev.path}<button class="fchip mono" onclick={() => openFile(ev.path, { drawer: true })}>{ev.path}</button>{/if}
                          </div>
                          {#if ev.text && ev.text !== ev.path}<div class="et">{ev.text}</div>{/if}
                        </div>
                      </li>
                    {/each}
                  </ol>
                {/if}
              </div>
            {/if}
          </article>
        {/each}
      </div>
      {#if list.length > 8}
        <div class="card-b"><button class="btn sm" onclick={() => (showAll = !showAll)}>{showAll ? 'Show fewer' : `Show all ${list.length}`}</button></div>
      {/if}
    {/if}
  </section>
</div>

<style>
  .stack { display: flex; flex-direction: column; gap: 14px; }
  .kp { display: flex; gap: 28px; flex-wrap: wrap; margin-bottom: 8px; }
  .big { font-size: 26px; font-weight: 700; letter-spacing: -0.03em; }
  .small { font-size: 12.5px; }
  .tiny { font-size: 11px; }
  .slist { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; padding: 0 16px 16px; align-items: start; }
  .sess { border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; background: var(--panel-hover); min-width: 0; align-items: flex-start; }
  .sess > * { max-width: 100%; }
  .sess.live { border-color: color-mix(in srgb, var(--ok) 35%, transparent); }
  .sess.open { grid-column: 1 / -1; }
  .sh { display: flex; align-items: center; gap: 8px; min-width: 0; width: 100%; }
  .st { font-weight: 600; }
  .prompt { font-size: 12.5px; color: var(--text-2); font-style: italic; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
  .sm-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
  .sm-row b { color: var(--text); }
  .tokbar { display: flex; height: 5px; border-radius: 99px; overflow: hidden; gap: 1px; }
  .tokbar span { min-width: 1px; }
  .files { display: flex; gap: 5px; flex-wrap: wrap; }
  .fchip { border: 1px solid var(--border); background: var(--panel-hover); border-radius: 7px; padding: 2px 7px; font-size: 11px; color: var(--text-2); cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fchip:hover { color: var(--text); border-color: var(--border-strong); }
  .fchip.hot { color: var(--err); border-color: color-mix(in srgb, var(--err) 50%, transparent); background: var(--err-soft); }
  .tl { width: 100%; max-height: 420px; overflow: auto; border-top: 1px solid var(--border); padding-top: 10px; }
  .tl ol { list-style: none; margin: 0; padding: 0 0 0 10px; border-left: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px; }
  .ev { display: flex; gap: 10px; position: relative; }
  .ic { position: absolute; left: -22px; top: 1px; width: 20px; height: 20px; border-radius: 50%; background: var(--panel-solid); border: 1px solid var(--border-strong); display: grid; place-items: center; color: var(--text-3); }
  .ev.prompt .ic { color: var(--accent); border-color: var(--accent); }
  .ev.edit .ic { color: var(--ok); }
  .ev.summary .ic { color: var(--info); }
  .eb { min-width: 0; padding-left: 8px; }
  .et { font-size: 12.5px; color: var(--text-2); overflow-wrap: anywhere; }
  .ev.prompt .et { color: var(--text); font-style: italic; }
  @media (max-width: 640px) { .slist { grid-template-columns: 1fr; padding: 0 10px 10px; } }
</style>
