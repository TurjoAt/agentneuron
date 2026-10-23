<script>
  // Button that runs a registry action; disabled with the reason as tooltip
  // (and an inline hint when `hint` is set) when the level is off.
  import { runAction, actionEnabled } from '../../lib/actions.js';
  import Icon from '../../lib/Icon.svelte';

  let { id, params = {}, label, icon = null, cls = '', hint = false, opts = {}, onrun = null, children } = $props();
  const st = $derived(actionEnabled(id));
  async function go() {
    if (!st.enabled) return;
    const j = await runAction(id, params, opts);
    if (j) onrun?.(j);
  }
</script>

<span class="ab">
  <button class="btn {cls}" disabled={!st.enabled} title={st.enabled ? '' : st.reason} onclick={go}>
    {#if icon}<Icon name={icon} size={14} />{/if}
    {#if children}{@render children()}{:else}{label}{/if}
  </button>
  {#if hint && !st.enabled}<span class="why faint" title={st.reason}>needs {st.level || 'permission'}</span>{/if}
</span>

<style>
  .ab { display: inline-flex; align-items: center; gap: 6px; }
  .why { font-size: 11px; }
</style>
