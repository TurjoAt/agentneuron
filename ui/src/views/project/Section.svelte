<script>
  import Icon from '../../lib/Icon.svelte';
  let { id, title, icon = 'layers', sub = '', actions, children } = $props();
</script>

<section class="card sec" {id}>
  <div class="card-h">
    <Icon name={icon} size={15} /> {title}
    {#if sub}<span class="sub">{sub}</span>{/if}
    <span class="grow"></span>
    {#if actions}{@render actions()}{/if}
  </div>
  <div class="body">{@render children()}</div>
</section>

<style>
  .sec { scroll-margin-top: 64px; }
  .card-h { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .grow { flex: 1; }
  .body { padding: 0 16px 16px; min-width: 0; }
</style>
