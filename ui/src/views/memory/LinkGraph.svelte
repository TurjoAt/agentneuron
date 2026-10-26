<script>
  // Small radial graph of [[links]] between memories. Click a node to jump to its card.
  import { typeOf } from './types.js';

  let { memory = [], active = '', onselect } = $props();
  const W = 300;
  const H = 220;
  const R = 82;

  const g = $derived.by(() => {
    const names = memory.map((m) => m.name).filter(Boolean);
    const known = new Set(names);
    const missing = new Set();
    for (const m of memory) for (const l of m.links || []) if (!known.has(l)) missing.add(l);
    const all = [...names, ...missing];
    const n = all.length || 1;
    const pos = new Map(all.map((nm, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      return [nm, { x: W / 2 + Math.cos(a) * R * 1.35, y: H / 2 + Math.sin(a) * R }];
    }));
    const edges = [];
    for (const m of memory) for (const l of m.links || []) if (pos.has(m.name) && pos.has(l)) edges.push({ a: pos.get(m.name), b: pos.get(l), broken: !known.has(l), k: `${m.name}>${l}` });
    const deg = new Map();
    for (const e of edges) for (const p of [e.k.split('>')[0], e.k.split('>')[1]]) deg.set(p, (deg.get(p) || 0) + 1);
    const nodes = all.map((nm) => {
      const m = memory.find((x) => x.name === nm);
      return { nm, ...pos.get(nm), type: m?.type, missing: !m, stale: !!m?.stale?.length, r: 5 + Math.min(4, deg.get(nm) || 0) };
    });
    return { nodes, edges };
  });
  const color = (t) => ({ info: 'var(--info)', warn: 'var(--warn)', accent: 'var(--accent)', ok: 'var(--ok)' })[typeOf(t).tone] || 'var(--text-3)';
  const short = (s) => (s.length > 16 ? s.slice(0, 15) + '…' : s);
</script>

<svg viewBox="0 0 {W} {H}" class="lg" role="group" aria-label="Links between memories">
  {#each g.edges as e (e.k)}
    <line x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} class="ed" class:broken={e.broken} />
  {/each}
  {#each g.nodes as n (n.nm)}
    {#if n.missing}
      <g class="nd missing" transform="translate({n.x},{n.y})">
        <title>{n.nm} (missing)</title>
        <circle r={n.r} />
        <text y={n.r + 11}>{short(n.nm)}</text>
      </g>
    {:else}
      <g class="nd" class:on={active === n.nm} transform="translate({n.x},{n.y})" role="button" tabindex="0" aria-label="Jump to {n.nm}"
        onclick={() => onselect?.(n.nm)} onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onselect?.(n.nm))}>
        <title>{n.nm}</title>
        <circle r={n.r + 5} class="halo" style="fill:{color(n.type)}" />
        <circle r={n.r} style="fill:{color(n.type)}" />
        {#if n.stale}<circle r="2.6" cx={n.r - 1} cy={-n.r + 1} class="st" />{/if}
        <text y={n.r + 11}>{short(n.nm)}</text>
      </g>
    {/if}
  {/each}
</svg>

<style>
  .lg { width: 100%; height: auto; display: block; overflow: visible; }
  .ed { stroke: var(--border-strong); stroke-width: 1.2; }
  .ed.broken { stroke: var(--warn); stroke-dasharray: 3 3; opacity: 0.7; }
  .nd { cursor: pointer; outline: none; }
  .nd text { fill: var(--text-2); font-size: 8.5px; text-anchor: middle; font-family: var(--mono); pointer-events: none; }
  .nd .halo { opacity: 0; transition: opacity 0.2s; }
  .nd:hover .halo, .nd:focus-visible .halo, .nd.on .halo { opacity: 0.22; }
  .nd.on text { fill: var(--text); font-weight: 700; }
  .nd.missing { cursor: default; }
  .nd.missing circle { fill: transparent; stroke: var(--warn); stroke-dasharray: 2 2; }
  .nd.missing text { fill: var(--warn); }
  .st { fill: var(--warn); stroke: var(--panel-solid); stroke-width: 1.2; }
  @media (prefers-reduced-motion: reduce) { .nd .halo { transition: none; } }
</style>
