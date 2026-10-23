<script>
  import { STATUS } from './gx.svelte.js';
  let { f, on = false, onclick, children } = $props();
  const p = $derived(typeof f === 'string' ? f : f.path);
  const s = $derived(typeof f === 'string' ? '?' : f.status || 'M');
</script>
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="g-row" class:on role="button" tabindex="0" onclick={onclick} onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onclick?.())}>
  <span class="st {s === '?' ? 'q' : s[0]}" title={STATUS[s[0]] || s}>{s === '?' ? 'U' : s[0]}</span>
  <span class="mono grow ellipsis small" title={p}>{p}</span>
  {#if typeof f !== 'string' && (f.added || f.removed)}<span class="tiny mono"><span class="add">+{f.added}</span> <span class="del">−{f.removed}</span></span>{/if}
  {#if children}<span class="acts" onclick={(e) => e.stopPropagation()} role="presentation">{@render children()}</span>{/if}
</div>
