<script>
  // Product map: every page by group, the data entities behind them and how they connect. Pure SVG, clickable.
  import Modal from '../Modal.svelte';
  import Icon from '../Icon.svelte';
  import { app, navigate } from '../store.svelte.js';
  import { VIEWS, GROUPS } from '../nav.js';
  import { badgeFor } from '../navbadges.svelte.js';

  let { onclose } = $props();

  // ---- layout (viewBox units)
  const W = 1000;
  const COL_W = 180;
  const GAP = (W - 40 - COL_W * GROUPS.length) / (GROUPS.length - 1);
  const PILL_H = 26;
  const PILL_GAP = 6;
  const TOP = 14;
  const cols = GROUPS.map((g, i) => {
    const x = 20 + i * (COL_W + GAP);
    const views = VIEWS.filter((v) => v.group === g.id);
    const pages = views.map((v, k) => ({ ...v, x: x + 10, y: TOP + 36 + k * (PILL_H + PILL_GAP), w: COL_W - 20 }));
    return { ...g, x, y: TOP, w: COL_W, h: 36 + views.length * (PILL_H + PILL_GAP) + 4, pages };
  });
  const pages = cols.flatMap((c) => c.pages);
  const pageById = Object.fromEntries(pages.map((p) => [p.id, p]));
  const colBottom = Math.max(...cols.map((c) => c.y + c.h));

  const EY = colBottom + 140;
  const ENT = [
    { id: 'agent', label: 'Agent', icon: 'agents', x: 90, y: EY, go: ['agents'], desc: 'Claude Code, Codex and other tools' },
    { id: 'session', label: 'Session', icon: 'message', x: 270, y: EY, go: ['sessions'], desc: 'One conversation: prompts, tool calls, cost' },
    { id: 'model', label: 'Model', icon: 'sparkles', x: 160, y: EY + 96, go: ['usage', { tab: 'overview' }], desc: 'Which model answered, at what price' },
    { id: 'tool', label: 'Tool', icon: 'terminal', x: 350, y: EY + 96, go: ['usage', { tab: 'tools' }], desc: 'Read, Edit, Bash, MCP tools, skills' },
    { id: 'file', label: 'File', icon: 'file', x: 520, y: EY, go: ['files'], desc: 'Context files agents read and edit' },
    { id: 'memory', label: 'Memory', icon: 'brain', x: 560, y: EY + 96, go: ['memory'], desc: "Claude's saved memory and plans" },
    { id: 'commit', label: 'Commit', icon: 'commit', x: 720, y: EY, go: ['git', { tab: 'history' }], desc: 'Where edits landed in git' },
    { id: 'task', label: 'Task', icon: 'checkSquare', x: 900, y: EY, go: ['tasks'], desc: 'Work items linked to files and sessions' },
  ];
  const entById = Object.fromEntries(ENT.map((e) => [e.id, e]));
  const LINKS = [
    ['agent', 'session', 'runs'],
    ['session', 'model', 'uses'],
    ['session', 'tool', 'calls'],
    ['session', 'file', 'edits'],
    ['file', 'commit', 'lands in'],
    ['commit', 'task', 'closes'],
    ['memory', 'file', 'describes'],
    ['tool', 'file', 'touches'],
  ];
  // where each entity shows up
  const SEEN = {
    agent: ['live', 'agents', 'overview'],
    session: ['live', 'sessions', 'usage', 'insights'],
    model: ['usage', 'reports'],
    tool: ['usage', 'agents'],
    file: ['files', 'diff', 'graph', 'context', 'health'],
    memory: ['memory', 'verify'],
    commit: ['git', 'diff'],
    task: ['tasks', 'overview'],
  };
  const pageEdges = Object.entries(SEEN).flatMap(([e, ps]) => ps.filter((p) => pageById[p]).map((p) => ({ e, p })));

  let hover = $state(null); // { kind: 'page'|'ent', id }
  const lit = $derived.by(() => {
    if (!hover) return null;
    const s = new Set([`${hover.kind}:${hover.id}`]);
    if (hover.kind === 'page') {
      for (const pe of pageEdges) if (pe.p === hover.id) s.add(`ent:${pe.e}`);
    } else {
      for (const pe of pageEdges) if (pe.e === hover.id) s.add(`page:${pe.p}`);
      for (const [a, b] of LINKS) if (a === hover.id || b === hover.id) { s.add(`ent:${a}`); s.add(`ent:${b}`); }
    }
    return s;
  });
  const isLit = (k, id) => !lit || lit.has(`${k}:${id}`);
  const edgeLit = (pe) => hover && ((hover.kind === 'page' && hover.id === pe.p) || (hover.kind === 'ent' && hover.id === pe.e));
  const linkLit = (a, b) => !hover || (hover.kind === 'ent' && (hover.id === a || hover.id === b));

  const info = $derived(hover ? (hover.kind === 'page' ? VIEWS.find((v) => v.id === hover.id) : entById[hover.id]) : null);

  function go(view, params = {}) {
    onclose?.();
    navigate(view, params);
  }
  function goEnt(e) {
    const [v, p] = e.go;
    go(v, p || {});
  }
  const key = (fn) => (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  };
  const curve = (x1, y1, x2, y2) => {
    const my = (y1 + y2) / 2;
    return `M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`;
  };
  const H = EY + 96 + 52;
</script>

<Modal title="Product map" subtitle="Every page, the data behind it and how it connects. Click to open." icon="map" width={1080} {onclose}>
  <div class="wrap">
    <svg class="map" viewBox="0 0 {W} {H}" role="group" aria-label="Map of pages and data">
      <!-- page → entity edges -->
      <g class="pedges">
        {#each pageEdges as pe (pe.e + pe.p)}
          {@const p = pageById[pe.p]}
          {@const en = entById[pe.e]}
          <path d={curve(p.x + p.w / 2, p.y + PILL_H, en.x, en.y - 22)} class:on={edgeLit(pe)} />
        {/each}
      </g>

      <!-- groups and pages -->
      {#each cols as c (c.id)}
        <g class="grp">
          <rect x={c.x} y={c.y} width={c.w} height={c.h} rx="14" />
          <text x={c.x + 14} y={c.y + 22} class="gt">{c.id.toUpperCase()}</text>
          <text x={c.x + c.w - 12} y={c.y + 22} class="gd" text-anchor="end">{c.pages.length}</text>
        </g>
        {#each c.pages as p (p.id)}
          {@const b = badgeFor(p.id)}
          <g
            class="page"
            class:cur={app.route.view === p.id}
            class:dim={!isLit('page', p.id)}
            role="link"
            tabindex="0"
            aria-label="{p.label}: {p.desc}"
            onclick={() => go(p.id)}
            onkeydown={key(() => go(p.id))}
            onpointerenter={() => (hover = { kind: 'page', id: p.id })}
            onpointerleave={() => (hover = null)}
            onfocus={() => (hover = { kind: 'page', id: p.id })}
            onblur={() => (hover = null)}
          >
            <rect x={p.x} y={p.y} width={p.w} height={PILL_H} rx="8" />
            <text x={p.x + 12} y={p.y + 17}>{p.label}</text>
            {#if b.n}<circle cx={p.x + p.w - 12} cy={p.y + PILL_H / 2} r="4" class="bd {b.tone}" />{/if}
          </g>
        {/each}
      {/each}

      <!-- entity graph -->
      <g class="links">
        {#each LINKS as [a, b, label] (a + b)}
          {@const A = entById[a]}
          {@const B = entById[b]}
          {@const vert = Math.abs(B.x - A.x) < Math.abs(B.y - A.y)}
          <g class:on={hover && linkLit(a, b)} class:dim={hover && !linkLit(a, b)}>
            <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} />
            <text x={(A.x + B.x) / 2 + (vert ? 8 : 0)} y={(A.y + B.y) / 2 - 6} text-anchor={vert ? 'start' : 'middle'}>{label}</text>
          </g>
        {/each}
      </g>
      {#each ENT as e (e.id)}
        <g
          class="ent e-{e.id}"
          class:dim={!isLit('ent', e.id)}
          role="link"
          tabindex="0"
          aria-label="{e.label}: {e.desc}"
          onclick={() => goEnt(e)}
          onkeydown={key(() => goEnt(e))}
          onpointerenter={() => (hover = { kind: 'ent', id: e.id })}
          onpointerleave={() => (hover = null)}
          onfocus={() => (hover = { kind: 'ent', id: e.id })}
          onblur={() => (hover = null)}
        >
          <circle cx={e.x} cy={e.y} r="22" />
          <g transform="translate({e.x - 9} {e.y - 9})" class="ei"><Icon name={e.icon} size={18} /></g>
          <text x={e.x} y={e.y + 40} text-anchor="middle">{e.label}</text>
        </g>
      {/each}
    </svg>

    <!-- phones: the same map as lists -->
    <div class="list">
      {#each ENT as e (e.id)}
        <div class="lrow">
          <button class="lent" onclick={() => goEnt(e)}><Icon name={e.icon} size={15} />{e.label}</button>
          <span class="faint small">{e.desc}</span>
          <div class="lpages">
            {#each SEEN[e.id].filter((p) => pageById[p]) as p (p)}<button class="chip" onclick={() => go(p)}>{pageById[p].label}</button>{/each}
          </div>
        </div>
      {/each}
    </div>

    <div class="foot" aria-live="polite">
      {#if info}
        <Icon name={info.icon} size={14} /><b>{info.label}</b><span class="muted">{info.desc}</span>
      {:else}
        <span class="faint">Hover a page to see which data it shows, or a data type to see where to find it. Press <span class="kbd">m</span> anywhere to open this map.</span>
      {/if}
    </div>
  </div>
</Modal>

<style>
  .wrap { display: flex; flex-direction: column; gap: 12px; }
  .map { width: 100%; height: auto; display: block; user-select: none; }
  .grp rect { fill: var(--inset); stroke: var(--border); }
  .gt { font: 650 10.5px var(--font); letter-spacing: 0.08em; fill: var(--text-3); }
  .gd { font: 600 10.5px var(--font); fill: var(--text-3); }
  .page { cursor: pointer; outline: none; transition: opacity 0.2s; }
  .page rect { fill: var(--panel-solid); stroke: var(--border-strong); transition: fill 0.15s, stroke 0.15s; }
  .page text { font: 550 12.5px var(--font); fill: var(--text-2); pointer-events: none; }
  .page:hover rect, .page:focus-visible rect { stroke: var(--accent); fill: var(--accent-soft); }
  .page:hover text, .page:focus-visible text { fill: var(--text); }
  .page.cur rect { stroke: var(--accent); stroke-width: 1.5; }
  .page.cur text { fill: var(--accent); font-weight: 650; }
  .bd { fill: var(--warn); }
  .bd.err { fill: var(--err); }
  .dim { opacity: 0.28; }
  .pedges path { fill: none; stroke: var(--text-3); stroke-opacity: 0.12; stroke-width: 1; transition: stroke-opacity 0.2s, stroke 0.2s; }
  .pedges path.on { stroke: var(--accent); stroke-opacity: 0.75; stroke-width: 1.4; }
  .links line { stroke: var(--text-3); stroke-opacity: 0.5; stroke-width: 1.5; stroke-dasharray: 4 4; transition: stroke 0.2s, stroke-opacity 0.2s; }
  .links text { font: 500 10.5px var(--font); fill: var(--text-3); paint-order: stroke; stroke: var(--panel-solid); stroke-width: 4px; }
  .links .on line { stroke: var(--accent); stroke-opacity: 0.9; stroke-dasharray: none; }
  .links .on text { fill: var(--text); }
  .links .dim { opacity: 0.25; }
  .ent { cursor: pointer; outline: none; transition: opacity 0.2s; --c: var(--accent); }
  .e-agent { --c: var(--tool-claude); }
  .e-session { --c: var(--accent); }
  .e-model { --c: var(--info); }
  .e-tool { --c: var(--accent-2); }
  .e-file { --c: var(--info); }
  .e-memory { --c: var(--tool-codex); }
  .e-commit { --c: var(--warn); }
  .e-task { --c: var(--ok); }
  .ent circle { fill: color-mix(in srgb, var(--c) 16%, var(--panel-solid)); stroke: var(--c); stroke-width: 1.5; transition: r 0.2s var(--ease-spring); }
  .ent:hover circle, .ent:focus-visible circle { r: 25; fill: color-mix(in srgb, var(--c) 28%, var(--panel-solid)); }
  .ent:focus-visible circle { stroke-width: 2.5; }
  .ent text { font: 600 12.5px var(--font); fill: var(--text); }
  .ei { color: var(--c); pointer-events: none; }
  .foot { display: flex; align-items: center; gap: 8px; min-height: 22px; font-size: 13px; flex-wrap: wrap; }
  .foot :global(.icon) { color: var(--accent); }
  .list { display: none; }
  .small { font-size: 12px; }
  @media (max-width: 720px) {
    .map { display: none; }
    .list { display: flex; flex-direction: column; gap: 12px; }
    .lrow { display: flex; flex-direction: column; gap: 4px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
    .lent { display: inline-flex; align-items: center; gap: 8px; border: 0; background: none; padding: 0; font-weight: 650; font-size: 14px; color: var(--text); cursor: pointer; align-self: flex-start; }
    .lpages { display: flex; flex-wrap: wrap; gap: 4px; }
    .foot { display: none; }
  }
</style>
