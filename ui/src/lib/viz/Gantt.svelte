<script>
  // Compact time ruler / gantt: one lane per agent (bar from start to end) plus
  // event ticks on the main lane; a cursor line shows the current position.
  // Click or drag to seek (onseek(ts)); arrow keys step through `marks`.
  import { fmtTime } from '../format.js';

  let {
    from = 0,
    to = 1,
    lanes = [], // [{ key, label, start, end, color }]
    marks = [], // [{ ts, color, lane?: key, tall?: bool, title? }]
    cursor = null,
    onseek = null,
    label = 'Session time ruler',
  } = $props();

  let width = $state(600);
  const LH = 16;
  const GAP = 6;
  const LW = $derived(width < 480 ? 64 : 104);
  const H = $derived(lanes.length * (LH + GAP) + 22);
  const span = $derived(Math.max(1, to - from));
  const x = (ts) => LW + ((ts - from) / span) * Math.max(10, width - LW - 8);
  const laneY = (key) => Math.max(0, lanes.findIndex((l) => l.key === key)) * (LH + GAP);
  const ticks = $derived.by(() => {
    const n = width < 480 ? 3 : 6;
    return Array.from({ length: n + 1 }, (_, i) => from + (span * i) / n);
  });

  let dragging = false;
  function seekAt(e) {
    if (!onseek) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const ts = from + ((px - LW) / Math.max(10, width - LW - 8)) * span;
    onseek(Math.max(from, Math.min(to, ts)));
  }
  function onkeydown(e) {
    if (!onseek || !marks.length) return;
    const sorted = marks.map((m) => m.ts).sort((a, b) => a - b);
    const cur = cursor ?? from;
    if (e.key === 'ArrowRight') { const n = sorted.find((t) => t > cur + 1); if (n != null) onseek(n); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { const p = [...sorted].reverse().find((t) => t < cur - 1); if (p != null) onseek(p); e.preventDefault(); }
    if (e.key === 'Home') { onseek(sorted[0]); e.preventDefault(); }
    if (e.key === 'End') { onseek(sorted[sorted.length - 1]); e.preventDefault(); }
  }
</script>

<div class="gt" bind:clientWidth={width}>
  <svg {width} height={H} role="slider" tabindex="0" aria-label={label} aria-valuemin={from} aria-valuemax={to} aria-valuenow={cursor ?? from}
    aria-valuetext={cursor ? fmtTime(cursor) : 'start'} {onkeydown}
    onpointerdown={(e) => { dragging = true; e.currentTarget.setPointerCapture?.(e.pointerId); seekAt(e); }}
    onpointermove={(e) => dragging && seekAt(e)} onpointerup={() => (dragging = false)} onpointercancel={() => (dragging = false)}>
    {#each ticks as t, i (i)}
      <line class="grid" x1={x(t)} x2={x(t)} y1="0" y2={H - 18} />
      <text class="tl" x={x(t)} y={H - 4} text-anchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}>{fmtTime(t).slice(0, 5)}</text>
    {/each}
    {#each lanes as l (l.key)}
      {@const y = laneY(l.key)}
      <text class="ll" x="0" y={y + LH - 4}>{l.label.length > (LW < 100 ? 8 : 14) ? l.label.slice(0, LW < 100 ? 7 : 13) + '…' : l.label}<title>{l.label}</title></text>
      <rect class="bar" x={x(l.start)} y={y + 2} width={Math.max(3, x(l.end) - x(l.start))} height={LH - 4} rx="4" style="fill:{l.color}" />
    {/each}
    {#each marks as m, i (i)}
      {@const y = laneY(m.lane || lanes[0]?.key)}
      <rect class="mk" x={x(m.ts) - (m.tall ? 1 : 0.75)} y={y + (m.tall ? -1 : 3)} width={m.tall ? 2 : 1.5} height={m.tall ? LH + 2 : LH - 6} style="fill:{m.color}"><title>{m.title || ''}</title></rect>
    {/each}
    {#if cursor != null}
      <line class="cur" x1={x(cursor)} x2={x(cursor)} y1="-2" y2={H - 16} />
      <circle class="curh" cx={x(cursor)} cy={H - 16} r="4" />
    {/if}
  </svg>
</div>

<style>
  .gt { width: 100%; min-width: 0; user-select: none; touch-action: pan-y; }
  svg { display: block; cursor: crosshair; overflow: visible; border-radius: 6px; }
  svg:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
  .grid { stroke: var(--border); stroke-dasharray: 2 3; }
  .tl { font-size: 10px; fill: var(--text-3); font-variant-numeric: tabular-nums; }
  .ll { font-size: 10.5px; fill: var(--text-2); }
  .bar { opacity: 0.32; }
  .mk { opacity: 0.95; }
  .cur { stroke: var(--text); stroke-width: 1.5; }
  .curh { fill: var(--text); stroke: var(--panel-solid); stroke-width: 2; }
</style>
