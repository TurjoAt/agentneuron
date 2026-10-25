<script>
  // Tiny trend line with soft area and an end-point marker. Optional dashed
  // previous-period overlay. Width follows the container.
  import { line, area, curveMonotoneX } from 'd3-shape';
  let { values = [], prev = null, height = 30, color = 'var(--accent)', fill = true, label = 'Trend', min = null, draw = false } = $props();
  // draw: opt-in draw-in animation of the line (and fade of the area) on mount.
  let width = $state(120);
  const uid = Math.random().toString(36).slice(2, 8);

  const vals = $derived((values || []).map((v) => (Number.isFinite(v) ? v : 0)));
  const dom = $derived.by(() => {
    const all = [...vals, ...((prev || []).filter(Number.isFinite))];
    let lo = min ?? Math.min(0, ...all);
    let hi = Math.max(...all, lo + 1);
    return [lo, hi];
  });
  const x = (i, n) => (n <= 1 ? width / 2 : 2 + (i / (n - 1)) * (width - 6));
  const y = (v) => height - 3 - ((v - dom[0]) / (dom[1] - dom[0] || 1)) * (height - 7);
  const ln = $derived(vals.length ? line().x((_, i) => x(i, vals.length)).y(y).curve(curveMonotoneX)(vals) : '');
  const ar = $derived(vals.length ? area().x((_, i) => x(i, vals.length)).y0(height).y1(y).curve(curveMonotoneX)(vals) : '');
  const pl = $derived(prev?.length ? line().x((_, i) => x(i, prev.length)).y((v) => y(v || 0)).curve(curveMonotoneX)(prev) : '');
  const last = $derived(vals.length ? { x: x(vals.length - 1, vals.length), y: y(vals[vals.length - 1]) } : null);
</script>

<div class="sp" class:draw bind:clientWidth={width} style="height:{height}px">
  <svg {width} {height} role="img" aria-label={label}>
    <defs>
      <linearGradient id="sg-{uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color:{color}" stop-opacity="0.28" />
        <stop offset="1" style="stop-color:{color}" stop-opacity="0" />
      </linearGradient>
    </defs>
    {#if pl}<path d={pl} class="prev" />{/if}
    {#if fill && ar}<path d={ar} fill="url(#sg-{uid})" class="ar" />{/if}
    {#if ln}<path d={ln} class="ln" style="stroke:{color}" pathLength="1" />{/if}
    {#if last}<circle cx={last.x} cy={last.y} r="2.6" style="fill:{color}" class="end" />{/if}
  </svg>
</div>

<style>
  .sp { width: 100%; min-width: 0; }
  svg { display: block; overflow: visible; }
  .ln { fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .prev { fill: none; stroke: var(--text-3); stroke-width: 1; stroke-dasharray: 2 3; opacity: 0.7; }
  .end { stroke: var(--panel-solid); stroke-width: 1.5; }
  .draw .ln { stroke-dasharray: 1; stroke-dashoffset: 1; animation: sp-draw 1.1s var(--ease) 0.15s forwards; }
  .draw .ar { opacity: 0; animation: sp-fade 0.8s var(--ease) 0.6s forwards; }
  .draw .end { opacity: 0; animation: sp-fade 0.4s var(--ease) 1.1s forwards; }
  @keyframes sp-draw { to { stroke-dashoffset: 0; } }
  @keyframes sp-fade { to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) {
    .draw .ln { stroke-dasharray: none; stroke-dashoffset: 0; animation: none; }
    .draw .ar, .draw .end { opacity: 1; animation: none; }
  }
</style>
