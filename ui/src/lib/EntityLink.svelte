<script>
  // Click opens the entity side panel; Ctrl/Cmd/Shift/middle click follows the deep link.
  // Usage: <EntityLink kind="session" id={s.sessionId} label={s.title} />
  import { openEntity, entityHref, entityLabel } from './entity.svelte.js';

  let { kind, id, label = '', title = '', mono = false, class: cls = '', children } = $props();
  const text = $derived(label || entityLabel(kind, id));

  function onclick(e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    openEntity(kind, id, label);
  }
</script>

{#if id == null || id === ''}<span class={cls}>{#if children}{@render children()}{:else}{label || '—'}{/if}</span>{:else}<a
    class="elink {cls}"
    class:mono
    href={entityHref(kind, id)}
    {onclick}
    data-entity={kind}
    title={title || `${kind[0].toUpperCase()}${kind.slice(1)}: ${label || id} (click for details)`}>{#if children}{@render children()}{:else}{text}{/if}</a>{/if}

<style>
  .elink {
    color: inherit;
    text-decoration: none;
    border-bottom: 1px dotted color-mix(in srgb, currentColor 38%, transparent);
    transition: color 0.15s, border-color 0.15s;
    overflow-wrap: anywhere;
  }
  .elink:hover { color: var(--accent); border-bottom-color: var(--accent); text-decoration: none; }
  .elink:focus-visible { border-radius: 3px; }
  .mono { font-family: var(--mono); font-size: 0.92em; }
</style>
