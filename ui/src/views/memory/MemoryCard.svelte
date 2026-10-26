<script>
  // One memory file: type badge, description, links to other memories, stale-claim warnings, Markdown body.
  import { app } from '../../lib/store.svelte.js';
  import { timeAgo, fmtDate } from '../../lib/format.js';
  import Markdown from '../../lib/Markdown.svelte';
  import Icon from '../../lib/Icon.svelte';
  import { typeOf, memId } from './types.js';

  let { m, known, highlighted = false, onjump } = $props();
  let open = $state(false);
  const t = $derived(typeOf(m.type));
  const links = $derived(Array.isArray(m.links) ? m.links : []);
  const stale = $derived(Array.isArray(m.stale) ? m.stale : []);
  // render [[name]] as plain text in the body; the link chips below are the navigable form
  const body = $derived(typeof m.body === 'string' ? m.body.replace(/\[\[([^\]]+)\]\]/g, '`$1`') : null);
</script>

<article class="card mem" class:hl={highlighted} class:stale={stale.length} id={memId(m.name)} tabindex="-1" aria-labelledby="{memId(m.name)}-t">
  <header class="mh">
    <span class="badge {t.tone}" title={t.hint}><Icon name={t.icon} size={11} />{t.label}</span>
    <h3 class="nm mono ellipsis" id="{memId(m.name)}-t" title={m.file || m.name}>{m.name || m.file || 'untitled'}</h3>
    <span class="spacer"></span>
    {#if m.updatedAt}<time class="faint tiny" datetime={new Date(m.updatedAt).toISOString()} title={fmtDate(m.updatedAt)}>{timeAgo(m.updatedAt, app.now)}</time>{/if}
  </header>

  {#if m.description}<p class="desc">{m.description}</p>{/if}

  {#if stale.length}
    <ul class="stalel" aria-label="Stale claims">
      {#each stale as s, i (i)}
        <li>
          <Icon name="alert" size={13} />
          <span class="grow"><code>{String(s.claim || '—').replace(/^`+|`+$/g, '')}</code> <span class="muted">{s.reason || 'no longer matches the repo'}</span></span>
          <a class="fix" href="#/verify" title="Open Truth &amp; safety">Check</a>
        </li>
      {/each}
    </ul>
  {/if}

  {#if links.length}
    <div class="links" aria-label="Linked memories">
      <Icon name="link" size={12} />
      {#each links as l (l)}
        {#if known.has(l)}
          <button class="lk mono" onclick={() => onjump?.(l)} title="Jump to {l}">{l}</button>
        {:else}
          <span class="lk broken mono" title="Linked memory does not exist">{l}</span>
        {/if}
      {/each}
    </div>
  {/if}

  {#if m.body === null || m.body === undefined}
    <p class="hidden faint"><Icon name="lock" size={12} /> Content hidden for viewers</p>
  {:else if body}
    <button class="tog" aria-expanded={open} onclick={() => (open = !open)}>
      <span class="chev" class:open><Icon name="chevron" size={11} /></span>{open ? 'Hide content' : 'Show content'}
    </button>
    {#if open}<div class="body"><Markdown source={body} path={m.file || ''} /></div>{/if}
  {/if}
</article>

<style>
  .mem { padding: 14px 16px; display: flex; flex-direction: column; gap: 9px; scroll-margin: 80px; transition: box-shadow 0.3s var(--ease), border-color 0.3s; }
  .mem.stale { border-color: color-mix(in srgb, var(--warn) 30%, var(--border)); }
  .mem.hl { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft), var(--shadow); }
  .mh { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .nm { margin: 0; font-size: 13px; font-weight: 650; color: var(--text); }
  .tiny { font-size: 11.5px; white-space: nowrap; }
  .desc { margin: 0; font-size: 13px; color: var(--text-2); line-height: 1.5; }
  .stalel { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .stalel li { display: flex; align-items: flex-start; gap: 8px; padding: 7px 10px; border-radius: var(--radius-sm); background: var(--warn-soft); color: var(--warn); font-size: 12.5px; }
  .stalel li :global(.icon) { margin-top: 2px; flex-shrink: 0; }
  .stalel code { font-family: var(--mono); font-size: 11.5px; color: var(--text); overflow-wrap: anywhere; }
  .fix { font-weight: 600; font-size: 12px; white-space: nowrap; color: var(--warn); }
  .links { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; color: var(--text-3); }
  .lk { border: 1px solid var(--border); background: var(--inset); color: var(--accent); border-radius: 6px; padding: 1px 7px; font-size: 11.5px; cursor: pointer; }
  .lk:hover { border-color: var(--accent); }
  .lk.broken { color: var(--text-3); text-decoration: line-through; cursor: default; }
  .hidden { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 12px; }
  .tog { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; padding: 2px 0; color: var(--text-3); font-size: 12px; cursor: pointer; }
  .tog:hover { color: var(--text); }
  .chev { display: inline-grid; transition: transform 0.18s var(--ease); }
  .chev.open { transform: rotate(90deg); }
  .body { border-top: 1px solid var(--border); padding-top: 10px; font-size: 13px; overflow-x: auto; }
  @media (prefers-reduced-motion: reduce) { .mem, .chev { transition: none; } }
</style>
