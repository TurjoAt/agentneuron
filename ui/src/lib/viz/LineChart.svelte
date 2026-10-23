<script>
  // Responsive SVG line / area / stacked-area chart with crosshair tooltip,
  // toggleable legend, optional previous-period overlay and threshold bands.
  import { line, area, curveMonotoneX } from 'd3-shape';
  import { colorize, foldSeries, NEUTRAL } from './palette.js';
  import { niceTicks, fmtBucket, fmtBucketLong, tickIndices, defaultFmt } from './scale.js';
  import { app } from '../store.svelte.js';
  import Tooltip from './Tooltip.svelte';
  import Legend from './Legend.svelte';

  let {
    buckets = [],
    series = [],
    mode = 'line', // line | area | stacked
    compare = null, // { label, values } aligned to buckets
    bucket = 'day',
    height = 220,
    yFormat = defaultFmt,
    yMin = null,
    yMax = null,
    bands = [], // [{ from, to, color, label }]
    legend = true,
    total = mode === 'stacked',
    label = 'Chart',
  } = $props();

  let width = $state(600);
  let hidden = $state(new Set());
  let hi = $state(-1);
  let svgEl = $state();
  let tip = $state({ x: 0, y: 0 });

  const M = { t: 10, r: 12, b: 24, l: 40 };
  const all = $derived(colorize(foldSeries(series.filter((s) => s && Array.isArray(s.values))), app.theme === 'light' ? 'light' : 'dark'));
  const shown = $derived(all.filter((s) => !hidden.has(s.key)));
  const n = $derived(buckets.length);
  const iw = $derived(Math.max(10, width - M.l - M.r));
  const ih = $derived(Math.max(10, height - M.t - M.b));

  // stacked layers: [lo, hi] per point
  const layers = $derived.by(() => {
    if (mode !== 'stacked') return null;
    const acc = new Array(n).fill(0);
    return shown.map((s) => {
      const pts = s.values.map((v, i) => {
        const lo = acc[i];
        acc[i] += v || 0;
        return [lo, acc[i]];
      });
      return { ...s, pts };
    });
  });

  const domain = $derived.by(() => {
    let lo = Infinity, hiV = -Infinity;
    if (mode === 'stacked' && layers?.length) {
      const top = layers[layers.length - 1].pts;
      for (const [, h] of top) hiV = Math.max(hiV, h);
      lo = 0;
    } else {
      for (const s of shown) for (const v of s.values) if (v != null) { lo = Math.min(lo, v); hiV = Math.max(hiV, v); }
    }
    if (compare?.values) for (const v of compare.values) if (v != null) hiV = Math.max(hiV, v);
    if (!Number.isFinite(lo)) { lo = 0; hiV = 1; }
    if (yMin != null) lo = yMin;
    else if (mode !== 'line' || lo > 0) lo = Math.min(0, lo);
    const t = niceTicks(lo, yMax ?? Math.max(hiV, lo + 1), height < 160 ? 3 : 4);
    if (yMax != null) t.max = yMax;
    return t;
  });

  const x = (i) => (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => ih - ((v - domain.min) / (domain.max - domain.min || 1)) * ih;

  const paths = $derived.by(() => {
    const curve = curveMonotoneX;
    if (mode === 'stacked' && layers) {
      const ar = area().x((_, i) => x(i)).y0((p) => y(p[0])).y1((p) => y(p[1])).curve(curve);
      const ln = line().x((_, i) => x(i)).y((p) => y(p[1])).curve(curve);
      return layers.map((l) => ({ key: l.key, color: l.color, area: ar(l.pts), line: ln(l.pts) }));
    }
    const ln = line().defined((v) => v != null).x((_, i) => x(i)).y((v) => y(v)).curve(curve);
    const ar = area().defined((v) => v != null).x((_, i) => x(i)).y0(y(Math.max(domain.min, 0))).y1((v) => y(v)).curve(curve);
    return shown.map((s) => ({ key: s.key, color: s.color, line: ln(s.values), area: mode === 'area' ? ar(s.values) : null }));
  });

  const comparePath = $derived(compare?.values?.length ? line().defined((v) => v != null).x((_, i) => x(i)).y((v) => y(v)).curve(curveMonotoneX)(compare.values.slice(0, n)) : null);
  const xt = $derived(tickIndices(n, Math.max(2, Math.min(8, Math.floor(iw / 80)))));
  const uid = Math.random().toString(36).slice(2, 8);

  function onmove(e) {
    const r = svgEl.getBoundingClientRect();
    const px = e.clientX - r.left - M.l;
    if (n === 0) return;
    const i = Math.max(0, Math.min(n - 1, Math.round((px / iw) * (n - 1))));
    hi = i;
    tip = { x: M.l + x(i), y: e.clientY - r.top };
  }

  const rows = $derived.by(() => {
    if (hi < 0) return [];
    return shown.map((s) => ({ key: s.key, label: s.label ?? s.key, color: s.color, v: s.values[hi] })).sort((a, b) => (b.v || 0) - (a.v || 0));
  });
  const sum = $derived(rows.reduce((a, r) => a + (r.v || 0), 0));
  const legendItems = $derived([
    ...all.map((s) => ({ key: s.key, label: s.label ?? s.key, color: s.color })),
    ...(compare?.values ? [{ key: '__prev', label: compare.label || 'Previous period', color: NEUTRAL[app.theme === 'light' ? 'light' : 'dark'], dash: true }] : []),
  ]);
</script>

<div class="lc" bind:clientWidth={width}>
  <svg bind:this={svgEl} {width} {height} role="img" aria-label={label}>
    <defs>
      <clipPath id="clip-{uid}"><rect class="reveal" x="0" y="-4" width={iw + 2} height={ih + 8} /></clipPath>
      {#each paths as p (p.key)}
        <linearGradient id="g-{uid}-{p.key.replace(/[^\w-]/g, '_')}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={p.color} stop-opacity={mode === 'stacked' ? 0.55 : 0.28} />
          <stop offset="1" stop-color={p.color} stop-opacity={mode === 'stacked' ? 0.32 : 0} />
        </linearGradient>
      {/each}
    </defs>
    <g transform="translate({M.l},{M.t})">
      {#each bands as b, k (k)}
        <rect x="0" width={iw} y={y(Math.min(b.to, domain.max))} height={Math.max(0, y(Math.max(b.from, domain.min)) - y(Math.min(b.to, domain.max)))} style="fill:{b.color}" opacity="0.07" />
      {/each}
      {#each domain.ticks as t (t)}
        <line class="grid" class:zero={t === 0} x1="0" x2={iw} y1={y(t)} y2={y(t)} />
        <text class="ax" x="-8" y={y(t)} dy="0.32em" text-anchor="end">{yFormat(t)}</text>
      {/each}
      {#each xt as i (i)}
        <text class="ax" x={x(i)} y={ih + 16} text-anchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'}>{fmtBucket(buckets[i], bucket)}</text>
      {/each}
      <g clip-path="url(#clip-{uid})">
        {#if comparePath}<path d={comparePath} class="prev" style="stroke:{NEUTRAL[app.theme === 'light' ? 'light' : 'dark']}" />{/if}
        {#each paths as p (p.key)}
          {#if p.area}<path d={p.area} fill="url(#g-{uid}-{p.key.replace(/[^\w-]/g, '_')})" />{/if}
          <path d={p.line} class="ln" style="stroke:{p.color}" />
        {/each}
      </g>
      {#if hi >= 0}
        <line class="cross" x1={x(hi)} x2={x(hi)} y1="0" y2={ih} />
        {#each shown as s, k (s.key)}
          {@const v = mode === 'stacked' ? layers[k].pts[hi][1] : s.values[hi]}
          {#if v != null}<circle cx={x(hi)} cy={y(v)} r="4" class="dot" style="fill:{s.color}" />{/if}
        {/each}
      {/if}
      <rect class="hit" x={-M.l} y={-M.t} width={width} height={height} role="presentation"
        onpointermove={onmove}
        onpointerleave={() => (hi = -1)} />
    </g>
  </svg>
  <Tooltip x={tip.x} y={Math.min(Math.max(tip.y, 40), height - 30)} {width} visible={hi >= 0 && rows.length > 0}>
    <div class="vt-h">{fmtBucketLong(buckets[hi], bucket)}</div>
    {#each rows.slice(0, 8) as r (r.key)}
      <div class="vt-r"><span class="vt-sw" style="background:{r.color}"></span><span class="k">{r.label}</span><b>{yFormat(r.v ?? 0)}</b></div>
    {/each}
    {#if total && rows.length > 1}<div class="vt-r vt-f"><span class="k">Total</span><b>{yFormat(sum)}</b></div>{/if}
    {#if compare?.values && compare.values[hi] != null}<div class="vt-r vt-f"><span class="k">{compare.label || 'Previous period'}</span><b>{yFormat(compare.values[hi])}</b></div>{/if}
  </Tooltip>
  {#if legend && legendItems.length > 1}
    <div class="lg"><Legend items={legendItems.filter((l) => l.key !== '__prev')} bind:hidden />{#if compare?.values}<Legend items={legendItems.filter((l) => l.key === '__prev')} toggle={false} />{/if}</div>
  {/if}
</div>

<style>
  .lc { position: relative; width: 100%; min-width: 0; }
  svg { display: block; overflow: visible; }
  .grid { stroke: var(--border); stroke-width: 1; }
  .grid.zero { stroke: var(--border-strong); }
  .ax { fill: var(--text-3); font-size: 10.5px; font-variant-numeric: tabular-nums; }
  .ln { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .prev { fill: none; stroke-width: 1.5; stroke-dasharray: 4 4; opacity: 0.9; }
  .cross { stroke: var(--text-3); stroke-width: 1; stroke-dasharray: 2 3; }
  .dot { stroke: var(--panel-solid); stroke-width: 2; }
  .hit { fill: transparent; cursor: crosshair; }
  .reveal { animation: reveal 0.9s var(--ease) both; }
  @keyframes reveal { from { width: 0; } }
  .lg { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px; }
</style>
