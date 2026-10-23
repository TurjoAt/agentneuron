<script>
  // Graph 2.0 — "neural network" view of the context graph (owner: UI-B).
  import { onMount, untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import { app, openFile, navigate, saveLocal } from '../lib/store.svelte.js';
  import { resource } from '../lib/resource.svelte.js';
  import { TOOLS, TOOL_ORDER, KINDS, toolColor } from '../lib/tools.js';
  import { fmtNum, timeAgo, basename, dirname } from '../lib/format.js';
  import { reduced } from '../lib/motion.js';
  import { openMenu } from '../lib/menu.svelte.js';
  import { runAction, actionEnabled } from '../lib/actions.js';
  import { createTask, copyPath } from '../lib/fileActions.js';
  import { seriesColor } from '../lib/viz/palette.js';
  import Icon from '../lib/Icon.svelte';
  import ToolBadge from '../lib/ToolBadge.svelte';
  import { buildModel, filterModel, neighborhood, shortestPath, syntheticGraph, AGE_BUCKETS, TIERS } from './graph/model.js';
  import { computeLayout, LAYOUTS } from './graph/layouts.js';
  import { GraphRenderer } from './graph/renderer.js';

  let { params = {} } = $props();

  const load = (k, d) => {
    try {
      return JSON.parse(localStorage.getItem(k) || 'null') ?? d;
    } catch {
      return d;
    }
  };

  // ------------------------------------------------------------ data
  const synthetic = $derived(app.mock && params.synthetic ? Math.min(5000, +params.synthetic || 1200) : 0);
  const graph = resource((k) => (k ? Promise.resolve(syntheticGraph(k)) : api('/api/graph')), { live: 'graph', key: () => synthetic });
  const health = resource(() => api('/api/health'), { live: true, debounce: 2500 });

  // ------------------------------------------------------------ view state
  const p0 = untrack(() => ({ ...params }));
  let layout = $state(LAYOUTS.some((l) => l.id === p0.layout) ? p0.layout : load('agentneuron.graph.layout', 'neural'));
  let groupBy = $state(load('agentneuron.graph.groupBy', 'folder'));
  let colorMode = $state(load('agentneuron.graph.color', 'tool'));
  let labels = $state('auto');
  let root = $state(p0.root || null);
  let filters = $state({ tools: new Set(), kinds: new Set(), health: 'all', age: 'any', hideOrphans: false, broken: true });
  let showFilters = $state(false);
  let query = $state('');
  let selected = $state(null);
  let focusId = $state(null);
  let hops = $state(1);
  let pathMode = $state(false);
  let pathFrom = $state(null);
  let pathTo = $state(null);
  let hover = $state(null); // { node?, cell?, x, y }
  let panelOpen = $state(true);

  $effect(() => saveLocal('agentneuron.graph.layout', layout));
  $effect(() => saveLocal('agentneuron.graph.groupBy', groupBy));
  $effect(() => saveLocal('agentneuron.graph.color', colorMode));

  // model: rebuilt on graph/health/files change; churn from the event ring
  const model = $derived.by(() => {
    const g = graph.data;
    if (!g) return null;
    return buildModel(g, { files: app.files, events: untrack(() => app.events), issues: health.data?.issues || [] });
  });
  const view = $derived(model ? filterModel(model, filters) : null);
  const matches = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q || !view) return null;
    return new Set(view.nodes.filter((n) => n.id.toLowerCase().includes(q)).map((n) => n.id));
  });
  const focusMap = $derived(model && focusId && model.byId.has(focusId) ? neighborhood(model, focusId, hops) : null);
  const path = $derived(model && pathFrom && pathTo ? shortestPath(model, pathFrom, pathTo, view?.set) : null);
  const selNode = $derived(selected && model ? model.byId.get(selected) : null);
  const selEdges = $derived(selNode && model ? model.edgesOf.get(selNode.id) || [] : []);

  const toolsPresent = $derived.by(() => {
    const m = new Map();
    for (const n of model?.nodes || []) if (!n.missing) m.set(n.tool, (m.get(n.tool) || 0) + 1);
    return TOOL_ORDER.filter((t) => m.has(t)).map((t) => [t, m.get(t)]);
  });
  const kindsPresent = $derived.by(() => {
    const m = new Map();
    for (const n of model?.nodes || []) if (!n.missing) m.set(n.kind, (m.get(n.kind) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  });
  const brokenCount = $derived(view ? view.edges.filter((e) => e.broken).length : 0);
  const activeFilters = $derived(filters.tools.size + filters.kinds.size + (filters.health !== 'all') + (filters.age !== 'any') + filters.hideOrphans + !filters.broken);

  // ------------------------------------------------------------ renderer
  let wrap = $state();
  let canvas = $state();
  let mini = $state();
  /** @type {GraphRenderer|null} */
  let R = null;
  let ready = $state(false);
  let miniOn = $state(false);

  function themeColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    const t = app.theme === 'light' ? 'light' : 'dark';
    const tool = Object.fromEntries(Object.keys(TOOLS).map((k) => [k, toolColor(k, t)]));
    return {
      dark: t === 'dark', text: v('--text'), text2: v('--text-2'), text3: v('--text-3'), bg: t === 'dark' ? '#0b0d14' : '#f7f8fb',
      err: v('--err'), warn: v('--warn'), ok: v('--ok'), accent: v('--accent'), border: v('--border-strong'), font: v('--font') || 'system-ui',
      tool, kind: (k) => seriesColor(k, t),
    };
  }

  onMount(() => {
    R = new GraphRenderer({
      canvas,
      mini,
      reduced,
      onMini: (v) => (miniOn = v),
      onHover: (h, pos) => {
        hover = h ? { ...h, x: pos?.x ?? 0, y: pos?.y ?? 0 } : null;
        R?.setState({ hover: h?.node?.id || null });
      },
      onClick: (h, e) => {
        if (!h?.node) {
          if (!pathMode) selected = null;
          return;
        }
        const id = h.node.id;
        if (pathMode) {
          if (!pathFrom || (pathFrom && pathTo)) {
            pathFrom = id;
            pathTo = null;
          } else pathTo = id;
          return;
        }
        selected = id;
        panelOpen = true;
        if (e.altKey || e.metaKey) setFocus(id);
      },
      onDblClick: (h) => {
        if (h?.node && !h.node.missing) openFile(h.node.id);
        else R?.fit();
      },
      onContext: (h, e) => {
        if (h?.node) nodeMenu(h.node, e);
        else
          openMenu(e, [
            { label: 'Fit to screen', icon: 'maximize', kbd: 'F', run: () => R?.fit() },
            { label: 'Clear focus & path', icon: 'x', run: clearAll },
            { sep: true },
            ...LAYOUTS.map((l) => ({ label: `${l.label} layout`, icon: l.icon, run: () => (layout = l.id) })),
          ], 'Graph');
      },
    });
    R.setTheme(themeColors());
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      R.resize(Math.round(r.width), Math.round(r.height));
    });
    ro.observe(wrap);
    ready = true;
    return () => {
      ro.disconnect();
      R?.destroy();
      R = null;
    };
  });

  // theme
  $effect(() => {
    void app.theme;
    if (ready) requestAnimationFrame(() => R?.setTheme(themeColors()));
  });

  // data → renderer, layout recompute when the visible structure changes
  let layoutKey = '';
  let lastLayoutId = '';
  $effect(() => {
    if (!ready || !view) return;
    const ids = view.nodes.map((n) => n.id).join('|');
    const sig = `${layout}§${groupBy}§${root}§${ids.length}:${hash(ids)}§${view.edges.length}`;
    const lay = layout, gb = groupBy, rt = root, v = view;
    untrack(() => {
      R.setData(v.nodes, v.edges);
      if (sig !== layoutKey) {
        const structural = lay !== lastLayoutId || !layoutKey || layoutKey.split('§').slice(0, 4).join() !== sig.split('§').slice(0, 4).join();
        layoutKey = sig;
        lastLayoutId = lay;
        const L = computeLayout(lay, v.nodes, v.edges, R.currentPositions(), { root: rt, groupBy: gb });
        R.setLayout(L, { animate: true, fit: structural });
      }
    });
  });
  $effect(() => {
    if (!ready) return;
    R.setState({ selected, focus: focusMap, path: path || null, colorMode, labels, matches, groupBy });
  });
  // live signals: particles on every file change
  let lastEv = untrack(() => app.events[0]?.id ?? 0);
  $effect(() => {
    const evs = app.events;
    untrack(() => {
      for (const e of evs) {
        if ((e.id ?? 0) <= lastEv) break;
        R?.pulse(e.path);
      }
      lastEv = evs[0]?.id ?? lastEv;
    });
  });

  // ?focus=path (reveal in graph)
  $effect(() => {
    const f = params.focus;
    if (!f || !ready || !model) return;
    untrack(() => {
      if (!model.byId.has(f)) return;
      selected = f;
      setFocus(f, false);
      setTimeout(() => R?.fit(new Set(neighborhood(model, f, 1).keys())), 950);
    });
  });

  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    return h >>> 0;
  }

  // ------------------------------------------------------------ commands
  function setFocus(id, fit = true) {
    focusId = id;
    pathFrom = pathTo = null;
    if (fit && model) setTimeout(() => R?.fit(new Set(neighborhood(model, id, hops).keys())), 30);
  }
  function clearAll() {
    focusId = null;
    pathFrom = pathTo = null;
    pathMode = false;
    selected = null;
    query = '';
  }
  function setRoot(id) {
    root = id;
    layout = 'radial';
  }
  function startPath(from) {
    pathMode = true;
    pathFrom = from || selected || null;
    pathTo = null;
    focusId = null;
    panelOpen = true;
  }
  function fitPath() {
    if (path) R?.fit(new Set(path));
  }
  $effect(() => {
    if (path) untrack(() => setTimeout(fitPath, 50));
  });

  function act(id, p, label, icon, extra = {}) {
    const st = actionEnabled(id);
    return { label, icon, run: () => runAction(id, p), disabled: !st.enabled, reason: st.reason, ...extra };
  }

  function nodeMenu(n, e) {
    const p = n.id;
    const isInstr = /(^|\/)(CLAUDE|AGENTS|GEMINI)\.md$|\.cursorrules$|copilot-instructions\.md$/.test(p);
    openMenu(
      e,
      [
        ...(n.missing
          ? [{ header: 'Missing file — broken link target' }, act('files.create', { path: p }, 'Create this file…', 'plus')]
          : [
              { label: 'Open', icon: 'file', run: () => openFile(p) },
              { label: 'Open in editor', icon: 'edit', run: () => openFile(p, { tab: 'edit' }) },
              { label: 'Peek', icon: 'eye', run: () => (app.drawer = { path: p }) },
            ]),
        { sep: true },
        { label: 'Focus neighborhood', icon: 'target', kbd: '⌥ click', run: () => setFocus(p) },
        { label: 'Find path from here…', icon: 'link', run: () => startPath(p) },
        ...(pathFrom && pathFrom !== p ? [{ label: 'Path to here', icon: 'link', run: () => { pathMode = true; pathTo = p; } }] : []),
        { label: 'Use as radial root', icon: 'radar', run: () => setRoot(p) },
        { label: 'Copy path', icon: 'copy', run: () => copyPath(p) },
        ...(n.missing
          ? []
          : [
              { sep: true },
              { header: 'Actions' },
              act('git.stage', { paths: [p] }, 'Stage in git', 'check'),
              act('files.rename', { from: p, to: p }, 'Rename / move…', 'replace'),
              ...(isInstr ? [act('agents.sync.apply', { source: p }, 'Sync to other tools…', 'merge')] : []),
              { label: 'Create task for this file', icon: 'tasks', run: () => createTask({ files: [p] }) },
              act('files.delete', { path: p }, 'Move to trash', 'trash', { danger: true }),
            ]),
      ],
      p
    );
  }

  function onkeydown(e) {
    const t = e.target;
    if (t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'f' || e.key === 'F') R?.fit();
    else if (e.key === '+' || e.key === '=') R?.zoomBy(1.3);
    else if (e.key === '-') R?.zoomBy(1 / 1.3);
    else if (e.key === 'Escape' && (selected || focusId || pathMode || query)) {
      e.stopPropagation();
      clearAll();
    } else return;
    e.preventDefault();
  }

  function toggleSet(key, v) {
    const s = new Set(filters[key]);
    if (s.has(v)) s.delete(v);
    else s.add(v);
    filters = { ...filters, [key]: s };
  }
  function resetFilters() {
    filters = { tools: new Set(), kinds: new Set(), health: 'all', age: 'any', hideOrphans: false, broken: true };
  }

  function searchEnter(e) {
    if (e.key !== 'Enter' || !matches?.size) return;
    const first = [...matches][0];
    selected = first;
    R?.fit(matches.size < 40 ? matches : new Set([first]));
  }

  const ageLabel = (n) => (Number.isFinite(n.age) ? timeAgo(n.mtime, app.now) : '—');
  const tipNode = $derived(hover?.node || null);
  const tipCell = $derived(hover?.cell || null);
  const layoutDef = $derived(LAYOUTS.find((l) => l.id === layout));
</script>

<svelte:window {onkeydown} />

<div class="gv" class:panel-on={panelOpen && (selNode || pathMode)}>
  <header class="bar">
    <div class="seg" role="tablist" aria-label="Layout">
      {#each LAYOUTS as l (l.id)}
        <button role="tab" class:on={layout === l.id} aria-selected={layout === l.id} title={l.hint} onclick={() => (layout = l.id)}>
          <Icon name={l.icon} size={14} /><span>{l.label}</span>
        </button>
      {/each}
    </div>
    <div class="tools">
      {#if layout === 'clusters' || layout === 'timeline' || layout === 'matrix'}
        <label class="sel" title="Group by">
          <span class="faint">Group</span>
          <select bind:value={groupBy} aria-label="Group by">
            <option value="folder">Folder</option>
            <option value="tool">Tool</option>
            <option value="kind">Kind</option>
          </select>
        </label>
      {/if}
      <label class="sel" title="Color nodes by">
        <span class="faint">Color</span>
        <select bind:value={colorMode} aria-label="Color by">
          <option value="tool">Tool</option>
          <option value="kind">Kind</option>
          <option value="churn">Heat · churn</option>
          <option value="age">Age</option>
          <option value="health">Health</option>
        </select>
      </label>
      <div class="search">
        <Icon name="search" size={13} />
        <input bind:value={query} placeholder="Find file…" aria-label="Find file in graph" onkeydown={searchEnter} />
        {#if matches}<span class="faint tnum small">{matches.size}</span>{/if}
      </div>
      <div class="pop-wrap">
        <button class="btn sm" class:act={activeFilters} onclick={() => (showFilters = !showFilters)} aria-expanded={showFilters}>
          <Icon name="filter" size={13} /> Filters{#if activeFilters}<span class="cnt">{activeFilters}</span>{/if}
        </button>
        {#if showFilters}
          <div class="pop card" role="dialog" aria-label="Graph filters">
            <div class="ph"><b>Filters</b><span class="spacer"></span><button class="btn ghost sm" onclick={resetFilters}>Reset</button></div>
            <div class="eyebrow">Tool</div>
            <div class="chips">
              {#each toolsPresent as [t, c] (t)}
                <button class="chip" class:on={filters.tools.has(t)} onclick={() => toggleSet('tools', t)}><span class="dot" style="background:var(--tool-{t})"></span>{TOOLS[t].label}<span class="n">{c}</span></button>
              {/each}
            </div>
            <div class="eyebrow">Kind</div>
            <div class="chips">
              {#each kindsPresent as [k, c] (k)}
                <button class="chip" class:on={filters.kinds.has(k)} onclick={() => toggleSet('kinds', k)}>{KINDS[k] || k}<span class="n">{c}</span></button>
              {/each}
            </div>
            <div class="two">
              <label><span class="eyebrow">Health</span>
                <select class="input" bind:value={filters.health}>
                  <option value="all">All files</option>
                  <option value="issues">With issues</option>
                  <option value="errors">Errors & broken links</option>
                  <option value="clean">Clean only</option>
                </select>
              </label>
              <label><span class="eyebrow">Last modified</span>
                <select class="input" bind:value={filters.age}>
                  {#each AGE_BUCKETS as a (a.id)}<option value={a.id}>{a.label}</option>{/each}
                </select>
              </label>
            </div>
            <label class="ck"><input type="checkbox" bind:checked={filters.broken} /> Show broken links <span class="faint">({model?.edges.filter((e) => e.broken).length || 0})</span></label>
            <label class="ck"><input type="checkbox" bind:checked={filters.hideOrphans} /> Hide unlinked files</label>
            <label class="ck"><span>Labels</span>
              <select bind:value={labels} class="mini-sel"><option value="auto">Auto (level of detail)</option><option value="all">All</option><option value="none">Only on hover</option></select>
            </label>
          </div>
        {/if}
      </div>
      <button class="btn sm" class:act={pathMode} onclick={() => (pathMode ? (pathMode = false, (pathFrom = pathTo = null)) : startPath())} title="Find the shortest link path between two files">
        <Icon name="link" size={13} /> Path
      </button>
    </div>
  </header>

  <div class="stage" bind:this={wrap}>
    <canvas bind:this={canvas} aria-label="Context graph, {view?.nodes.length || 0} files, {view?.edges.length || 0} links. {layoutDef?.hint}"></canvas>

    {#if graph.loading && !graph.data}
      <div class="center faint"><div class="spin"></div>Mapping the context graph…</div>
    {:else if graph.error && !graph.data}
      <div class="center"><Icon name="alert" size={18} /> {graph.error.message}</div>
    {:else if view && !view.nodes.length}
      <div class="center faint">No files match these filters. <button class="btn sm" onclick={resetFilters}>Reset filters</button></div>
    {/if}

    {#if tipNode && !(selNode && selNode.id === tipNode.id && panelOpen)}
      <div class="tip" style="left:{hover.x}px;top:{hover.y}px" class:flip={hover.x > (wrap?.clientWidth || 0) - 260}>
        <div class="tt row">
          {#if tipNode.missing}<span class="badge err">missing</span>{:else}<ToolBadge tool={tipNode.tool} compact />{/if}
          <b class="ellipsis">{tipNode.label}</b>
        </div>
        {#if dirname(tipNode.id)}<div class="mono faint tiny ellipsis">{dirname(tipNode.id)}/</div>{/if}
        {#if !tipNode.missing}
          <div class="tg">
            <span>{KINDS[tipNode.kind] || tipNode.kind}</span><b class="tnum">{fmtNum(tipNode.tokens)} tok</b>
            <span>Links</span><b class="tnum">{tipNode.outDeg} out · {tipNode.inDeg} in</b>
            <span>Modified</span><b>{ageLabel(tipNode)}</b>
            {#if tipNode.churn}<span>Churn</span><b class="tnum">{Math.round(tipNode.churn)}</b>{/if}
          </div>
          {#if tipNode.issues || tipNode.hasBroken}
            <div class="iss">
              {#if tipNode.issues?.error}<span class="badge err">{tipNode.issues.error} error{tipNode.issues.error > 1 ? 's' : ''}</span>{/if}
              {#if tipNode.issues?.warn}<span class="badge warn">{tipNode.issues.warn} warn</span>{/if}
              {#if tipNode.hasBroken}<span class="badge err">broken link</span>{/if}
            </div>
          {/if}
        {:else}
          <div class="faint tiny">Linked from {tipNode.inDeg} file{tipNode.inDeg === 1 ? '' : 's'} but does not exist.</div>
        {/if}
      </div>
    {:else if tipCell}
      <div class="tip" style="left:{hover.x}px;top:{hover.y}px" class:flip={hover.x > (wrap?.clientWidth || 0) - 260}>
        <div class="mono tiny"><b>{tipCell.a.label}</b> <span class="faint">→</span> <b>{tipCell.b.label}</b></div>
        {#if tipCell.edges.length}
          {#each tipCell.edges as e, i (i)}<div class="faint tiny">{e.source.label} → {e.target.label} · {e.type}{e.broken ? ' · broken' : ''}</div>{/each}
        {:else}<div class="faint tiny">no link</div>{/if}
      </div>
    {/if}

    <!-- floating controls -->
    <div class="zoomer">
      <button class="btn icon sm" title="Zoom in (+)" onclick={() => R?.zoomBy(1.35)}><Icon name="plus" size={14} /></button>
      <button class="btn icon sm" title="Zoom out (−)" onclick={() => R?.zoomBy(1 / 1.35)}><Icon name="minus" size={14} /></button>
      <button class="btn icon sm" title="Fit (F)" onclick={() => R?.fit()}><Icon name="maximize" size={14} /></button>
    </div>

    <div class="mini card" class:on={miniOn}><canvas bind:this={mini} aria-label="Minimap — click to navigate"></canvas></div>

    <div class="legend card">
      {#if colorMode === 'tool'}
        {#each toolsPresent as [t, c] (t)}
          <button class="lg" class:off={filters.tools.size && !filters.tools.has(t)} onclick={() => toggleSet('tools', t)} title="Filter {TOOLS[t].label}"><span class="dot" style="background:var(--tool-{t})"></span>{TOOLS[t].label}<span class="faint tnum">{c}</span></button>
        {/each}
      {:else if colorMode === 'kind'}
        {#each kindsPresent.slice(0, 8) as [k, c] (k)}
          <button class="lg" class:off={filters.kinds.size && !filters.kinds.has(k)} onclick={() => toggleSet('kinds', k)}><span class="dot" style="background:{seriesColor(k, app.theme === 'light' ? 'light' : 'dark')}"></span>{KINDS[k] || k}<span class="faint tnum">{c}</span></button>
        {/each}
      {:else if colorMode === 'health'}
        <span class="lg"><span class="dot" style="background:var(--ok)"></span>clean</span>
        <span class="lg"><span class="dot" style="background:var(--warn)"></span>warnings</span>
        <span class="lg"><span class="dot" style="background:var(--err)"></span>errors / broken</span>
      {:else}
        <span class="ramp-l faint">{colorMode === 'churn' ? 'calm' : 'fresh'}</span>
        <span class="ramp {colorMode}"></span>
        <span class="ramp-l faint">{colorMode === 'churn' ? 'hot' : 'stale'}</span>
      {/if}
      <span class="sep"></span>
      <span class="faint tnum small">{fmtNum(view?.nodes.length || 0)} files · {fmtNum(view?.edges.length || 0)} links{#if brokenCount}&nbsp;· <span class="err">{brokenCount} broken</span>{/if}</span>
    </div>

    {#if focusId && !pathMode}
      <div class="focus-pill card">
        <Icon name="target" size={13} />
        <span class="ellipsis">Focus <b>{basename(focusId)}</b></span>
        <span class="faint">hops</span>
        {#each [1, 2, 3] as h (h)}<button class="hop" class:on={hops === h} onclick={() => { hops = h; setTimeout(() => R?.fit(new Set(neighborhood(model, focusId, h).keys())), 30); }}>{h}</button>{/each}
        <span class="faint tnum">{focusMap?.size || 0} files</span>
        <button class="btn ghost icon sm" title="Exit focus (Esc)" onclick={() => (focusId = null)}><Icon name="x" size={13} /></button>
      </div>
    {/if}
  </div>

  {#if panelOpen && (selNode || pathMode)}
    <aside class="panel card">
      {#if pathMode}
        <div class="ph"><Icon name="link" size={14} /><b>Path finder</b><span class="spacer"></span><button class="btn ghost icon sm" onclick={() => { pathMode = false; pathFrom = pathTo = null; }} aria-label="Close path finder"><Icon name="x" size={13} /></button></div>
        <p class="faint small">Click two files in the graph (or pick them here) to trace the shortest chain of links between them.</p>
        <label class="pf"><span class="eyebrow">From</span>
          <select class="input" bind:value={pathFrom}>
            <option value={null}>— click a node —</option>
            {#each view?.nodes || [] as n (n.id)}<option value={n.id}>{n.id}</option>{/each}
          </select>
        </label>
        <label class="pf"><span class="eyebrow">To</span>
          <select class="input" bind:value={pathTo}>
            <option value={null}>— click a node —</option>
            {#each view?.nodes || [] as n (n.id)}<option value={n.id}>{n.id}</option>{/each}
          </select>
        </label>
        {#if pathFrom && pathTo}
          {#if path}
            <div class="eyebrow" style="margin-top:6px">{path.length - 1} hop{path.length === 2 ? '' : 's'}</div>
            <ol class="steps">
              {#each path as id, i (id)}
                {@const n = model.byId.get(id)}
                <li>
                  <span class="sd" style="background:{n.missing ? 'var(--err)' : `var(--tool-${n.tool})`}"></span>
                  <button class="lnk mono" onclick={() => openFile(id, { drawer: true })} data-path={n.missing ? undefined : id}>{id}</button>
                  {#if i < path.length - 1}
                    {@const e = model.edges.find((x) => (x.source.id === id && x.target.id === path[i + 1]) || (x.target.id === id && x.source.id === path[i + 1]))}
                    <span class="via faint tiny">{e?.source.id === id ? '↓ links to' : '↓ linked from'} · {e?.type}</span>
                  {/if}
                </li>
              {/each}
            </ol>
            <button class="btn sm" onclick={fitPath}><Icon name="maximize" size={13} /> Fit path</button>
          {:else}
            <div class="empty-s"><Icon name="info" size={14} /> No link path between these files (with current filters).</div>
          {/if}
        {/if}
      {:else if selNode}
        <div class="ph">
          {#if selNode.missing}<span class="badge err">missing</span>{:else}<ToolBadge tool={selNode.tool} />{/if}
          <span class="spacer"></span>
          <button class="btn ghost icon sm" onclick={() => (selected = null)} aria-label="Close details"><Icon name="x" size={13} /></button>
        </div>
        <h3 class="nm">{selNode.label}</h3>
        <div class="mono faint tiny brk">{selNode.id}</div>
        {#if !selNode.missing}
          <div class="kv">
            <div><span class="eyebrow">Kind</span><b>{KINDS[selNode.kind] || selNode.kind}</b></div>
            <div><span class="eyebrow">Tokens</span><b class="tnum">{fmtNum(selNode.tokens)}</b></div>
            <div><span class="eyebrow">Layer</span><b>{TIERS[selNode.tier].label.split(' ')[0]}</b></div>
            <div><span class="eyebrow">Modified</span><b>{ageLabel(selNode)}</b></div>
          </div>
          <div class="acts">
            <button class="btn sm primary" onclick={() => openFile(selNode.id)}><Icon name="file" size={13} /> Open</button>
            <button class="btn sm" onclick={() => setFocus(selNode.id)}><Icon name="target" size={13} /> Focus</button>
            <button class="btn sm" onclick={() => startPath(selNode.id)}><Icon name="link" size={13} /> Path</button>
            <button class="btn sm icon" title="More actions" onclick={(e) => nodeMenu(selNode, e)}><Icon name="more" size={14} /></button>
          </div>
        {:else}
          <div class="acts"><button class="btn sm" onclick={(e) => nodeMenu(selNode, e)}>Fix…</button></div>
        {/if}
        <div class="eyebrow" style="margin-top:12px">Links · {selEdges.length}</div>
        <div class="links">
          {#each selEdges.slice(0, 80) as e, i (i)}
            {@const out = e.source.id === selNode.id}
            {@const o = out ? e.target : e.source}
            <button class="lrow" class:broken={e.broken} onclick={() => (selected = o.id)} onpointerenter={() => R?.setState({ hover: o.id })} onpointerleave={() => R?.setState({ hover: null })}>
              <span class="dir faint" title={out ? 'outgoing' : 'incoming'}>{out ? '→' : '←'}</span>
              <span class="sd" style="background:{o.missing ? 'var(--err)' : `var(--tool-${o.tool})`}"></span>
              <span class="mono ellipsis grow">{o.id}</span>
              <span class="faint tiny">{e.broken ? 'broken' : e.type}</span>
            </button>
          {:else}
            <div class="faint small">No links — an orphan.</div>
          {/each}
        </div>
      {/if}
    </aside>
  {/if}
</div>

<style>
  .gv {
    position: relative;
    height: calc(100dvh - var(--topbar-h));
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-columns: minmax(0, 1fr);
  }
  .gv.panel-on { grid-template-columns: minmax(0, 1fr) 320px; }
  .bar {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px clamp(12px, 2vw, 22px);
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
    position: relative;
    z-index: 3;
  }
  .seg {
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: 11px;
    background: var(--inset);
    border: 1px solid var(--border);
    overflow-x: auto;
    max-width: 100%;
    scrollbar-width: none;
  }
  .seg button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 11px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--text-2);
    font-size: 12.5px;
    font-weight: 550;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, color 0.15s;
  }
  .seg button:hover { color: var(--text); }
  .seg button.on { background: var(--panel-solid); color: var(--text); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25), 0 0 0 1px var(--border); }
  .seg button.on :global(svg) { color: var(--accent); }
  .tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-left: auto; }
  .sel {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 4px 0 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    font-size: 12px;
  }
  .sel select, .mini-sel { border: 0; background: transparent; font-size: 12px; font-weight: 550; cursor: pointer; outline: none; padding: 0 4px; }
  .sel select option, .mini-sel option { background: var(--panel-solid); }
  .search {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--inset);
    color: var(--text-3);
  }
  .search input { border: 0; background: transparent; outline: none; width: 130px; font-size: 12.5px; }
  .btn.act { border-color: color-mix(in srgb, var(--accent) 50%, transparent); background: var(--accent-soft); color: var(--text); }
  .cnt { background: var(--accent); color: #fff; border-radius: 99px; font-size: 10px; padding: 0 5px; line-height: 15px; font-weight: 700; }
  .pop-wrap { position: relative; }
  .pop {
    position: absolute;
    right: 0;
    top: calc(100% + 8px);
    width: min(360px, calc(100vw - 24px));
    padding: 12px 14px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 10;
    background: var(--panel-solid);
    box-shadow: var(--shadow-lg);
    animation: slide-in 0.18s var(--ease);
  }
  .ph { display: flex; align-items: center; gap: 8px; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip .dot, .lg .dot { width: 8px; height: 8px; border-radius: 50%; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .two label, .pf { display: flex; flex-direction: column; gap: 4px; }
  .two .input, .pf .input { height: 30px; font-size: 12.5px; }
  .ck { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-2); }

  .stage { position: relative; min-height: 0; overflow: hidden; touch-action: none; }
  .stage > canvas { position: absolute; inset: 0; display: block; }
  .center { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 13px; }
  .spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--border-strong); border-top-color: var(--accent); animation: rot 0.8s linear infinite; }
  @keyframes rot { to { transform: rotate(360deg); } }

  .tip {
    position: absolute;
    z-index: 4;
    pointer-events: none;
    transform: translate(16px, -50%);
    min-width: 200px;
    max-width: 300px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--panel-solid);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-lg);
    font-size: 12px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    animation: slide-in 0.12s var(--ease);
  }
  .tip.flip { transform: translate(calc(-100% - 16px), -50%); }
  .tt b { font-size: 13px; }
  .tg { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; color: var(--text-3); margin-top: 2px; }
  .tg b { color: var(--text); font-weight: 550; text-align: right; }
  .iss { display: flex; gap: 4px; flex-wrap: wrap; }
  .tiny { font-size: 11px; }
  .small { font-size: 12px; }
  .err { color: var(--err); }

  .zoomer { position: absolute; right: 14px; top: 14px; display: flex; flex-direction: column; gap: 4px; z-index: 2; }
  .zoomer .btn { background: var(--panel-solid); box-shadow: var(--shadow); }
  .mini { position: absolute; left: 14px; bottom: 14px; width: 180px; height: 118px; padding: 0; overflow: hidden; z-index: 2; }
  .mini { opacity: 0; transform: translateY(6px); pointer-events: none; transition: opacity 0.25s, transform 0.25s var(--ease); }
  .mini.on { opacity: 1; transform: none; pointer-events: auto; }
  .mini canvas { width: 100%; height: 100%; display: block; cursor: crosshair; }
  .legend {
    position: absolute;
    right: 14px;
    bottom: 14px;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 10px 4px 6px;
    flex-wrap: wrap;
    max-width: calc(100% - 230px);
    z-index: 2;
    border-radius: 11px;
  }
  .lg { display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; padding: 4px 6px; border-radius: 6px; font-size: 11.5px; color: var(--text-2); cursor: pointer; }
  button.lg:hover { background: var(--panel-hover); color: var(--text); }
  .lg.off { opacity: 0.4; }
  .sep { width: 1px; height: 14px; background: var(--border); margin: 0 6px; }
  .ramp { width: 90px; height: 8px; border-radius: 99px; }
  .ramp.churn { background: linear-gradient(90deg, #2a3243, #5a4234, #a5552c, #ff8a4c, #ffd0a6); }
  .ramp.age { background: linear-gradient(90deg, #a99fff, #7d70e6, #544b9a, #363552, #272a36); }
  :global([data-theme='light']) .ramp.churn { background: linear-gradient(90deg, #dfe3ea, #f2c6a9, #e8905c, #d9622b, #8a3410); }
  :global([data-theme='light']) .ramp.age { background: linear-gradient(90deg, #4535c9, #6a5ce0, #9c93e8, #c9c5ea, #e3e3ea); }
  .ramp-l { font-size: 11px; padding: 0 6px; }

  .focus-pill {
    position: absolute;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 6px 5px 12px;
    font-size: 12.5px;
    z-index: 2;
    max-width: calc(100% - 100px);
    border-radius: 99px;
    animation: slide-in 0.2s var(--ease);
  }
  .hop { width: 24px; height: 22px; border-radius: 6px; border: 1px solid var(--border); background: transparent; font-size: 12px; cursor: pointer; color: var(--text-2); }
  .hop.on { background: var(--accent); color: #fff; border-color: transparent; }

  .panel {
    margin: 10px 10px 10px 0;
    padding: 14px;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-radius: var(--radius);
    animation: slide-in 0.2s var(--ease);
  }
  .nm { margin: 2px 0 0; font-size: 17px; letter-spacing: -0.01em; word-break: break-word; }
  .brk { word-break: break-all; }
  .kv { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 6px; }
  .kv > div { display: flex; flex-direction: column; gap: 2px; }
  .kv b { font-size: 13px; font-weight: 600; }
  .acts { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
  .links { display: flex; flex-direction: column; gap: 1px; }
  .lrow { display: flex; align-items: center; gap: 7px; padding: 5px 6px; border: 0; background: none; border-radius: 7px; font-size: 12px; cursor: pointer; text-align: left; color: var(--text-2); }
  .lrow:hover { background: var(--panel-hover); color: var(--text); }
  .lrow.broken .mono { color: var(--err); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--err) 50%, transparent); }
  .dir { width: 12px; text-align: center; }
  .sd { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .steps { list-style: none; margin: 4px 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .steps li { display: grid; grid-template-columns: 10px 1fr; align-items: center; gap: 2px 8px; }
  .steps .via { grid-column: 2; padding: 2px 0 4px; }
  .lnk { border: 0; background: none; padding: 2px 0; color: var(--text); cursor: pointer; text-align: left; font-size: 12px; word-break: break-all; }
  .lnk:hover { color: var(--accent); }
  .empty-s { display: flex; gap: 8px; align-items: center; color: var(--text-2); font-size: 12.5px; padding: 8px 0; }

  @media (max-width: 760px) {
    .gv { height: calc(100dvh - var(--topbar-h) - 62px); }
    .gv.panel-on { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto; }
    .panel { margin: 0; border-radius: var(--radius) var(--radius) 0 0; max-height: 44dvh; }
    .seg button span { display: none; }
    .seg button.on span { display: inline; }
    .tools { margin-left: 0; }
    .search input { width: 90px; }
    .mini { display: none; }
    .legend { left: 10px; right: 10px; bottom: 10px; max-width: none; }
    .zoomer { right: 10px; top: 10px; }
  }
</style>
