<script>
  import { app, openFile, isPulsing } from '../lib/store.svelte.js';
  import { TOOLS, TOOL_ORDER, KINDS, toolOf } from '../lib/tools.js';
  import { fmtNum, timeAgo, basename, dirname } from '../lib/format.js';
  import HealthRing from '../lib/HealthRing.svelte';
  import Counter from '../lib/Counter.svelte';
  import ActivityFeed from '../lib/ActivityFeed.svelte';
  import ToolBadge from '../lib/ToolBadge.svelte';
  import GitStatus from '../lib/GitStatus.svelte';
  import TokenBar from '../lib/TokenBar.svelte';
  import Icon from '../lib/Icon.svelte';

  let { params: _params } = $props();

  const files = $derived(app.files);
  const totalTokens = $derived(files.reduce((a, f) => a + (f.tokens || 0), 0));
  const byTool = $derived.by(() => {
    const m = {};
    for (const f of files) {
      const t = toolOf(f.tool);
      m[t] ??= { tool: t, files: 0, tokens: 0 };
      m[t].files++;
      m[t].tokens += f.tokens || 0;
    }
    return TOOL_ORDER.map((t) => m[t]).filter(Boolean);
  });
  const maxToolTokens = $derived(Math.max(1, ...byTool.map((t) => t.tokens)));
  const byKind = $derived.by(() => {
    const m = {};
    for (const f of files) m[f.kind] = (m[f.kind] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  });

  const DAY = 86_400_000;
  const changes24h = $derived(app.events.filter((e) => app.now - e.ts < DAY).length);
  const activeAgents = $derived(new Set(app.events.filter((e) => e.agent && app.now - e.ts < 30 * 60_000).map((e) => e.agent.sessionId)).size);

  // hottest files: churn from the event ring
  const hot = $derived.by(() => {
    const m = new Map();
    for (const e of app.events) {
      if (e.type === 'unlink') continue;
      const h = m.get(e.path) || { path: e.path, count: 0, churn: 0, last: 0 };
      h.count++;
      h.churn += (e.stats?.added || 0) + (e.stats?.removed || 0);
      h.last = Math.max(h.last, e.ts);
      m.set(e.path, h);
    }
    return [...m.values()].sort((a, b) => b.count - a.count || b.churn - a.churn).slice(0, 7);
  });
  const maxHot = $derived(Math.max(1, ...hot.map((h) => h.count)));

  // sparkline: events per 2-min bucket over the last hour
  const spark = $derived.by(() => {
    const buckets = new Array(30).fill(0);
    for (const e of app.events) {
      const age = app.now - e.ts;
      if (age < 0 || age >= 3600_000) continue;
      buckets[29 - Math.floor(age / 120_000)]++;
    }
    return buckets;
  });
  const sparkMax = $derived(Math.max(1, ...spark));

  const health = $derived(app.health || app.state?.health);
  const git = $derived(app.state?.git);
  const fileByPath = $derived(new Map(files.map((f) => [f.path, f])));
</script>

<div class="page">
  {#if app.conflicts.length}
    <div class="conflict card fade-up">
      <span class="cicon"><Icon name="radar" size={18} /></span>
      <div class="grow">
        <div class="ct">Parallel-agent conflict</div>
        {#each app.conflicts as c (c.path)}
          <div class="cd">
            <button class="lnk mono" onclick={() => openFile(c.path, { drawer: true })}>{c.path}</button>
            is being edited by
            {#each c.agents || [] as a, k (a.sessionId + k)}
              {#if k}<span class="faint"> & </span>{/if}<ToolBadge tool={a.tool} /> <span class="muted">{a.title || a.sessionId?.slice(0, 8)}</span>
            {/each}
          </div>
        {/each}
      </div>
      <a class="btn sm" href="#/agents">Radar</a>
    </div>
  {/if}

  <div class="grid">
    <section class="card health-card">
      <div class="card-h">Context health <span class="sub">live lint + secret scan</span></div>
      <div class="hb">
        <HealthRing score={health?.score ?? 0} grade={health?.grade ?? '–'} />
        <div class="sev">
          {#each [['error', 'Errors', 'err'], ['warn', 'Warnings', 'warn'], ['info', 'Info', 'info']] as [k, label, cls] (k)}
            <a class="sev-row" href="#/health?severity={k}">
              <span class="sd {cls}"></span>
              <span class="grow">{label}</span>
              <b class="tnum"><Counter value={health?.counts?.[k] ?? 0} /></b>
            </a>
          {/each}
          <a class="btn sm" href="#/health" style="margin-top:6px">Open health report <Icon name="chevron" size={13} /></a>
        </div>
      </div>
    </section>

    <section class="stats">
      <div class="card stat">
        <div class="eyebrow">Tracked files</div>
        <div class="big"><Counter value={files.length} /></div>
        <div class="faint small">{byTool.length} tools · {byKind.length} kinds</div>
      </div>
      <div class="card stat">
        <div class="eyebrow">Context tokens</div>
        <div class="big"><Counter value={totalTokens} /></div>
        <div class="faint small">≈ total across all files</div>
      </div>
      <div class="card stat">
        <div class="eyebrow">Changes · 24h</div>
        <div class="big"><Counter value={changes24h} /></div>
        <svg class="spark" viewBox="0 0 120 24" preserveAspectRatio="none" aria-label="Changes over the last hour">
          {#each spark as v, i (i)}
            <rect x={i * 4 + 0.5} y={24 - (v / sparkMax) * 22 - 1} width="3" height={(v / sparkMax) * 22 + 1} rx="1" class:hot={v > 0} />
          {/each}
        </svg>
      </div>
      <div class="card stat">
        <div class="eyebrow">Active agents · 30m</div>
        <div class="big"><Counter value={activeAgents} /></div>
        <div class="faint small">
          {#if git?.available}<Icon name="branch" size={12} /> <span class="mono">{git.branch}</span>{#if git.dirty} · <span class="warn">{git.dirty} dirty</span>{/if}{:else}git unavailable{/if}
        </div>
      </div>
    </section>

    <section class="card tools">
      <div class="card-h">By tool <span class="sub">files · tokens</span></div>
      <div class="card-b col" style="gap:12px">
        {#each byTool as t (t.tool)}
          <a class="trow" href="#/files?tool={t.tool}">
            <div class="row">
              <ToolBadge tool={t.tool} />
              <span class="spacer"></span>
              <span class="faint small tnum">{t.files} files</span>
              <b class="tnum small">{fmtNum(t.tokens)}</b>
            </div>
            <TokenBar value={t.tokens} max={maxToolTokens} tool={t.tool} />
          </a>
        {/each}
      </div>
      <div class="card-b kinds">
        {#each byKind as [k, n] (k)}
          <a class="chip" href="#/files?kind={k}">{KINDS[k] || k} <span class="n">{n}</span></a>
        {/each}
      </div>
    </section>

    <section class="card activity">
      <div class="card-h">
        <span class="live-dot"></span> Live activity
        <span class="sub">{app.events.length} events</span>
      </div>
      <div class="card-b feed-wrap">
        <ActivityFeed limit={30} />
      </div>
    </section>

    <section class="card hot">
      <div class="card-h"><Icon name="flame" size={15} /> Hottest files <span class="sub">by recent changes</span></div>
      <div class="card-b col" style="gap:2px">
        {#each hot as h (h.path)}
          {@const f = fileByPath.get(h.path)}
          <button class="list-row hrow" class:pulse-row={isPulsing(h.path)} onclick={() => openFile(h.path, { drawer: true })}>
            <ToolBadge tool={f?.tool} compact />
            <span class="grow col" style="gap:3px">
              <span class="row" style="gap:6px">
                <span class="mono ellipsis small"><span class="faint">{dirname(h.path) ? dirname(h.path) + '/' : ''}</span>{basename(h.path)}</span>
                <GitStatus status={f?.gitStatus} />
              </span>
              <span class="heat"><span style="width:{(h.count / maxHot) * 100}%"></span></span>
            </span>
            <span class="col" style="gap:0;align-items:flex-end">
              <b class="tnum small">{h.count}×</b>
              <span class="faint tiny">{timeAgo(h.last, app.now)}</span>
            </span>
          </button>
        {:else}
          <div class="faint small" style="padding:12px 4px">No changes recorded yet.</div>
        {/each}
      </div>
    </section>
  </div>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: 16px;
  }
  .health-card { grid-column: span 5; }
  .stats { grid-column: span 7; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .tools { grid-column: span 4; }
  .activity { grid-column: span 5; grid-row: span 2; display: flex; flex-direction: column; }
  .hot { grid-column: span 3; }
  .hb { display: flex; align-items: center; gap: 26px; padding: 6px 20px 20px; flex-wrap: wrap; }
  .sev { flex: 1; min-width: 160px; display: flex; flex-direction: column; gap: 4px; }
  .sev-row { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 9px; color: var(--text-2); font-size: 13px; text-decoration: none; }
  .sev-row:hover { background: var(--panel-hover); color: var(--text); text-decoration: none; }
  .sev-row b { color: var(--text); font-size: 15px; }
  .sd { width: 9px; height: 9px; border-radius: 3px; }
  .sd.err { background: var(--err); box-shadow: 0 0 10px var(--err); }
  .sd.warn { background: var(--warn); }
  .sd.info { background: var(--info); }
  .stat { padding: 16px 18px; display: flex; flex-direction: column; gap: 4px; overflow: hidden; }
  .big { font-size: 32px; font-weight: 700; letter-spacing: -0.035em; line-height: 1.15; }
  .small { font-size: 12px; }
  .tiny { font-size: 11px; }
  .warn { color: var(--warn); }
  .spark { width: 100%; height: 24px; margin-top: 2px; }
  .spark rect { fill: var(--border-strong); transition: y 0.5s var(--ease), height 0.5s var(--ease); }
  .spark rect.hot { fill: var(--accent); }
  .trow { display: flex; flex-direction: column; gap: 7px; color: inherit; text-decoration: none; border-radius: 8px; }
  .trow:hover { text-decoration: none; }
  .trow:hover :global(.tb) { filter: brightness(1.2); }
  .kinds { display: flex; flex-wrap: wrap; gap: 6px; border-top: 1px solid var(--border); padding-top: 14px; }
  .kinds .chip { text-decoration: none; }
  .feed-wrap { flex: 1; overflow: auto; max-height: 620px; }
  .live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 0 var(--ok); animation: live 2s infinite; }
  @keyframes live {
    0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ok) 60%, transparent); }
    70% { box-shadow: 0 0 0 7px transparent; }
    100% { box-shadow: 0 0 0 0 transparent; }
  }
  .hrow { padding: 8px; }
  .heat { height: 3px; border-radius: 3px; background: var(--panel-active); overflow: hidden; display: block; }
  .heat span { display: block; height: 100%; background: linear-gradient(90deg, var(--accent-2), var(--err)); border-radius: inherit; transition: width 0.6s var(--ease); }
  .conflict {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 16px;
    margin-bottom: 16px;
    border-color: color-mix(in srgb, var(--err) 45%, transparent);
    background: linear-gradient(90deg, var(--err-soft), var(--panel));
  }
  .cicon { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--err-soft); color: var(--err); animation: alarm 1.6s infinite; }
  @keyframes alarm { 50% { box-shadow: 0 0 0 6px transparent, 0 0 22px color-mix(in srgb, var(--err) 50%, transparent); } }
  .ct { font-weight: 650; color: var(--err); }
  .cd { font-size: 13px; color: var(--text-2); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 3px; }
  .lnk { border: 0; background: none; color: var(--text); font-weight: 600; cursor: pointer; padding: 0; }
  .lnk:hover { color: var(--accent); }

  @media (max-width: 1280px) {
    .health-card { grid-column: span 12; }
    .stats { grid-column: span 12; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .tools { grid-column: span 5; }
    .activity { grid-column: span 7; }
    .hot { grid-column: span 5; }
  }
  @media (max-width: 900px) {
    .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .tools, .activity, .hot { grid-column: span 12; grid-row: auto; }
    .feed-wrap { max-height: 440px; }
  }
  @media (max-width: 420px) {
    .grid, .stats { gap: 10px; }
    .big { font-size: 26px; }
    .hb { justify-content: center; }
  }
</style>
