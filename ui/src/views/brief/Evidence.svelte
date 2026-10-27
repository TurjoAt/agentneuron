<script>
  // Evidence chips: each links to the thing it cites (session replay, commit, file, run, task, checkpoint).
  import EntityLink from '../../lib/EntityLink.svelte';
  import Icon from '../../lib/Icon.svelte';
  import { href } from '../../lib/nav.js';
  import { timeAgo } from '../../lib/format.js';

  let { evidence = [], max = 4 } = $props();
  const ICON = { session: 'message', commit: 'commit', file: 'file', run: 'play', task: 'board', checkpoint: 'restore', error: 'alert', config: 'settings' };
  const list = $derived((Array.isArray(evidence) ? evidence : []).filter((e) => e && e.kind));
  // collapse repeated refs of the same kind ("session S1 ×3")
  const groups = $derived.by(() => {
    const m = new Map();
    for (const e of list) {
      const k = `${e.kind}|${e.ref ?? ''}`;
      const g = m.get(k) || { ...e, n: 0 };
      g.n++;
      if (e.ts && (!g.ts || e.ts > g.ts)) g.ts = e.ts;
      m.set(k, g);
    }
    return [...m.values()];
  });
  const short = (e) => {
    const r = String(e.ref ?? '');
    if (e.kind === 'commit') return r.slice(0, 7);
    if (e.kind === 'session') return r.length > 10 ? r.slice(0, 8) : r;
    return r;
  };
  const fileOf = (r) => String(r || '').replace(/:\d+$/, '');
  const isRel = (p) => p && !/^([/\\~]|[A-Za-z]:)/.test(p);
</script>

{#if groups.length}
  <span class="ev" aria-label="Evidence">
    {#each groups.slice(0, max) as e, i (i)}
      <span class="chip ev-chip" title={`${e.kind}${e.ref ? `: ${e.ref}` : ''}${e.ts ? ` · ${new Date(e.ts).toLocaleString()}` : ''}`}>
        <Icon name={ICON[e.kind] || 'dot'} size={11} />
        {#if e.kind === 'session' && e.ref}<EntityLink kind="session" id={e.ref} label={short(e)} mono />
        {:else if e.kind === 'commit' && e.ref}<EntityLink kind="commit" id={e.ref} label={short(e)} mono />
        {:else if e.kind === 'file' && isRel(e.ref)}<EntityLink kind="file" id={fileOf(e.ref)} label={e.ref} mono />
        {:else if e.kind === 'task' && e.ref}<EntityLink kind="task" id={e.ref} label={e.ref} mono />
        {:else if e.kind === 'run' && e.ref}<a class="mono" href={href('ship', { tab: 'runs', id: e.ref })}>{short(e)}</a>
        {:else if e.kind === 'checkpoint' && e.ref}<a class="mono" href={href('changes', { tab: 'checkpoints', id: e.ref })}>{short(e)}</a>
        {:else}<span class="mono">{short(e) || e.kind}</span>{/if}
        {#if e.n > 1}<span class="n">×{e.n}</span>{/if}
        {#if e.ts && e.kind !== 'file'}<span class="ts">{timeAgo(e.ts)}</span>{/if}
      </span>
    {/each}
    {#if groups.length > max}<span class="more">+{groups.length - max}</span>{/if}
  </span>
{/if}

<style>
  .ev { display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; min-width: 0; }
  .ev-chip { height: 20px; padding: 0 7px; font-size: 11px; gap: 4px; max-width: 100%; cursor: default; }
  .ev-chip a { color: inherit; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 22ch; }
  .ev-chip a:hover { color: var(--accent); }
  .ev-chip :global(.elink) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 22ch; display: inline-block; vertical-align: bottom; }
  .n, .ts { color: var(--text-3); font-variant-numeric: tabular-nums; }
  .more { font-size: 11px; color: var(--text-3); }
</style>
