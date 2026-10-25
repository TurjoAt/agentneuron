<script>
  // GitHub-style activity calendar: weeks as columns, Mon..Sun rows, one-hue
  // sequential ramp (accent), month labels, hover tooltip, Less→More legend.
  import { onMount } from 'svelte';
  import Tooltip from './Tooltip.svelte';

  let { data = [], days = 365, cell = 11, gap = 3, unit = 'changes', onselect = null } = $props();

  let scroller = $state();
  let hi = $state(null);
  let tip = $state({ x: 0, y: 0 });
  let width = $state(0);
  const DAY = 86_400_000;
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const grid = $derived.by(() => {
    const m = new Map(data.map((d) => [String(d.date).slice(0, 10), d.count || 0]));
    const end = new Date();
    end.setHours(12, 0, 0, 0);
    const start = new Date(end.getTime() - (days - 1) * DAY);
    const dow = (start.getDay() + 6) % 7; // Monday = 0
    start.setTime(start.getTime() - dow * DAY);
    const cells = [];
    const months = [];
    let lastMonth = -1;
    let max = 0;
    for (let t = start.getTime(), i = 0; t <= end.getTime(); t += DAY, i++) {
      const d = new Date(t);
      const w = Math.floor(i / 7);
      const k = key(d);
      const c = m.get(k) || 0;
      max = Math.max(max, c);
      cells.push({ w, r: i % 7, k, c, d });
      if (d.getMonth() !== lastMonth && i % 7 === 0) {
        months.push({ w, label: d.toLocaleDateString(undefined, { month: 'short' }) });
        lastMonth = d.getMonth();
      }
    }
    const weeks = Math.ceil(cells.length / 7);
    // quantile-ish thresholds over non-zero values
    const nz = cells.map((c) => c.c).filter((c) => c > 0).sort((a, b) => a - b);
    const q = (p) => nz[Math.min(nz.length - 1, Math.floor(p * nz.length))] || 1;
    const th = [q(0.25), q(0.5), q(0.75)];
    const total = cells.reduce((a, c) => a + c.c, 0);
    const active = nz.length;
    return { cells, months, weeks, th, max, total, active };
  });
  const level = (c) => (c <= 0 ? 0 : c <= grid.th[0] ? 1 : c <= grid.th[1] ? 2 : c <= grid.th[2] ? 3 : 4);
  const L = 26; // left gutter for weekday labels
  const T = 16;
  const W = $derived(L + grid.weeks * (cell + gap));
  const H = $derived(T + 7 * (cell + gap));

  onMount(() => {
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  });

  function enter(e, c) {
    hi = c;
    const r = scroller.getBoundingClientRect();
    const b = e.currentTarget.getBoundingClientRect();
    tip = { x: b.left - r.left + cell / 2, y: b.top - r.top + cell / 2 };
  }
</script>

<div class="ch" bind:clientWidth={width}>
  <div class="scroll" bind:this={scroller}>
    <svg width={W} height={H} role="img" aria-label="Activity calendar: {grid.total} {unit} on {grid.active} days">
      {#each grid.months as m (m.w)}
        <text class="ml" x={L + m.w * (cell + gap)} y="10">{m.label}</text>
      {/each}
      {#each [['Mon', 0], ['Wed', 2], ['Fri', 4]] as [lbl, r] (lbl)}
        <text class="ml" x="0" y={T + r * (cell + gap) + cell - 2}>{lbl}</text>
      {/each}
      {#each grid.cells as c (c.k)}
        <rect class="c l{level(c.c)}" class:on={hi?.k === c.k} x={L + c.w * (cell + gap)} y={T + c.r * (cell + gap)} width={cell} height={cell} rx="2.5"
          role="presentation" onpointerenter={(e) => enter(e, c)} onpointerleave={() => (hi = null)} onclick={() => onselect?.(c)} />
      {/each}
    </svg>
    <Tooltip x={tip.x} y={tip.y} width={W} visible={!!hi}>
      {#if hi}<div class="vt-h">{hi.d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>
        <div class="vt-r"><span class="k">{unit}</span><b>{hi.c}</b></div>{/if}
    </Tooltip>
  </div>
  <div class="foot">
    <span class="faint">{grid.total.toLocaleString()} {unit} · {grid.active} active days</span>
    <span class="spacer"></span>
    <span class="faint">Less</span>
    {#each [0, 1, 2, 3, 4] as l (l)}<span class="c sw l{l}"></span>{/each}
    <span class="faint">More</span>
  </div>
</div>

<style>
  .ch { min-width: 0; }
  .scroll { position: relative; overflow-x: auto; padding-bottom: 4px; }
  svg { display: block; }
  .ml { fill: var(--text-3); font-size: 10px; }
  .c { fill: var(--panel-active); transition: stroke 0.1s; }
  rect.c { cursor: pointer; }
  rect.c.on { stroke: var(--text); stroke-width: 1.2; }
  .l1 { fill: color-mix(in srgb, var(--accent) 30%, var(--panel-solid)); }
  .l2 { fill: color-mix(in srgb, var(--accent) 52%, var(--panel-solid)); }
  .l3 { fill: color-mix(in srgb, var(--accent) 76%, var(--panel-solid)); }
  .l4 { fill: var(--accent); }
  .foot { display: flex; align-items: center; gap: 4px; font-size: 11px; margin-top: 6px; flex-wrap: wrap; }
  .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2.5px; background: var(--panel-active); }
  .sw.l1 { background: color-mix(in srgb, var(--accent) 30%, var(--panel-solid)); }
  .sw.l2 { background: color-mix(in srgb, var(--accent) 52%, var(--panel-solid)); }
  .sw.l3 { background: color-mix(in srgb, var(--accent) 76%, var(--panel-solid)); }
  .sw.l4 { background: var(--accent); }
</style>
