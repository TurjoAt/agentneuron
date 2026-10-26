<script>
  import { api } from '../lib/api.js';
  import { app, openFile, isPulsing, navigate } from '../lib/store.svelte.js';
  import { resource } from '../lib/resource.svelte.js';
  import { KINDS } from '../lib/tools.js';
  import { TOOL_TOKEN_BUDGET } from '../lib/budget.js';
  import { fmtNum, timeAgo, basename, dirname, toMs } from '../lib/format.js';
  import { openTask, newFile } from '../lib/fileActions.js';
  import HealthRing from '../lib/HealthRing.svelte';
  import Counter from '../lib/Counter.svelte';
  import ActivityFeed from '../lib/ActivityFeed.svelte';
  import ToolBadge from '../lib/ToolBadge.svelte';
  import GitStatus from '../lib/GitStatus.svelte';
  import Icon from '../lib/Icon.svelte';
  import Empty from '../lib/Empty.svelte';
  import Kpi from './overview/Kpi.svelte';
  import ToolCard from './overview/ToolCard.svelte';
  import ActionBtn from './overview/ActionBtn.svelte';
  import NeuronBrain from './overview/NeuronBrain.svelte';
  import LiveAgents from './overview/LiveAgents.svelte';
  import TruthTeaser from './overview/TruthTeaser.svelte';
  import EntityLink from '../lib/EntityLink.svelte';

  let { params: _params } = $props();

  const DAY = 86_400_000;

  // ------------------------------------------------------------ data
  const setup = resource(() => api('/api/agents/setup'));
  const board = resource(() => api('/api/board'));
  const project = resource(() => api('/api/project'), { live: false });
  const gitInfo = resource(() => api('/api/git'));
  const healthFull = resource(() => api('/api/health'));
  const lessons = resource(() => api('/api/insights/lessons').catch(() => null), { live: false });
  const newLessons = $derived((lessons.data?.lessons || []).filter((l) => !l.alreadyCovered).length);
  const trends = resource(async () => {
    const to = Date.now();
    const from = to - 14 * DAY;
    const q = (metric) => api('/api/reports/series', { from, to, bucket: 'day', metric }).catch(() => null);
    const [summary, tokens, health, changes] = await Promise.all([
      api('/api/reports/summary', { from, to }).catch(() => null),
      q('tokens'),
      q('health'),
      q('changes'),
    ]);
    return { summary, tokens: tokens?.series?.[0]?.values, health: health?.series?.[0]?.values, changes: changes?.series?.[0]?.values };
  });

  const files = $derived(app.files);
  const fileByPath = $derived(new Map(files.map((f) => [f.path, f])));
  const totalTokens = $derived(files.reduce((a, f) => a + (f.tokens || 0), 0));
  const byKind = $derived.by(() => {
    const m = {};
    for (const f of files) m[f.kind] = (m[f.kind] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  });
  const changes24h = $derived(app.events.filter((e) => app.now - e.ts < DAY).length);
  const health = $derived(app.health || app.state?.health);
  const git = $derived(app.state?.git);

  // ------------------------------------------------------------ tools
  const tools = $derived(setup.data?.tools || []);
  const detected = $derived(tools.filter((t) => t.detected));
  const missing = $derived(tools.filter((t) => !t.detected));
  function toolTokens(t) {
    const seen = new Set();
    let n = 0;
    for (const f of t.files || []) {
      if (seen.has(f.path)) continue;
      seen.add(f.path);
      n += fileByPath.get(f.path)?.tokens || 0;
    }
    return n;
  }
  const issuesByTool = $derived.by(() => {
    const m = {};
    const owner = new Map();
    for (const t of tools) for (const f of t.files || []) owner.set(f.path, t.id);
    for (const i of healthFull.data?.issues || []) {
      const id = owner.get(i.path);
      if (!id) continue;
      const o = (m[id] ??= { error: 0, warn: 0 });
      if (i.severity === 'error') o.error++;
      else if (i.severity === 'warn') o.warn++;
    }
    return m;
  });

  // ------------------------------------------------------------ tasks
  const cols = $derived(board.data?.columns || []);
  const tasks = $derived(board.data?.tasks || []);
  const doneId = $derived(cols.find((c) => c.id === 'done')?.id ?? cols[cols.length - 1]?.id);
  const openTasks = $derived(tasks.filter((t) => t.status !== doneId));
  const PR = { urgent: 0, high: 1, med: 2, low: 3, none: 4 };
  const topTasks = $derived(
    [...openTasks].sort((a, b) => (PR[a.priority] ?? 4) - (PR[b.priority] ?? 4) || (toMs(a.due) || 9e15) - (toMs(b.due) || 9e15)).slice(0, 4)
  );
  const colCounts = $derived(cols.map((c) => ({ ...c, n: tasks.filter((t) => t.status === c.id).length })));
  const overdue = $derived(openTasks.filter((t) => t.due && toMs(t.due) < app.now - DAY).length);

  // ------------------------------------------------------------ misc
  const hot = $derived.by(() => {
    const m = new Map();
    for (const e of app.events) {
      if (e.type === 'unlink') continue;
      const h = m.get(e.path) || { path: e.path, count: 0, last: 0 };
      h.count++;
      h.last = Math.max(h.last, e.ts);
      m.set(e.path, h);
    }
    return [...m.values()].sort((a, b) => b.count - a.count || b.last - a.last).slice(0, 6);
  });
  const maxHot = $derived(Math.max(1, ...hot.map((h) => h.count)));
  const stacks = $derived((project.data?.stacks || []).slice(0, 14));
  const commits = $derived((gitInfo.data?.recent || []).slice(0, 3));
  const sum = $derived(trends.data?.summary);
  const tokensDelta = $derived(sum?.kpis ? [sum.kpis.tokensNow, sum.kpis.tokensNow - sum.kpis.tokensDelta] : [null, null]);
  const healthDelta = $derived(sum?.kpis ? [sum.kpis.healthNow, sum.kpis.healthNow - sum.kpis.healthDelta] : [null, null]);
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
              {#if k}<span class="faint"> & </span>{/if}<ToolBadge tool={a.tool} /> <span class="muted"><EntityLink kind="session" id={a.sessionId} label={a.title || a.sessionId?.slice(0, 8)} /></span>
            {/each}
          </div>
        {/each}
      </div>
      <a class="btn sm" href="#/agents?tab=radar">Radar</a>
    </div>
  {/if}

  <div class="page-h">
    <div>
      <h1>Overview</h1>
      <p>Your AI context at a glance — what every tool can see, what it costs, and what changed.</p>
    </div>
    <span class="spacer"></span>
    <div class="qa">
      <ActionBtn id="agents.create" params={{ template: 'claude-md' }} label="CLAUDE.md" icon="plus" cls="sm" />
      <ActionBtn id="agents.create" params={{ template: 'agents-md' }} label="AGENTS.md" icon="plus" cls="sm" />
      <button class="btn sm" onclick={() => newFile()}><Icon name="file" size={14} /> New file</button>
      <a class="btn sm" href="#/agents?tab=sync"><Icon name="merge" size={14} /> Sync tools</a>
      <ActionBtn id="agentneuron.rescan" label="Rescan" icon="refresh" cls="sm" opts={{ silent: false }} />
    </div>
  </div>

  <section class="kpis stagger" aria-label="Key metrics">
    <Kpi label="Tracked files" value={files.length} href="#/files" sub="{detected.length || '–'} tools · {byKind.length} kinds" />
    <Kpi label="Context tokens" value={totalTokens} href="#/reports" spark={trends.data?.tokens} color="var(--accent)" now={tokensDelta[0]} prev={tokensDelta[1]} sub="14-day trend" />
    <Kpi label="Health" value={health?.score ?? 0} suffix={health?.grade ? ` ${health.grade}` : ''} href="#/health" spark={trends.data?.health} color="var(--ok)" now={healthDelta[0]} prev={healthDelta[1]} sub="{health?.counts?.error ?? 0} errors · {health?.counts?.warn ?? 0} warnings" />
    <Kpi label="Open tasks" value={openTasks.length} href="#/tasks" sub={board.error ? 'board unavailable' : board.data ? `${overdue} overdue · ${tasks.length - openTasks.length} done` : ''} />
    <Kpi label="Uncommitted" value={git?.available ? git.dirty || 0 : 0} href="#/git" sub={git?.available ? `on ${git.branch}` : 'git unavailable'} />
    <Kpi label="Changes · 24h" value={changes24h} href="#/reports" spark={trends.data?.changes} color="var(--tool-claude)" sub="14-day activity" />
  </section>

  {#if newLessons}
    <a class="card tease" href="#/insights?tab=lessons"><Icon name="sparkles" size={15} /> <b class="tnum">{newLessons}</b> {newLessons === 1 ? 'lesson' : 'lessons'} to learn from your agent sessions<span class="spacer"></span><span class="faint">Insights →</span></a>
  {/if}

  <div class="grid">
    <div class="side stagger">
      <NeuronBrain />
      <section class="card activity">
        <div class="card-h">
          <span class="live-dot"></span> Live activity
          <span class="sub">{app.events.length} events</span>
        </div>
        <div class="card-b feed-wrap"><ActivityFeed limit={30} /></div>
      </section>
    </div>

    <div class="side stagger">
      <LiveAgents />
      <TruthTeaser />
      <section class="card">
        <div class="card-h">Context health <span class="sub">lint + secret scan</span></div>
        <div class="hb">
          <HealthRing score={health?.score ?? 0} grade={health?.grade ?? '–'} size={112} stroke={9} />
          <div class="sev">
            {#each [['error', 'Errors', 'err'], ['warn', 'Warnings', 'warn'], ['info', 'Info', 'info']] as [k, label, cls] (k)}
              <a class="sev-row" href="#/health?severity={k}">
                <span class="sd {cls}"></span><span class="grow">{label}</span>
                <b class="tnum"><Counter value={health?.counts?.[k] ?? 0} /></b>
              </a>
            {/each}
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-h">Tasks <span class="sub">{openTasks.length} open</span><span class="spacer"></span><a class="btn sm ghost" href="#/tasks?tab=board">Board</a></div>
        <div class="card-b col" style="gap:10px">
          {#if colCounts.length}
            <div class="stk" aria-label="Tasks per column">
              {#each colCounts as c, i (c.id)}
                <span style="flex:{c.n || 0.001};opacity:{0.35 + (0.65 * (i + 1)) / colCounts.length}" title="{c.title}: {c.n}"></span>
              {/each}
            </div>
            <div class="legend">
              {#each colCounts as c (c.id)}<span class="faint small">{c.title} <b class="tnum">{c.n}</b></span>{/each}
            </div>
          {/if}
          {#each topTasks as t (t.id)}
            <button class="list-row trow" onclick={() => openTask(t.id)}>
              <span class="pr {t.priority}"></span>
              <span class="grow ellipsis small">{t.title}</span>
              {#if t.due}<span class="faint tiny">{t.due}</span>{/if}
            </button>
          {:else}
            {#if board.error}
              <div class="faint small">Could not load tasks: {board.error.message}</div>
            {:else if board.data}
              <Empty compact icon="check" title="All clear">No open tasks.</Empty>
            {:else}
              <div class="skel-rows" aria-label="Loading tasks">{#each [0, 1, 2] as i (i)}<span class="skel"></span>{/each}</div>
            {/if}
          {/each}
        </div>
      </section>

      <section class="card">
        <div class="card-h"><Icon name="branch" size={14} /> Git <span class="sub">{git?.available ? git.branch : 'unavailable'}</span><span class="spacer"></span><a class="btn sm ghost" href="#/git">Open</a></div>
        <div class="card-b col" style="gap:8px">
          {#if git?.available}
            <a class="gline" href="#/git"><b class="tnum">{git.dirty || 0}</b> <span class="muted">uncommitted {git.dirty === 1 ? 'change' : 'changes'}</span></a>
            {#each commits as c (c.hash)}
              <a class="gline" href="#/git">
                <code class="mono tiny">{(c.short || c.hash || '').slice(0, 7)}</code>
                <span class="ellipsis small grow">{c.subject || c.message}</span>
                <span class="faint tiny">{timeAgo(toMs(c.date || c.ts), app.now)}</span>
              </a>
            {/each}
          {:else}
            <div class="faint small">This folder is not a git repository.</div>
          {/if}
        </div>
      </section>
    </div>
  </div>

  <section class="sec">
    <div class="sec-h">
      <h2>AI tools</h2>
      <span class="faint small">{detected.length} detected · instruction tokens vs {fmtNum(TOOL_TOKEN_BUDGET)} budget</span>
      <span class="spacer"></span>
      <a class="btn sm ghost" href="#/agents?tab=matrix">Capability matrix <Icon name="chevron" size={13} /></a>
    </div>
    {#if setup.error}
      <div class="card pad faint small">Could not load the agent setup: {setup.error.message}</div>
    {:else if !setup.data}
      <div class="tgrid stagger">{#each [0, 1, 2] as i (i)}<div class="skel" style="height:128px"></div>{/each}</div>
    {:else}
      <div class="tgrid stagger">
        {#each detected as t (t.id)}
          <ToolCard tool={t} tokens={toolTokens(t)} budget={TOOL_TOKEN_BUDGET} issues={issuesByTool[t.id] || { error: 0, warn: 0 }} />
        {:else}
          <div class="card pad faint small">No AI tool configuration found yet. Create a CLAUDE.md or AGENTS.md to get started.</div>
        {/each}
      </div>
      {#if missing.length}
        <div class="miss">
          <span class="faint small">Not set up:</span>
          {#each missing as t (t.id)}
            <a class="chip" href="#/agents?tab=templates&tool={t.id}"><Icon name="plus" size={11} /> {t.name}</a>
          {/each}
        </div>
      {/if}
    {/if}
  </section>

  <div class="grid2 stagger">
    <section class="card">
      <div class="card-h"><Icon name="layers" size={14} /> Project stack <span class="spacer"></span><a class="btn sm ghost" href="#/project">Details</a></div>
      <div class="card-b stacks">
        {#each stacks as s (s.id)}
          <a class="chip" href="#/project" title={s.source}>{s.name}{#if s.version}<span class="n">{s.version}</span>{/if}</a>
        {:else}
          {#if project.error}
            <span class="faint small">Could not detect the stack.</span>
          {:else if project.data}
            <span class="faint small">No stack detected.</span>
          {:else}
            {#each [64, 88, 52, 76, 60] as w, i (i)}<span class="skel chip-sk" style="width:{w}px"></span>{/each}
          {/if}
        {/each}
      </div>
      <div class="card-b kinds">
        {#each byKind as [k, n] (k)}
          <a class="chip" href="#/files?kind={k}">{KINDS[k] || k} <span class="n">{n}</span></a>
        {/each}
      </div>
    </section>

    <section class="card">
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
          <Empty compact icon="flame" title="Nothing hot yet">Files that change most often will rise here.</Empty>
        {/each}
      </div>
    </section>
  </div>
</div>

<style>
  .tease { display: flex; align-items: center; gap: 8px; padding: 10px 16px; margin-bottom: 16px; color: inherit; text-decoration: none; }
  .tease:hover { border-color: var(--border-strong); text-decoration: none; }
  .qa { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .kpis { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; margin-bottom: 22px; }
  .sec { margin-bottom: 22px; }
  .sec-h { display: flex; align-items: baseline; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
  .sec-h h2 { margin: 0; font-size: 15px; font-weight: 650; letter-spacing: -0.01em; }
  .tgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
  .miss { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 12px; }
  .miss .chip { text-decoration: none; }
  .pad { padding: 16px; }
  .small { font-size: 12px; }
  .tiny { font-size: 11px; }
  .grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 16px; margin-bottom: 22px; align-items: start; }
  .grid2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
  .side { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .activity { display: flex; flex-direction: column; }
  .feed-wrap { overflow: auto; max-height: 460px; }
  .hb { display: flex; align-items: center; gap: 20px; padding: 4px 18px 18px; flex-wrap: wrap; }
  .sev { flex: 1; min-width: 150px; display: flex; flex-direction: column; gap: 2px; }
  .sev-row { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-radius: 9px; color: var(--text-2); font-size: 13px; text-decoration: none; }
  .sev-row:hover { background: var(--panel-hover); color: var(--text); text-decoration: none; }
  .sev-row b { color: var(--text); font-size: 15px; }
  .sd { width: 9px; height: 9px; border-radius: 3px; }
  .sd.err { background: var(--err); box-shadow: 0 0 10px var(--err); }
  .sd.warn { background: var(--warn); }
  .sd.info { background: var(--info); }
  .stk { display: flex; height: 8px; border-radius: 99px; overflow: hidden; gap: 2px; background: var(--panel-active); }
  .stk span { background: var(--accent); min-width: 2px; transition: flex 0.5s var(--ease); }
  .legend { display: flex; gap: 12px; flex-wrap: wrap; }
  .trow { padding: 6px 4px; gap: 9px; }
  .pr { width: 8px; height: 8px; border-radius: 50%; background: var(--text-3); flex-shrink: 0; }
  .pr.urgent { background: var(--err); }
  .pr.high { background: var(--warn); }
  .pr.med { background: var(--info); }
  .gline { display: flex; align-items: center; gap: 9px; color: inherit; text-decoration: none; min-width: 0; font-size: 13px; }
  .gline:hover { text-decoration: none; color: var(--accent); }
  .stacks { display: flex; flex-wrap: wrap; gap: 6px; }
  .stacks .chip, .kinds .chip { text-decoration: none; }
  .chip-sk { height: 24px; border-radius: 99px; }
  .kinds { display: flex; flex-wrap: wrap; gap: 6px; border-top: 1px solid var(--border); padding-top: 14px; }
  .live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); animation: live 2s infinite; }
  @keyframes live {
    0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ok) 60%, transparent); }
    70% { box-shadow: 0 0 0 7px transparent; }
    100% { box-shadow: 0 0 0 0 transparent; }
  }
  .hrow { padding: 8px; }
  .heat { height: 3px; border-radius: 3px; background: var(--panel-active); overflow: hidden; display: block; }
  .heat span { display: block; height: 100%; background: linear-gradient(90deg, var(--accent-2), var(--err)); border-radius: inherit; transition: width 0.6s var(--ease); }
  .conflict { display: flex; align-items: center; gap: 14px; padding: 14px 16px; margin-bottom: 16px; border-color: color-mix(in srgb, var(--err) 45%, transparent); background: linear-gradient(90deg, var(--err-soft), var(--panel)); }
  .cicon { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--err-soft); color: var(--err); }
  .ct { font-weight: 650; color: var(--err); }
  .cd { font-size: 13px; color: var(--text-2); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 3px; }
  .lnk { border: 0; background: none; color: var(--text); font-weight: 600; cursor: pointer; padding: 0; }
  .lnk:hover { color: var(--accent); }

  @media (max-width: 1280px) { .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  @media (max-width: 900px) {
    .grid, .grid2 { grid-template-columns: 1fr; }
    .feed-wrap { max-height: 420px; }
  }
  @media (max-width: 520px) {
    .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .qa { width: 100%; }
  }
</style>
