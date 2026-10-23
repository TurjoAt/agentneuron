<script>
  // Toggleable legend. `hidden` is a bindable Set of keys.
  let { items = [], hidden = $bindable(new Set()), toggle = true } = $props();

  function flip(k) {
    if (!toggle) return;
    const s = new Set(hidden);
    if (s.has(k)) s.delete(k);
    else if (s.size < items.length - 1) s.add(k);
    hidden = s;
  }
</script>

<div class="vlegend" role="list">
  {#each items as it (it.key)}
    <button class="li" class:off={hidden.has(it.key)} role="listitem" onclick={() => flip(it.key)} disabled={!toggle} aria-pressed={!hidden.has(it.key)}>
      {#if it.dash}
        <svg width="16" height="8" aria-hidden="true"><line x1="0" y1="4" x2="16" y2="4" style="stroke:{it.color}" stroke-width="2" stroke-dasharray="3 3" /></svg>
      {:else}
        <span class="sw" style="background:{it.color}"></span>
      {/if}
      <span class="lb">{it.label ?? it.key}</span>
      {#if it.value != null}<span class="v tnum">{it.value}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .vlegend { display: flex; flex-wrap: wrap; gap: 2px 4px; }
  .li { display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; padding: 3px 6px; border-radius: 6px; font-size: 11.5px; color: var(--text-2); cursor: pointer; }
  .li:disabled { cursor: default; }
  .li:not(:disabled):hover { background: var(--panel-hover); color: var(--text); }
  .li.off { opacity: 0.4; }
  .li.off .lb { text-decoration: line-through; }
  .sw { width: 9px; height: 9px; border-radius: 3px; }
  .v { color: var(--text-3); }
</style>
