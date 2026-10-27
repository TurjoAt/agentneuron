<script>
  // One brief section: a titled list of items, each with its text (label / title / command / quote) and evidence.
  import Icon from '../../lib/Icon.svelte';
  import Evidence from './Evidence.svelte';

  let { title, icon = 'list', items = [], empty = 'Nothing recorded.', tone = '' } = $props();
  const list = $derived(Array.isArray(items) ? items : []);
</script>

<section class="sec" aria-label={title}>
  <h3 class="sec-h"><span class="ico {tone}"><Icon name={icon} size={13} /></span>{title}<span class="n">{list.length}</span></h3>
  {#if !list.length}
    <p class="muted small">{empty}</p>
  {:else}
    <ul class="items">
      {#each list as it, i (i)}
        <li class:resolved={it.resolved}>
          <div class="txt">
            {#if it.label}<span class="label">{it.label}</span>{/if}
            {#if it.title}<span class="title">{it.label ? ': ' : ''}{it.title}</span>{/if}
            {#if it.status}<span class="badge {it.status === 'completed' || it.status === 'verified' ? 'ok' : it.status === 'failed' ? 'err' : it.status === 'in_progress' ? 'info' : ''}">{it.status.replace('_', ' ')}</span>{/if}
            {#if it.command}<code class="cmd">{it.command}</code>{/if}
            {#if it.quote}<q class="quote">{it.quote}</q>{/if}
          </div>
          <Evidence evidence={it.evidence} />
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .sec { min-width: 0; }
  .sec-h { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 650; margin: 0 0 8px; }
  .sec-h .n { color: var(--text-3); font-weight: 500; font-variant-numeric: tabular-nums; }
  .ico { width: 22px; height: 22px; border-radius: 7px; display: grid; place-items: center; background: var(--panel-active); color: var(--text-2); }
  .ico.ok { background: var(--ok-soft); color: var(--ok); }
  .ico.err { background: var(--err-soft); color: var(--err); }
  .ico.warn { background: var(--warn-soft); color: var(--warn); }
  .ico.info { background: var(--info-soft); color: var(--info); }
  .items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .items li { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border-radius: var(--radius-xs); background: var(--inset); border: 1px solid var(--border); min-width: 0; }
  .items li.resolved { opacity: 0.7; }
  .txt { font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; min-width: 0; }
  .label { font-weight: 550; }
  .title { color: var(--text); }
  .txt .badge { margin-left: 6px; }
  .cmd { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 5px; background: var(--panel-active); font-family: var(--mono); font-size: 12px; max-width: 100%; overflow-wrap: anywhere; }
  .quote { display: block; margin-top: 3px; color: var(--text-2); font-size: 12px; quotes: '“' '”'; }
  .small { font-size: 12px; margin: 0; }
</style>
