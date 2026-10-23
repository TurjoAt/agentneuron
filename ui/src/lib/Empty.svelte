<script>
  import Icon from './Icon.svelte';
  let { icon = 'info', title = 'Nothing here', children } = $props();
</script>

<div class="empty">
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
  .t { color: var(--text); font-weight: 600; }
  .s { font-size: 13px; max-width: 420px; }
</style>
