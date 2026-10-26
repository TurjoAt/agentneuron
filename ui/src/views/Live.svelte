<script>
  // Live: what every agent is editing right now, one swimlane per agent family.
  import { untrack } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { app, openFile, fileIndex, navigate, saveLocal } from '../lib/store.svelte.js';
  import { live, loadLive, LANES, laneOf, colorTool, skey } from '../lib/live.svelte.js';
  import { basename, timeAgo } from '../lib/format.js';
  import { dur } from '../lib/motion.js';
  import ToolBadge from '../lib/ToolBadge.svelte';
  import Icon from '../lib/Icon.svelte';
  import Empty from '../lib/Empty.svelte';
  import EditCard from './live/EditCard.svelte';
  import HeatStrip from './live/HeatStrip.svelte';
  import SidePanel from './live/SidePanel.svelte';

  let { params = {} } = $props();

  const PAGE = 60;
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
  const init = untrack(() => ({ ...params }));
  let agent = $state(init.agent || 'all');
  let session = $state(init.session || '');
  let fileQ = $state(init.file || '');
  let showCmds = $state(load('agentneuron.live.cmds', true));
  let auto = $state(load('agentneuron.live.auto', true));
  let minutes = $state(load('agentneuron.live.minutes', 15));
  let paused = $state(false);
  let frozen = $state.raw(null);
  let limits = $state({});
  let lanesRoot = $state(null);

  $effect(() => { untrack(() => loadLive()); });
  $effect(() => saveLocal('agentneuron.live.cmds', showCmds));
  $effect(() => saveLocal('agentneuron.live.auto', auto));
  $effect(() => saveLocal('agentneuron.live.minutes', minutes));

  function togglePause() {
    paused = !paused;
    frozen = paused ? { edits: live.edits, commands: live.commands, seq: live.seq } : null;
  }
  const src = $derived(frozen || { edits: live.edits, commands: live.commands });
  const behind = $derived(frozen ? live.seq - frozen.seq : 0);
  const bySession = $derived(new Map(live.sessions.map((s) => [skey(s), s])));
  const recentColl = $derived.by(() => {
    const m = new Set();
    for (const c of live.collisions) if (app.now - (c.at || c.ts) < 10 * 60000) m.add(c.path);
    return m;
  });
  const collisions = $derived(live.collisions.filter((c) => app.now - (c.at || c.ts) < 10 * 60000).slice(-4).reverse());

  const match = (it) => {
    if (agent !== 'all' && laneOf(it.tool) !== agent) return false;
    if (session && `${it.tool}:${it.sessionId}` !== session) return false;
    if (fileQ && (it.path === undefined || !it.path.toLowerCase().includes(fileQ.toLowerCase()))) return false;
    return true;
  };
  const items = $derived.by(() => {
    const all = showCmds && !fileQ ? src.edits.concat(src.commands) : src.edits;
    return all.filter(match).sort((a, b) => b.ts - a.ts);
  });
  const lanes = $derived.by(() => {
    const g = Object.fromEntries(LANES.map((l) => [l.id, []]));
    for (const it of items) g[laneOf(it.tool)].push(it);
    return g;
  });
  const visibleLanes = $derived(agent === 'all' ? LANES : LANES.filter((l) => l.id === agent));
  const laneSessions = (id) => live.sessions.filter((s) => s.state !== 'end' && laneOf(s.tool) === id).length;
  const counts = $derived.by(() => {
    const c = { all: 0 };
    for (const e of src.edits) { c.all++; const l = laneOf(e.tool); c[l] = (c[l] || 0) + 1; }
    return c;
  });
  const nowEditing = $derived(
    Object.entries(live.editors)
      .filter(([, e]) => app.now - e.ts < 60000)
      .sort((a, b) => b[1].ts - a[1].ts)
      .slice(0, 12)
      .map(([path, e]) => ({ path, ...e }))
  );
  const activeSessions = $derived(live.sessions.filter((s) => s.state === 'active' || s.state === 'start').length);
  const sessionOptions = $derived(live.sessions.filter((s) => s.state !== 'end' || session === skey(s)));

  // auto-scroll: keep each lane pinned to the newest card when new items arrive
  $effect(() => {
    void items.length;
    if (!auto || paused) return;
    untrack(() => { for (const el of lanesRoot?.querySelectorAll('.lb') || []) if (el.scrollTop > 0) el.scrollTo({ top: 0, behavior: dur(1) ? 'smooth' : 'auto' }); });
  });

  function openPath(p) {
    if (fileIndex().set.has(p)) openFile(p, { drawer: true });
    else navigate('files', { path: p });
  }
</script>

<div class="page live">
  <div class="page-h">
    <div>
      <h1><span class="live-dot" class:off={app.conn !== 'live'}></span> Live</h1>
      <p>Files your agents are editing right now, from their Claude Code and Codex transcripts, checked against the file watcher.</p>
    </div>
    <span class="spacer"></span>
    <div class="ctl">
      <button class="btn sm" class:primary={paused} onclick={togglePause} aria-pressed={paused}>
        <Icon name={paused ? 'play' : 'stop'} size={13} />{paused ? `Resume${behind ? ` (${behind} new)` : ''}` : 'Pause'}
      </button>
      <label class="tg"><input type="checkbox" bind:checked={auto} /> Auto-scroll</label>
      <label class="tg"><input type="checkbox" bind:checked={showCmds} /> Commands</label>
    </div>
  </div>

  {#if live.unsupported}
    <Empty icon="activity" title="Live view needs a newer server">This AgentNeuron server has no <code>/api/live</code> route.</Empty>
  {:else}
    <section class="card now">
      <div class="nh">
        <span class="eyebrow">Now editing</span>
        <span class="faint small">{activeSessions} active {activeSessions === 1 ? 'session' : 'sessions'}</span>
      </div>
      <div class="chips">
        {#each nowEditing as e (e.path)}
          <button class="fchip" style="--c:var(--tool-{colorTool(e.tool)})" onclick={() => openPath(e.path)} title="{e.path} — {e.op} by {e.tool}{e.sessionId ? ' ' + e.sessionId.slice(0, 8) : ''}, {timeAgo(e.ts, app.now)}">
            <span class="pdot" class:hot={app.now - e.ts < 8000}></span>{basename(e.path)}
          </button>
        {:else}
          <span class="faint small">Nobody is editing right now.</span>
        {/each}
      </div>
      <div class="nh hs">
        <span class="eyebrow">Heat</span>
        <div class="segc" role="group" aria-label="Heat window">
          {#each [5, 15, 60] as m (m)}<button class:on={minutes === m} onclick={() => (minutes = m)}>{m}m</button>{/each}
        </div>
      </div>
      <HeatStrip edits={live.edits} {minutes} active={fileQ} onpick={(p) => (fileQ = fileQ === p ? '' : p)} />
    </section>

    {#each collisions as c (c.reason + c.path + c.ts)}
      <div class="coll card" role="alert">
        <Icon name="alert" size={15} />
        {#if c.reason === 'claim'}
          <span><button class="lnk mono" onclick={() => openPath(c.path)}>{c.path}</button> was edited by <ToolBadge tool={c.sessions?.[0]?.tool} compact /> {c.sessions?.[0]?.title || c.sessions?.[0]?.sessionId?.slice(0, 8)} while <b>{c.claim?.agent}</b> holds a claim on <code>{c.claim?.pattern}</code>.</span>
        {:else}
          <span><button class="lnk mono" onclick={() => openPath(c.path)}>{c.path}</button> is being edited by {c.sessions?.length || 2} sessions:
            {#each c.sessions || [] as s, k (s.sessionId + k)}{#if k}<span class="faint"> & </span>{/if}<ToolBadge tool={s.tool} compact /> {s.title || s.promptTitle || s.sessionId?.slice(0, 8)}{/each}</span>
        {/if}
        <span class="spacer"></span><span class="faint tiny">{timeAgo(c.at || c.ts, app.now)}</span>
      </div>
    {/each}

    <div class="filters">
      <div class="segc" role="group" aria-label="Agent">
        <button class:on={agent === 'all'} onclick={() => (agent = 'all')}>All <span class="n">{counts.all}</span></button>
        {#each LANES as l (l.id)}
          <button class:on={agent === l.id} onclick={() => (agent = l.id)}><span class="tool-dot" style="background:var(--tool-{l.tool})"></span>{l.label.split(' ')[0]} <span class="n">{counts[l.id] || 0}</span></button>
        {/each}
      </div>
      <select class="input sm" bind:value={session} aria-label="Session">
        <option value="">All sessions</option>
        {#each sessionOptions as s (skey(s))}<option value={skey(s)}>{s.tool} · {(s.title || s.promptTitle || s.sessionId).slice(0, 40)}</option>{/each}
      </select>
      <input class="input sm" placeholder="Filter by file…" bind:value={fileQ} aria-label="Filter by file" />
      {#if agent !== 'all' || session || fileQ}<button class="btn sm ghost" onclick={() => ((agent = 'all'), (session = ''), (fileQ = ''))}>Clear</button>{/if}
    </div>

    <div class="main">
      <div class="lanes" style="--n:{visibleLanes.length}" bind:this={lanesRoot}>
        {#each visibleLanes as l (l.id)}
          {@const list = lanes[l.id]}
          {@const lim = limits[l.id] || PAGE}
          <section class="lane" aria-label="{l.label} lane">
            <div class="lh" style="--c:var(--tool-{l.tool})">
              <span class="tool-dot" style="background:var(--tool-{l.tool})"></span><b>{l.label}</b>
              <span class="faint small tnum">{list.length}</span>
              <span class="spacer"></span>
              {#if laneSessions(l.id)}<span class="badge ok">{laneSessions(l.id)} live</span>{/if}
            </div>
            <div class="lb">
              {#each list.slice(0, lim) as it (it.id)}
                <div in:fly={{ y: -10, duration: dur(320), easing: cubicOut }}>
                  <EditCard item={it} session={bySession.get(`${it.tool}:${it.sessionId}`)} collide={it.cmd === undefined && recentColl.has(it.path)} />
                </div>
              {:else}
                <div class="le faint small">{l.id === 'human' ? 'Changes the watcher sees without an agent transcript land here.' : 'No activity yet.'}</div>
              {/each}
              {#if list.length > lim}<button class="btn sm ghost more" onclick={() => (limits = { ...limits, [l.id]: lim + PAGE })}>Show {Math.min(PAGE, list.length - lim)} more</button>{/if}
            </div>
          </section>
        {/each}
      </div>
      <aside class="side"><SidePanel sessionFilter={session} onsession={(k) => (session = k)} /></aside>
    </div>
  {/if}
</div>

<style>
  .live h1 { display: flex; align-items: center; gap: 9px; }
  .live-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 0 color-mix(in srgb, var(--ok) 60%, transparent); animation: ring 2s infinite; }
  .live-dot.off { background: var(--text-3); animation: none; }
  .ctl { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .tg { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-2); cursor: pointer; }
  .now { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
  .nh { display: flex; align-items: center; gap: 10px; }
  .hs { margin-top: 4px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; min-height: 26px; }
  .fchip { display: inline-flex; align-items: center; gap: 7px; height: 26px; padding: 0 10px; border-radius: 99px; border: 1px solid color-mix(in srgb, var(--c) 45%, var(--border)); background: color-mix(in srgb, var(--c) 12%, transparent); color: var(--text); font-size: 12px; font-weight: 550; cursor: pointer; }
  .fchip:hover { background: color-mix(in srgb, var(--c) 22%, transparent); }
  .pdot { width: 7px; height: 7px; border-radius: 50%; background: var(--c); }
  .pdot.hot { animation: pulse 1.2s ease-out infinite; }
  .coll { display: flex; align-items: center; gap: 10px; padding: 9px 12px; margin-bottom: 8px; border-color: color-mix(in srgb, var(--warn) 50%, var(--border)); background: color-mix(in srgb, var(--warn) 8%, var(--panel)); color: var(--text); font-size: 12.5px; }
  .coll :global(svg) { color: var(--warn); flex-shrink: 0; }
  .lnk { border: 0; background: none; padding: 0; color: var(--accent); cursor: pointer; font: inherit; }
  .filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 14px 0 10px; }
  .filters .input.sm { height: 30px; font-size: 12px; max-width: 240px; }
  .segc .n { color: var(--text-3); font-variant-numeric: tabular-nums; }
  .main { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 14px; align-items: start; }
  .lanes { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 10px; }
  .lane { display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--border); border-radius: var(--radius); background: color-mix(in srgb, var(--panel) 60%, transparent); }
  .lh { display: flex; align-items: center; gap: 7px; padding: 9px 11px; border-bottom: 1px solid var(--border); font-size: 12.5px; box-shadow: inset 0 2px 0 var(--c); border-radius: var(--radius) var(--radius) 0 0; }
  .lb { display: flex; flex-direction: column; gap: 6px; padding: 8px; max-height: calc(100vh - 330px); min-height: 160px; overflow-y: auto; overscroll-behavior: contain; }
  .le { padding: 18px 6px; text-align: center; }
  .more { align-self: center; }
  @keyframes ring { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ok) 55%, transparent); } 70%, 100% { box-shadow: 0 0 0 7px transparent; } }
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--c) 70%, transparent); } 100% { box-shadow: 0 0 0 7px transparent; } }
  @media (max-width: 1500px) { .lanes { grid-template-columns: repeat(min(var(--n), 2), minmax(0, 1fr)); } .lb { max-height: 520px; } }
  @media (max-width: 1100px) { .main { grid-template-columns: minmax(0, 1fr); } }
  @media (max-width: 700px) { .lanes { grid-template-columns: minmax(0, 1fr); } .filters .segc { max-width: 100%; overflow-x: auto; scrollbar-width: none; } .filters .segc button { flex-shrink: 0; } }
  @media (prefers-reduced-motion: reduce) { .live-dot, .pdot.hot { animation: none; } }
</style>
