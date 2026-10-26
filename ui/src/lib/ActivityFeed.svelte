<script>
  import { fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import { app, openFile } from './store.svelte.js';
  import { timeAgo, basename, dirname, fmtTime } from './format.js';
  import { dur } from './motion.js';
  import ToolBadge from './ToolBadge.svelte';
  import Icon from './Icon.svelte';
  import Empty from './Empty.svelte';
  import EntityLink from './EntityLink.svelte';

  let { limit = 40, filter = null } = $props();
  const items = $derived((filter ? app.events.filter(filter) : app.events).slice(0, limit));
  const ICON = { add: 'plus', change: 'edit', unlink: 'minus' };
  const VERB = { add: 'created', change: 'modified', unlink: 'deleted' };
</script>

{#if !items.length}
  <Empty icon="zap" title="Waiting for changes">Edits to tracked markdown appear here in real time.</Empty>
{:else}
  <ol class="feed">
    {#each items as ev (ev.id ?? ev.ts + ev.path)}
      <li
        class="ev {ev.type}"
        in:fly={{ y: -14, duration: dur(420), easing: cubicOut }}
        animate:flip={{ duration: dur(300) }}
      >
        <span class="ic"><Icon name={ICON[ev.type] || 'edit'} size={12} stroke={2.2} /></span>
        <div class="body">
          <div class="line1">
            <button class="path" onclick={() => openFile(ev.path, { drawer: true })} disabled={ev.type === 'unlink'} title={ev.path}>
              {#if dirname(ev.path)}<span class="dir">{dirname(ev.path)}/</span>{/if}<span class="base">{basename(ev.path)}</span>
            </button>
            <span class="verb">{VERB[ev.type] || ev.type}</span>
            {#if ev.stats && (ev.stats.added || ev.stats.removed)}
              <span class="st add">+{ev.stats.added}</span><span class="st del">−{ev.stats.removed}</span>
            {/if}
          </div>
          {#if ev.agent}
            <div class="agent" title={ev.agent.lastPrompt || ''}>
              <ToolBadge tool={ev.agent.tool} compact />
              <span class="ellipsis">{#if ev.agent.sessionId}<EntityLink kind="session" id={ev.agent.sessionId} label={ev.agent.title || ev.agent.sessionId.slice(0, 8)} title={ev.agent.lastPrompt || ''} />{:else}{ev.agent.title || '—'}{/if}</span>
            </div>
          {/if}
        </div>
        <time class="ts tnum" title={fmtTime(ev.ts)}>{timeAgo(ev.ts, app.now)}</time>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .feed { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .ev {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: start;
    padding: 9px 4px;
    border-bottom: 1px solid var(--border);
    position: relative;
  }
  .ev:last-child { border-bottom: 0; }
  .ic {
    width: 22px;
    height: 22px;
    border-radius: 7px;
    display: grid;
    place-items: center;
    background: var(--accent-soft);
    color: var(--accent);
    margin-top: 1px;
  }
  .add .ic { background: var(--ok-soft); color: var(--ok); }
  .unlink .ic { background: var(--err-soft); color: var(--err); }
  .body { min-width: 0; }
  .line1 { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; font-size: 13px; }
  .path {
    border: 0;
    background: none;
    padding: 0;
    cursor: pointer;
    font-family: var(--mono);
    font-size: 12.5px;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }
  .path:hover .base { color: var(--accent); }
  .path:disabled { cursor: default; text-decoration: line-through; opacity: 0.7; }
  .dir { color: var(--text-3); }
  .base { color: var(--text); font-weight: 600; }
  .verb { color: var(--text-3); font-size: 12px; }
  .st { font: 600 11.5px var(--mono); }
  .st.add { color: var(--ok); }
  .st.del { color: var(--err); }
  .agent { display: flex; align-items: center; gap: 6px; margin-top: 3px; font-size: 11.5px; color: var(--text-2); min-width: 0; }
  .ts { font-size: 11.5px; color: var(--text-3); white-space: nowrap; padding-top: 2px; }
</style>
