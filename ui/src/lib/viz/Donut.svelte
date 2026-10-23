<script>
  // Donut with hover focus: center shows the hovered slice (or the total).
  import { pie, arc } from 'd3-shape';
  import { colorize } from './palette.js';
  import { app } from '../store.svelte.js';
  import { defaultFmt } from './scale.js';

  let { items = [], size = 168, thickness = 18, format = defaultFmt, centerLabel = 'total', legend = true, max = 7, onselect = null } = $props();

  let hi = $state(null);
  const data = $derived.by(() => {
    const sorted = items.filter((d) => d.value > 0).slice().sort((a, b) => b.value - a.value);
    let list = sorted;
    if (sorted.length > max) {
      const rest = sorted.slice(max - 1);
      list = [...sorted.slice(0, max - 1), { key: 'other', label: `Other (${rest.length})`, value: rest.reduce((a, d) => a + d.value, 0) }];
    }
    return colorize(list, app.theme === 'light' ? 'light' : 'dark');
  });
  const total = $derived(data.reduce((a, d) => a + d.value, 0));
  const r = $derived(size / 2);
  const arcs = $derived.by(() => {
    const p = pie().value((d) => d.value).sort(null).padAngle(data.length > 1 ? 0.025 : 0);
    const a = arc().innerRadius(r - thickness).outerRadius(r).cornerRadius(3);
    const aHi = arc().innerRadius(r - thickness - 2).outerRadius(r + 3).cornerRadius(3);
    return p(data).map((s) => ({ ...s, d: a(s), dHi: aHi(s) }));
  });
  const cur = $derived(hi ? data.find((d) => d.key === hi) : null);
</script>

<div class="dn">
  <svg width={size + 8} height={size + 8} viewBox="{-r - 4} {-r - 4} {size + 8} {size + 8}" role="img" aria-label="Donut chart, {data.length} slices">
    {#each arcs as a (a.data.key)}
      <path d={hi === a.data.key ? a.dHi : a.d} style="fill:{a.data.color}" class:dim={hi && hi !== a.data.key} role="presentation"
        onpointerenter={() => (hi = a.data.key)} onpointerleave={() => (hi = null)} onclick={() => onselect?.(a.data)}><title>{a.data.label ?? a.data.key}: {format(a.data.value)}</title></path>
    {/each}
    <text class="cv" y="-2" text-anchor="middle">{format(cur ? cur.value : total)}</text>
    <text class="cl" y="16" text-anchor="middle">{cur ? (cur.label ?? cur.key) : centerLabel}</text>
    {#if cur}<text class="cp" y="31" text-anchor="middle">{((cur.value / (total || 1)) * 100).toFixed(1)}%</text>{/if}
  </svg>
  {#if legend}
    <div class="dl">
      {#each data as d (d.key)}
        <button class="dr" class:on={hi === d.key} onpointerenter={() => (hi = d.key)} onpointerleave={() => (hi = null)} onclick={() => onselect?.(d)}>
          <span class="sw" style="background:{d.color}"></span>
          <span class="k">{d.label ?? d.key}</span>
          <span class="p tnum">{((d.value / (total || 1)) * 100).toFixed(d.value / total < 0.1 ? 1 : 0)}%</span>
          <b class="tnum">{format(d.value)}</b>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .dn { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; min-width: 0; }
  svg { flex-shrink: 0; overflow: visible; }
  path { transition: opacity 0.15s, d 0.25s var(--ease); cursor: pointer; animation: pop 0.7s var(--ease) both; transform-origin: 0 0; }
  @keyframes pop { from { opacity: 0; transform: rotate(-30deg) scale(0.9); } }
  path.dim { opacity: 0.35; }
  .cv { fill: var(--text); font-size: 22px; font-weight: 700; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
  .cl { fill: var(--text-3); font-size: 11px; }
  .cp { fill: var(--text-2); font-size: 11px; font-weight: 600; }
  .dl { flex: 1; min-width: 160px; display: flex; flex-direction: column; gap: 1px; }
  .dr { display: flex; align-items: center; gap: 8px; border: 0; background: none; padding: 4px 6px; border-radius: 6px; font-size: 12px; color: var(--text-2); cursor: pointer; text-align: left; }
  .dr:hover, .dr.on { background: var(--panel-hover); color: var(--text); }
  .sw { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; }
  .k { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .p { color: var(--text-3); font-size: 11px; }
  b { color: var(--text); font-weight: 600; min-width: 42px; text-align: right; }
</style>
