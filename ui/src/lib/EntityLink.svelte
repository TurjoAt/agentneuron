<script>
  // Click opens the entity side panel; Ctrl/Cmd/middle click follows the deep link.
  import { openEntity, entityHref } from './entity.svelte.js';

  let { kind, id, label = '', title = '', class: cls = '', children } = $props();

  function onclick(e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openEntity(kind, id, label);
  }
</script>

<a class="elink {cls}" href={entityHref(kind, id)} {onclick} title={title || `Open ${kind} ${label || id}`}>{#if children}{@render children()}{:else}{label || id}{/if}</a>

<style>
  .elink { color: inherit; text-decoration: none; border-bottom: 1px dotted color-mix(in srgb, currentColor 40%, transparent); }
  .elink:hover { color: var(--accent); border-bottom-color: var(--accent); }
</style>
