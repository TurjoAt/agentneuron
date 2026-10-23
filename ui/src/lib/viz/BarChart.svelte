<script>
  // Responsive vertical bar chart (single or stacked series) with per-column
  // hover tooltip. Rounded data-end, square baseline, 2px gaps between stacks.
  import { colorize, foldSeries } from './palette.js';
  import { niceTicks, fmtBucket, fmtBucketLong, tickIndices, defaultFmt, roundedTop } from './scale.js';
  import { app } from '../store.svelte.js';
  import Tooltip from './Tooltip.svelte';
  import Legend from './Legend.svelte';

  let {
    buckets = [], // timestamps, or use `labels`
    labels = null,
    series = [],
    bucket = 'day',
    height = 200,
    yFormat = defaultFmt,
    legend = true,
    label = 'Bar chart',
    onselect = null,
  } = $props();

  let width = $state(600);
  let hidden = $state(new Set());
  let hi = $state(-1);
  let tip = $state({ x: 0, y: 0 });
  let svgEl = $state();

  const M = { t: 10, r: 6, b: 24, l: 36 };
  const all = $derived(colorize(foldSeries(series.filter((s) => s && Array.isArray(s.values))), app.theme === 'light' ? 'light' : 'dark'));
  const shown = $derived(all.filter((s) => !hidden.has(s.key)));
  const n = $derived(labels ? labels.length : buckets.length);
  const iw = $derived(Math.max(10, width - M.l - M.r));
  const ih = $derived(Math.max(10, height - M.t - M.b));
  const totals = $derived(Array.from({ length: n }, (_, i) => shown.reduce((a, s) => a + (s.values[i] || 0), 0)));
  const dom = $derived(niceTicks(0, Math.max(1, ...totals), height < 160 ? 3 : 4));
  const band = $derived(iw / Math.max(1, n));
  const bw = $derived(Math.max(1.5, Math.min(28, band * 0.68)));
  const y = (v) => ih - (v / (dom.max || 1)) * ih;
  const xt = $derived(tickIndices(n, Math.max(2, Math.min(10, Math.floor(iw / 70)))));
  const lab = (i) => (labels ? labels[i] : fmtBucket(buckets[i], bucket));

  const bars = $derived.by(() => {
    const out = [];
    for (let i = 0; i < n; i++) {
      let acc = 0;
      const cx = band * i + band / 2 - bw / 2;
      const segs = [];
      for (const s of shown) {
        const v = s.values[i] || 0;
        if (v <= 0) continue;
        segs.push({ key: s.key, color: s.color, y0: y(acc), y1: y(acc + v) });
        acc += v;
      }
      segs.forEach((g, k) => {
        const top = k === segs.length - 1;
        const gap = k > 0 ? 2 : 0;
        const h = Math.max(0, g.y0 - g.y1 - gap);
        out.push({ i, key: g.key, color: g.color, d: top ? roundedTop(cx, g.y1, bw, h, Math.min(4, bw / 2)) : `M${cx},${g.y1}h${bw}v${h}h${-bw}Z` });
      });
    }
    return out;
  });

  function onmove(e) {
    const r = svgEl.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - M.l) / band);
    if (i < 0 || i >= n) { hi = -1; return; }
    hi = i;
    tip = { x: M.l + band * i + band / 2, y: e.clientY - r.top };
  }
  const rows = $derived(hi < 0 ? [] : shown.map((s) => ({ key: s.key, label: s.label ?? s.key, color: s.color, v: s.values[hi] || 0 })).filter((r) => r.v).sort((a, b) => b.v - a.v));
</script>

<div class="bc" bind:clientWidth={width}>
  <svg bind:this={svgEl} {width} {height} role="img" aria-label={label}>
    <g transform="translate({M.l},{M.t})">
      {#each dom.ticks as t (t)}
        <line class="grid" class:zero={t === 0} x1="0" x2={iw} y1={y(t)} y2={y(t)} />
        <text class="ax" x="-8" y={y(t)} dy="0.32em" text-anchor="end">{yFormat(t)}</text>
      {/each}
      {#if hi >= 0}<rect class="hl" x={band * hi} y="0" width={band} height={ih} rx="4" />{/if}
      <g class="bars">
        {#each bars as b, k (b.i + ':' + b.key)}
          <path d={b.d} style="fill:{b.color};animation-delay:{Math.min(400, b.i * 12)}ms" class:dim={hi >= 0 && hi !== b.i} />
        {/each}
      </g>
      {#each xt as i (i)}
        <text class="ax" x={band * i + band / 2} y={ih + 16} text-anchor="middle">{lab(i)}</text>
      {/each}
      <rect class="hit" x="0" y={-M.t} width={iw} height={height} role="presentation" onpointermove={onmove} onpointerleave={() => (hi = -1)} onclick={() => hi >= 0 && onselect?.(hi)} />
    </g>
  </svg>
  <Tooltip x={tip.x} y={Math.min(Math.max(tip.y, 40), height - 30)} {width} visible={hi >= 0}>
    <div class="vt-h">{labels ? labels[hi] : fmtBucketLong(buckets[hi], bucket)}</div>
    {#each rows.slice(0, 8) as r (r.key)}
      <div class="vt-r"><span class="vt-sw" style="background:{r.color}"></span><span class="k">{r.label}</span><b>{yFormat(r.v)}</b></div>
    {:else}
      <div class="vt-r"><span class="k">No data</span></div>
    {/each}
    {#if rows.length > 1}<div class="vt-r vt-f"><span class="k">Total</span><b>{yFormat(totals[hi])}</b></div>{/if}
  </Tooltip>
  {#if legend && all.length > 1}
    <div class="lg"><Legend items={all.map((s) => ({ key: s.key, label: s.label ?? s.key, color: s.color }))} bind:hidden /></div>
  {/if}
</div>

<style>
  .bc { position: relative; width: 100%; min-width: 0; }
  svg { display: block; overflow: visible; }
  .grid { stroke: var(--border); }
  .grid.zero { stroke: var(--border-strong); }
  .ax { fill: var(--text-3); font-size: 10.5px; font-variant-numeric: tabular-nums; }
  .hl { fill: var(--panel-hover); }
  .bars path { transform-box: fill-box; transform-origin: bottom; animation: grow 0.6s var(--ease) both; transition: opacity 0.15s; }
  .bars path.dim { opacity: 0.45; }
  @keyframes grow { from { transform: scaleY(0); } }
  .hit { fill: transparent; cursor: default; }
  .lg { margin-top: 6px; }
</style>
