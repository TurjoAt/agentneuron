<script>
  // Segmented progress of acceptance criteria by status, with a text summary (never color alone).
  import { CRIT, CRIT_ORDER } from './shared.js';
  let { summary } = $props();
  const total = $derived(summary?.criteria || 0);
  const parts = $derived(CRIT_ORDER.map((k) => ({ k, n: summary?.[k] || 0 })).filter((p) => p.n));
  const text = $derived(total ? `${total} requested: ${parts.map((p) => `${p.n} ${CRIT[p.k].label}`).join(', ')}` : 'No acceptance criteria');
</script>

<div class="cb">
  <div class="bar" role="img" aria-label={text}>
    {#each parts as p (p.k)}<span class="seg {CRIT[p.k].tone || 'none'}" style="flex:{p.n}" title="{p.n} {CRIT[p.k].label}"></span>{/each}
  </div>
  <div class="lbl">{text}</div>
</div>

<style>
  .cb { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .bar { display: flex; gap: 2px; height: 8px; border-radius: 99px; overflow: hidden; background: var(--panel-active); }
  .seg { min-width: 4px; transition: flex 0.6s var(--ease); }
  .seg.ok { background: var(--ok); }
  .seg.err { background: var(--err); }
  .seg.warn { background: var(--warn); }
  .seg.none { background: var(--text-3); opacity: 0.55; }
  .lbl { font-size: 12px; color: var(--text-2); }
</style>
