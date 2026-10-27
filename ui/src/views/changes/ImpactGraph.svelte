<script>
  // Layered impact graph: changed files -> changed symbols -> importers / callers / tests -> routes / contracts.
  // Columns are capped so labels stay readable; hovering a node highlights its edges. Narrow screens get a list.
  import EntityLink from '../../lib/EntityLink.svelte';
  import Icon from '../../lib/Icon.svelte';

  let { nodes = [], edges = [] } = $props();
  let width = $state(800);
  let hover = $state(null);
  const MAX_PER_COL = 12;
  const NH = 34;
  const GAP = 8;
  const PAD = 6;
  const COLS = [
    { id: 0, label: 'Changed files' },
    { id: 1, label: 'Changed symbols' },
    { id: 2, label: 'Importers, callers & tests' },
    { id: 3, label: 'Routes & contracts' },
  ];
  const colOf = (n) => (n.kind === 'symbol' ? 1 : n.kind === 'route' || n.kind === 'contract' ? 3 : n.changed ? 0 : 2);
  const degree = $derived.by(() => {
    const m = new Map();
    for (const e of edges) { m.set(e.from, (m.get(e.from) || 0) + 1); m.set(e.to, (m.get(e.to) || 0) + 1); }
    return m;
  });
  const columns = $derived.by(() => {
    const cols = COLS.map((c) => ({ ...c, all: [], nodes: [] }));
    for (const n of nodes) cols[colOf(n)].all.push(n);
    for (const c of cols) {
      c.all.sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0) || a.label.localeCompare(b.label));
      c.nodes = c.all.slice(0, MAX_PER_COL);
    }
    return cols.filter((c) => c.all.length);
  });
  const narrow = $derived(width < 620);
  const colW = $derived(columns.length ? (width - (columns.length - 1) * 36) / columns.length : width);
  const H = $derived(Math.max(...columns.map((c) => c.nodes.length), 1) * (NH + GAP) + 26);
  const pos = $derived.by(() => {
    const p = new Map();
    columns.forEach((c, ci) => {
      const x = ci * (colW + 36);
      const top = 24 + ((Math.max(...columns.map((k) => k.nodes.length)) - c.nodes.length) * (NH + GAP)) / 2;
      c.nodes.forEach((n, i) => p.set(n.id, { x, y: top + i * (NH + GAP), ci }));
    });
    return p;
  });
  const lines = $derived(edges.map((e) => {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) return null;
    let x1, x2;
    if (a.ci === b.ci) { x1 = a.x + colW; x2 = b.x + colW; }
    else if (a.ci < b.ci) { x1 = a.x + colW; x2 = b.x; }
    else { x1 = a.x; x2 = b.x + colW; }
    const y1 = a.y + NH / 2, y2 = b.y + NH / 2;
    const mx = a.ci === b.ci ? x1 + 28 : (x1 + x2) / 2;
    return { ...e, d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}` };
  }).filter(Boolean));
  const linked = $derived.by(() => {
    if (!hover) return null;
    const s = new Set([hover]);
    for (const e of edges) { if (e.from === hover) s.add(e.to); if (e.to === hover) s.add(e.from); }
    return s;
  });
  const ICON = { file: 'file', symbol: 'code', route: 'globe', test: 'check', contract: 'paperclip' };
  const summary = $derived(`Impact graph: ${nodes.filter((n) => n.changed).length} changed files, ${nodes.filter((n) => n.kind === 'symbol').length} symbols, ${nodes.filter((n) => !n.changed && (n.kind === 'file' || n.kind === 'test')).length} dependent files, ${nodes.filter((n) => n.kind === 'route').length} routes.`);
  const isFile = (n) => (n.kind === 'file' || n.kind === 'test' || n.kind === 'contract') && n.path;
</script>

<div class="ig" bind:clientWidth={width}>
  {#if narrow}
    <div class="list" aria-label={summary}>
      {#each columns as c (c.id)}
        <div class="lh eyebrow">{c.label} <span class="faint">{c.all.length}</span></div>
        <ul>
          {#each c.nodes as n (n.id)}
            <li class="ln k-{n.kind}" class:chg={n.changed}>
              <Icon name={ICON[n.kind] || 'dot'} size={12} />
              {#if isFile(n)}<EntityLink kind="file" id={n.path} label={n.label} title={n.path} />{:else}<span class="mono lbl" title={n.path || ''}>{n.label}</span>{/if}
              {#if n.removed}<span class="badge err xs">removed</span>{/if}
            </li>
          {/each}
          {#if c.all.length > c.nodes.length}<li class="faint tiny more">+{c.all.length - c.nodes.length} more in the list below</li>{/if}
        </ul>
      {/each}
    </div>
  {:else}
    <div class="wrap" style="height:{H}px">
      {#each columns as c, ci (c.id)}
        <div class="colh eyebrow" style="left:{ci * (colW + 36)}px;width:{colW}px">{c.label}{#if c.all.length > c.nodes.length} <span class="faint">({c.nodes.length} of {c.all.length})</span>{/if}</div>
      {/each}
      <svg {width} height={H} role="img" aria-label={summary}>
        {#each lines as e, i (i)}
          <path d={e.d} class="edge {e.kind}" class:hi={linked && linked.has(e.from) && linked.has(e.to) && (e.from === hover || e.to === hover)} class:dim={linked && !(e.from === hover || e.to === hover)} />
        {/each}
      </svg>
      {#each columns as c (c.id)}
        {#each c.nodes as n (n.id)}
          {@const p = pos.get(n.id)}
          <div
            class="node k-{n.kind}"
            class:chg={n.changed}
            class:dim={linked && !linked.has(n.id)}
            style="left:{p.x}px;top:{p.y}px;width:{colW}px;height:{NH}px"
            onmouseenter={() => (hover = n.id)}
            onmouseleave={() => (hover = null)}
            onfocusin={() => (hover = n.id)}
            onfocusout={() => (hover = null)}
            role="group"
            aria-label={`${n.kind} ${n.label}`}
          >
            <span class="ic"><Icon name={ICON[n.kind] || 'dot'} size={12} /></span>
            <span class="ellipsis lbl">
              {#if isFile(n)}<EntityLink kind="file" id={n.path} label={n.label} title={n.path} />{:else}<span class="mono" title={n.path ? `${n.label} (${n.path}${n.line ? `:${n.line}` : ''})` : n.label}>{n.label}</span>{/if}
            </span>
            {#if n.removed}<span class="badge err xs">removed</span>{/if}
          </div>
        {/each}
      {/each}
    </div>
    <div class="legend faint tiny">
      <span><i class="lg imports"></i>imports</span><span><i class="lg calls"></i>calls</span><span><i class="lg covers"></i>covers (tests)</span><span><i class="lg serves"></i>serves (routes)</span><span><i class="lg documents"></i>documents</span>
    </div>
  {/if}
</div>

<style>
  .ig { width: 100%; min-width: 0; }
  .wrap { position: relative; margin-top: 4px; }
  svg { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
  .colh { position: absolute; top: 0; font-size: 10.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .edge { fill: none; stroke: var(--border-strong); stroke-width: 1.4; transition: opacity var(--dur-fast), stroke var(--dur-fast); }
  .edge.calls { stroke: color-mix(in srgb, var(--accent) 60%, transparent); }
  .edge.covers { stroke: color-mix(in srgb, var(--ok) 60%, transparent); stroke-dasharray: 4 3; }
  .edge.serves { stroke: color-mix(in srgb, var(--info) 65%, transparent); }
  .edge.documents { stroke: var(--text-3); stroke-dasharray: 2 3; }
  .edge.defines { stroke: color-mix(in srgb, var(--warn) 55%, transparent); }
  .edge.hi { stroke-width: 2.4; opacity: 1; }
  .edge.dim { opacity: 0.15; }
  .node { position: absolute; box-sizing: border-box; display: flex; align-items: center; gap: 6px; padding: 0 9px; border-radius: 9px; background: var(--panel-solid); border: 1px solid var(--border-strong); font-size: 12px; transition: opacity var(--dur-fast), border-color var(--dur-fast); animation: fade-up 0.35s var(--ease) backwards; }
  .node.chg { border-color: color-mix(in srgb, var(--warn) 60%, transparent); background: color-mix(in srgb, var(--warn) 7%, var(--panel-solid)); }
  .node.k-symbol { border-style: dashed; }
  .node.k-route { border-color: color-mix(in srgb, var(--info) 55%, transparent); }
  .node.k-test { border-color: color-mix(in srgb, var(--ok) 50%, transparent); }
  .node.dim { opacity: 0.35; }
  .node:hover { border-color: var(--accent); }
  .ic { color: var(--text-3); display: inline-flex; flex: none; }
  .k-route .ic { color: var(--info); } .k-test .ic { color: var(--ok); } .chg .ic { color: var(--warn); }
  .lbl { min-width: 0; flex: 1; }
  .legend { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 10px; }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }
  .lg { display: inline-block; width: 16px; height: 0; border-top: 2px solid var(--border-strong); }
  .lg.calls { border-color: var(--accent); } .lg.covers { border-color: var(--ok); border-top-style: dashed; } .lg.serves { border-color: var(--info); } .lg.documents { border-color: var(--text-3); border-top-style: dotted; }
  .tiny { font-size: 11px; }
  .list ul { list-style: none; margin: 4px 0 12px; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .lh { margin-top: 4px; }
  .ln { display: flex; align-items: center; gap: 7px; padding: 6px 9px; border-radius: 8px; background: var(--inset); font-size: 12.5px; min-width: 0; overflow-wrap: anywhere; }
  .ln.chg { box-shadow: inset 3px 0 0 var(--warn); }
  .more { padding-left: 4px; }
</style>
