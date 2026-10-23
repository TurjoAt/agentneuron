<script>
  import { GIT_STATUS } from './tools.js';
  let { status } = $props();
  const s = $derived(status ? GIT_STATUS[status] || { label: status, cls: 'mod' } : null);
</script>

{#if s}
  <span class="gs {s.cls}" title="git: {s.label}">{status === '?' ? 'U' : status}</span>
{/if}

<style>
  .gs {
    display: inline-grid;
    place-items: center;
    width: 17px;
    height: 17px;
    border-radius: 5px;
    font: 700 10px/1 var(--mono);
    flex-shrink: 0;
  }
  .mod { color: var(--warn); background: var(--warn-soft); }
  .add { color: var(--ok); background: var(--ok-soft); }
  .del { color: var(--err); background: var(--err-soft); }
  .unt { color: var(--info); background: var(--info-soft); }
  .ren { color: var(--accent); background: var(--accent-soft); }
</style>
