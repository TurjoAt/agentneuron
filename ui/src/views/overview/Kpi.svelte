<script>
  import Counter from '../../lib/Counter.svelte';
  import Sparkline from '../../lib/viz/Sparkline.svelte';
  import Delta from '../../lib/viz/Delta.svelte';

  let { label, value = 0, href = '#/overview', sub = '', spark = null, color = 'var(--accent)', now = null, prev = null, invert = false, suffix = '' } = $props();
</script>

<a class="kpi card" {href}>
  <div class="eyebrow">{label}</div>
  <div class="v">
    <span class="big"><Counter {value} /></span>{#if suffix}<span class="sfx">{suffix}</span>{/if}
    {#if now != null && prev != null}<Delta {now} {prev} {invert} />{/if}
  </div>
  {#if spark && spark.length > 1}
    <div class="sp"><Sparkline values={spark} {color} height={26} label="{label} trend" /></div>
  {:else}
    <div class="sp sub faint">{sub}</div>
  {/if}
  {#if spark && sub}<div class="faint small">{sub}</div>{/if}
</a>

<style>
  .kpi { padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; min-width: 0; text-decoration: none; color: inherit; transition: border-color 0.2s, transform 0.2s var(--ease); }
  .kpi:hover { border-color: var(--border-strong); transform: translateY(-1px); text-decoration: none; }
  .v { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .big { font-size: 28px; font-weight: 700; letter-spacing: -0.035em; line-height: 1.15; }
  .sfx { font-size: 14px; color: var(--text-3); margin-left: -4px; }
  .sp { min-height: 26px; margin-top: 2px; }
  .sub { font-size: 12px; padding-top: 6px; }
  .small { font-size: 11.5px; }
</style>
