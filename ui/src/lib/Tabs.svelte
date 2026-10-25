<script>
  // Segmented tabs with a sliding active indicator. The indicator is measured
  // only when `active`/`tabs` change or the strip resizes; `.on` styling stays
  // as a fallback before the first measurement.
  import { tick } from 'svelte';
  let { tabs = [], active = $bindable(), onchange } = $props();

  let strip = $state();
  let ind = $state(null); // { x, w }
  let ready = $state(false); // enable the slide transition after first placement

  function measure() {
    const el = strip?.querySelector('.tab.on');
    if (!el) return (ind = null);
    ind = { x: el.offsetLeft, w: el.offsetWidth };
  }
  $effect(() => {
    void active;
    void tabs;
    tick().then(() => {
      measure();
      if (!ready) requestAnimationFrame(() => (ready = true));
    });
  });
  $effect(() => {
    if (!strip) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(strip);
    return () => ro.disconnect();
  });
</script>

<div class="tabs" class:slide={!!ind} class:ready role="tablist" bind:this={strip}>
  {#if ind}<span class="ind" aria-hidden="true" style="transform:translateX({ind.x}px);width:{ind.w}px"></span>{/if}
  {#each tabs as t (t.id)}
    <button
      role="tab"
      class="tab"
      class:on={active === t.id}
      aria-selected={active === t.id}
      onclick={() => {
        active = t.id;
        onchange?.(t.id);
      }}
    >
      {t.label}
      {#if t.count != null}<span class="n tnum">{t.count}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .tabs {
    position: relative;
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    border-radius: 11px;
    background: var(--inset);
    border: 1px solid var(--border);
    max-width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tab {
    border: 0;
    background: transparent;
    height: 28px;
    padding: 0 12px;
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 550;
    color: var(--text-2);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    transition: color 0.15s, background 0.2s var(--ease);
  }
  .tab:hover { color: var(--text); }
  .tab.on {
    color: var(--text);
    background: var(--panel-solid);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25), 0 0 0 1px var(--border);
  }
  .ind {
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 0;
    border-radius: 8px;
    background: var(--panel-solid);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25), 0 0 0 1px var(--border);
    pointer-events: none;
  }
  .ready .ind { transition: transform 0.32s var(--ease), width 0.32s var(--ease); }
  .tab { position: relative; z-index: 1; }
  .slide .tab.on { background: transparent; box-shadow: none; }
  .n {
    font-size: 11px;
    color: var(--text-3);
  }
</style>
