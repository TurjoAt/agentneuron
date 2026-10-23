<script>
  // Tiny trend line with soft area and an end-point marker. Optional dashed
  // previous-period overlay. Width follows the container.
  import { line, area, curveMonotoneX } from 'd3-shape';
  let { values = [], prev = null, height = 30, color = 'var(--accent)', fill = true, label = 'Trend', min = null } = $props();
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

<div class="sp" bind:clientWidth={width} style="height:{height}px">
  <svg {width} {height} role="img" aria-label={label}>
    <defs>
      <linearGradient id="sg-{uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color:{color}" stop-opacity="0.28" />
        <stop offset="1" style="stop-color:{color}" stop-opacity="0" />
      </linearGradient>
    </defs>
    {#if pl}<path d={pl} class="prev" />{/if}
    {#if fill && ar}<path d={ar} fill="url(#sg-{uid})" />{/if}
    {#if ln}<path d={ln} class="ln" style="stroke:{color}" />{/if}
    {#if last}<circle cx={last.x} cy={last.y} r="2.6" style="fill:{color}" class="end" />{/if}
  </svg>
</div>

<style>
  .sp { width: 100%; min-width: 0; }
  svg { display: block; overflow: visible; }
  .ln { fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .prev { fill: none; stroke: var(--text-3); stroke-width: 1; stroke-dasharray: 2 3; opacity: 0.7; }
  .end { stroke: var(--panel-solid); stroke-width: 1.5; }
</style>
