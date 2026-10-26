<script>
  // Plans tab: saved plans (~/.claude/plans/*.md), newest first, with checklist progress.
  import { untrack } from 'svelte';
  import { app } from '../../lib/store.svelte.js';
  import { timeAgo, fmtDate } from '../../lib/format.js';
  import Markdown from '../../lib/Markdown.svelte';
  import Empty from '../../lib/Empty.svelte';
  import Icon from '../../lib/Icon.svelte';

  let { plans = [], focus = '' } = $props();
  const sorted = $derived(plans.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
  let sel = $state(untrack(() => focus));
  const cur = $derived(sorted.find((p) => p.file === sel) || sorted[0] || null);
  const progress = (body) => {
    if (typeof body !== 'string') return null;
    const done = (body.match(/^\s*[-*] \[[xX]\]/gm) || []).length;
    const all = (body.match(/^\s*[-*] \[[ xX]\]/gm) || []).length;
    return all ? { done, all } : null;
  };
</script>

{#if !sorted.length}
  <div class="card"><Empty icon="list" title="No saved plans">Plans appear here when you use plan mode in Claude Code.</Empty></div>
{:else}
  <div class="grid">
    <nav class="card list" aria-label="Plans">
      {#each sorted as p (p.file)}
        {@const pr = progress(p.body)}
        <button class="pl" class:on={cur?.file === p.file} aria-current={cur?.file === p.file ? 'true' : undefined} onclick={() => (sel = p.file)}>
          <span class="col" style="gap:3px;min-width:0">
            <span class="t ellipsis">{p.title || p.file}</span>
            <span class="faint tiny ellipsis"><span class="mono">{p.file}</span> · {timeAgo(p.updatedAt, app.now)}</span>
          </span>
          {#if pr}<span class="badge {pr.done === pr.all ? 'ok' : ''} tnum">{pr.done}/{pr.all}</span>{/if}
        </button>
      {/each}
    </nav>
    {#if cur}
      <article class="card doc">
        <header class="card-h">
          <Icon name="list" size={15} />
          <span class="ellipsis">{cur.title || cur.file}</span>
          <span class="spacer"></span>
          <span class="sub" title={fmtDate(cur.updatedAt)}>updated {timeAgo(cur.updatedAt, app.now)}</span>
        </header>
        <div class="card-b">
          {#if cur.body == null}
            <p class="faint hidden"><Icon name="lock" size={12} /> Content hidden for viewers</p>
          {:else}
            <Markdown source={cur.body} path={cur.file || ''} />
          {/if}
        </div>
      </article>
    {/if}
  </div>
{/if}

<style>
  .grid { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 16px; align-items: start; }
  .list { padding: 6px; display: flex; flex-direction: column; gap: 2px; }
  .pl { display: flex; align-items: center; gap: 10px; border: 0; background: transparent; text-align: left; padding: 9px 10px; border-radius: var(--radius-sm); cursor: pointer; color: var(--text-2); min-width: 0; }
  .pl:hover { background: var(--panel-hover); }
  .pl.on { background: var(--accent-soft); color: var(--text); }
  .t { font-weight: 600; font-size: 13px; color: var(--text); }
  .tiny { font-size: 11.5px; }
  .doc { min-width: 0; overflow-x: auto; }
  .hidden { display: flex; align-items: center; gap: 6px; font-size: 12.5px; }
  @media (max-width: 860px) { .grid { grid-template-columns: minmax(0, 1fr); } }
</style>
