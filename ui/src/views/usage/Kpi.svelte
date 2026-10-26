<script>
  // KPI tile for the usage cockpit: value (tweened), trend pill, sparkline and
  // an optional detail line (snippet). The trend compares the later half of the
  // range with the earlier half; the pill says so in its tooltip.
  import Sparkline from '../../lib/viz/Sparkline.svelte';
  import Delta from '../../lib/viz/Delta.svelte';
  import Counter from '../../lib/Counter.svelte';
  import { halves } from './shared.js';

  let { label, value = null, format = (v) => String(v), spark = null, invert = false, color = 'var(--accent)', hint = '', detail = null, badge = null, trend = true } = $props();
  const h = $derived(trend && spark ? halves(spark) : null);
</script>

<div class="card kpi" title={hint}>
  <div class="top"><span class="eyebrow">{label}</span>{#if badge}{@render badge()}{/if}</div>
  <div class="row">
    <div class="big tnum">{#if value == null}<span class="faint">—</span>{:else}<Counter {value} {format} />{/if}</div>
    {#if h && value != null && h.prev > 0}<span title="Second half of the range vs the first half"><Delta now={h.now} prev={h.prev} {invert} {format} /></span>{/if}
  </div>
  {#if detail}<div class="dt">{@render detail()}</div>{/if}
  <div class="sp">{#if spark && spark.length > 1}<Sparkline values={spark} {color} {label} draw />{/if}</div>
</div>

<style>
  .kpi { padding: 13px 15px 10px; display: flex; flex-direction: column; gap: 3px; min-width: 0; overflow: hidden; }
  .top { display: flex; align-items: center; gap: 6px; min-height: 18px; }
  .row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .big { font-size: 24px; font-weight: 700; letter-spacing: -0.03em; line-height: 1.15; }
  .dt { font-size: 11.5px; color: var(--text-3); display: flex; gap: 6px; flex-wrap: wrap; align-items: center; min-height: 16px; }
  .sp { height: 28px; margin-top: auto; }
</style>
