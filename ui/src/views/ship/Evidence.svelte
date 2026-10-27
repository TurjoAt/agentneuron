<script>
  // One evidence item: commit / file / test / run / manual.
  import Icon from '../../lib/Icon.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';
  import { href } from '../../lib/nav.js';

  let { e } = $props();
  const ICON = { commit: 'commit', file: 'file', test: 'check', run: 'play', manual: 'user' };
  const tone = $derived(e.status === 'failed' ? 'err' : e.status === 'passed' ? 'ok' : '');
</script>

<span class="ev {tone}">
  <Icon name={e.status === 'failed' ? 'x' : ICON[e.kind] || 'dot'} size={11} />
  {#if e.kind === 'commit'}<EntityLink kind="commit" id={e.ref} label={e.label} />
  {:else if e.kind === 'file'}<EntityLink kind="file" id={e.ref} label={e.label} mono />
  {:else if (e.kind === 'test' || e.kind === 'run') && e.ref}<a href={href('ship', { tab: 'runs', run: e.ref })}>{e.label}</a>{#if e.path} <EntityLink kind="file" id={e.path} label="{e.path}{e.line ? `:${e.line}` : ''}" mono />{/if}
  {:else}<span>{e.label}</span>{/if}
</span>

<style>
  .ev { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--text-2); background: var(--panel-active); border-radius: 6px; padding: 2px 7px; max-width: 100%; min-width: 0; overflow-wrap: anywhere; }
  .ev.ok { color: var(--ok); background: var(--ok-soft); }
  .ev.err { color: var(--err); background: var(--err-soft); }
  a { color: inherit; text-decoration: none; border-bottom: 1px dotted color-mix(in srgb, currentColor 40%, transparent); }
  a:hover { color: var(--accent); }
</style>
