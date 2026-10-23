<script>
  import Sparkline from '../../lib/viz/Sparkline.svelte';
  import Delta from '../../lib/viz/Delta.svelte';
  import Counter from '../../lib/Counter.svelte';

  let { label, value = null, prev = null, spark = null, sparkPrev = null, invert = false, compare = true, suffix = '', color = 'var(--accent)', hint = '' } = $props();
</script>

<div class="card kpi" title={hint}>
  <div class="eyebrow">{label}</div>
  <div class="row">
    <div class="big tnum">{#if value == null}—{:else}<Counter {value} />{suffix}{/if}</div>
    {#if compare && value != null && prev != null}<Delta now={value} {prev} {invert} />{/if}
  </div>
  <div class="sp">
    {#if spark && spark.length > 1}<Sparkline values={spark} prev={compare ? sparkPrev : null} {color} {label} />{/if}
  </div>
  {#if compare && prev != null}<div class="faint tiny">prev {prev.toLocaleString()}{suffix}</div>{/if}
</div>

<style>
  .kpi { padding: 14px 16px 12px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .big { font-size: 26px; font-weight: 700; letter-spacing: -0.03em; line-height: 1.15; }
  .sp { height: 30px; margin-top: 2px; }
  .tiny { font-size: 11px; }
</style>
