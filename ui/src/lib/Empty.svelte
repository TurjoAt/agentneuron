<script>
  import Icon from './Icon.svelte';
  let { icon = 'info', title = 'Nothing here', compact = false, children } = $props();
</script>

<div class="empty" class:compact>
  <div class="ico"><Icon name={icon} size={20} /></div>
  <div class="t">{title}</div>
  {#if children}<div class="s">{@render children()}</div>{/if}
</div>

<style>
  .ico {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    background: var(--panel-active);
    border: 1px solid var(--border);
    color: var(--text-2);
    margin-bottom: 4px;
  }
  .empty .ico { animation: empty-float 0.6s var(--ease) backwards; }
  .compact .ico { width: 36px; height: 36px; border-radius: 10px; }
  .t { color: var(--text); font-weight: 600; }
  .s { font-size: 13px; max-width: 420px; }
  @keyframes empty-float { from { opacity: 0; transform: translateY(6px) scale(0.92); } to { opacity: 1; transform: none; } }
</style>
