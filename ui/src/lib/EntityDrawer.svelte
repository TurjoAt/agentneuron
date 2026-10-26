<script>
  // Scaffold: shows the entity payload; agent C turns this into the full side panel.
  import { api } from './api.js';
  import { entity, closeEntity, entityHref } from './entity.svelte.js';

  let data = $state(null);
  let error = $state('');
  $effect(() => {
    const cur = entity.current;
    data = null; error = '';
    if (!cur) return;
    api('/api/usage/entity', { kind: cur.kind, id: cur.id }).then((d) => { if (entity.current === cur) data = d; }).catch((e) => { error = e.message; });
  });
</script>

{#if entity.current}
  <aside class="edrawer" aria-label="Details">
    <header>
      <span class="k">{entity.current.kind}</span>
      <strong>{data?.title || entity.current.label || entity.current.id}</strong>
      <button class="x" onclick={closeEntity} aria-label="Close">×</button>
    </header>
    {#if error}<p class="err">{error}</p>{:else if !data}<p class="muted">Loading…</p>{:else}
      <a href={entityHref(entity.current.kind, entity.current.id)} onclick={closeEntity}>Open page</a>
    {/if}
  </aside>
{/if}

<style>
  .edrawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(420px, 100vw); background: var(--bg-1, var(--bg)); border-left: 1px solid var(--border); z-index: 60; padding: 16px; overflow: auto; }
  header { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
  .k { font-size: 11px; text-transform: uppercase; color: var(--text-3); }
  .x { margin-left: auto; background: none; border: 0; color: inherit; font-size: 20px; cursor: pointer; }
  .err { color: var(--err); }
</style>
