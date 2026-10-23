<script>
  // Period-over-period delta pill: arrow + signed % (or absolute). `invert` for
  // metrics where down is good. Neutral when |Δ| < 0.5%.
  let { now = null, prev = null, invert = false, abs = false, format = (v) => String(Math.round(v)), suffix = '' } = $props();
  const diff = $derived(now != null && prev != null ? now - prev : null);
  const pct = $derived(diff == null ? null : prev === 0 ? (now === 0 ? 0 : null) : (diff / Math.abs(prev)) * 100);
  const dir = $derived(diff == null ? 0 : (abs ? Math.abs(diff) < 1e-9 : Math.abs(pct ?? 100) < 0.5) ? 0 : diff > 0 ? 1 : -1);
  const good = $derived(dir === 0 ? null : (dir > 0) !== invert);
  const text = $derived(diff == null ? '—' : abs || pct == null ? `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${format(Math.abs(diff))}${suffix}` : `${pct > 0 ? '+' : pct < 0 ? '−' : '±'}${Math.abs(pct) >= 100 ? Math.round(Math.abs(pct)) : Math.abs(pct).toFixed(1)}%`);
</script>

<span class="dl" class:good={good === true} class:bad={good === false} title={prev != null ? `previous: ${format(prev)}${suffix}` : ''}>
  <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
    {#if dir > 0}<path d="M5 1.5 9 7.5H1z" />{:else if dir < 0}<path d="M5 8.5 1 2.5h8z" />{:else}<rect x="1.5" y="4" width="7" height="2" rx="1" />{/if}
  </svg>
  <span class="tnum">{text}</span>
</span>

<style>
  .dl { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 600; color: var(--text-3); white-space: nowrap; }
  svg { fill: currentColor; }
  .good { color: var(--ok); }
  .bad { color: var(--err); }
</style>
