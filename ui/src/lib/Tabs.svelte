<script>
  let { tabs = [], active = $bindable(), onchange } = $props();
</script>

<div class="tabs" role="tablist">
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
  .n {
    font-size: 11px;
    color: var(--text-3);
  }
</style>
