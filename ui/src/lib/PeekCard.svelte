<script>
  // Global hover peek for any <a data-path> + right-click file menu.
  import { fade } from 'svelte/transition';
  import { api } from './api.js';
  import { app, fileIndex, openFile } from './store.svelte.js';
  import { renderMarkdown } from './markdown.js';
  import { fmtNum, timeAgo, toMs } from './format.js';
  import { dur } from './motion.js';
  import { openMenu } from './menu.svelte.js';
  import { fileMenuItems } from './fileActions.js';
  import ToolBadge from './ToolBadge.svelte';
  import Icon from './Icon.svelte';

  const cache = new Map();
  let peek = $state(null); // { path, x, y, above }
  let content = $state(null);
  let showT = 0;
  let hideT = 0;
  const fine = typeof matchMedia !== 'undefined' && matchMedia('(hover: hover) and (pointer: fine)').matches;

  async function load(path) {
    if (cache.has(path)) return cache.get(path);
    let c = '';
    try {
      const r = await api('/api/file/raw', { path });
      c = r?.content ?? '';
    } catch {
      try {
        const r = await api('/api/file', { path });
        c = r?.content ?? '';
      } catch {
        c = null;
      }
    }
    cache.set(path, c);
    setTimeout(() => cache.delete(path), 20_000);
    return c;
  }

  function anchorOf(e) {
    const a = e.target?.closest?.('[data-path]');
    if (!a || a.closest('.peek') || a.dataset.nopeek != null) return null;
    return a;
  }

  function over(e) {
    if (!fine) return;
    const a = anchorOf(e);
    if (!a) return;
    clearTimeout(hideT);
    clearTimeout(showT);
    const path = a.dataset.path;
    if (peek?.path === path) return;
    showT = setTimeout(async () => {
      const r = a.getBoundingClientRect();
      const above = r.bottom + 300 > innerHeight;
      peek = { path, x: Math.max(8, Math.min(r.left, innerWidth - 400)), y: above ? r.top - 8 : r.bottom + 8, above };
      content = undefined;
      const c = await load(path);
      if (peek?.path === path) content = c;
    }, 420);
  }
  function out(e) {
    const a = anchorOf(e);
    if (!a) return;
    clearTimeout(showT);
    hideT = setTimeout(() => (peek = null), 220);
  }
  function ctx(e) {
    const a = anchorOf(e);
    if (!a) return;
    peek = null;
    const sel = String(getSelection?.() || '').trim();
    openMenu(e, fileMenuItems(a.dataset.path, { selection: sel || null }), a.dataset.path);
  }

  const entry = $derived(peek ? fileIndex().byPath.get(peek.path) : null);
  const html = $derived.by(() => {
    if (!content) return '';
    const lines = content.split('\n').slice(0, 26).join('\n');
    const idx = fileIndex();
    return renderMarkdown(lines, { path: peek?.path, exists: (p) => idx.set.has(p), linkPaths: false });
  });
</script>

<svelte:document onpointerover={over} onpointerout={out} oncontextmenu={ctx} onpointerdown={() => (peek = null)} />

{#if peek}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="peek card"
    class:above={peek.above}
    style="left:{peek.x}px;top:{peek.y}px"
    transition:fade={{ duration: dur(120) }}
    onpointerenter={() => clearTimeout(hideT)}
    onpointerleave={() => (hideT = setTimeout(() => (peek = null), 200))}
  >
    <div class="ph">
      {#if entry}<ToolBadge tool={entry.tool} compact />{/if}
      <span class="mono ellipsis grow pp">{peek.path}</span>
      <button class="btn sm ghost" onclick={() => { openFile(peek.path); peek = null; }}>Open <Icon name="arrowRight" size={12} /></button>
    </div>
    {#if entry}
      <div class="pm faint">{fmtNum(entry.tokens)} tokens · {fmtNum(entry.lines)} lines · {timeAgo(toMs(entry.mtime), app.now)}</div>
    {/if}
    <div class="pb">
      {#if content === undefined}
        <div class="skel" style="height:12px;width:70%"></div>
        <div class="skel" style="height:12px;width:90%;margin-top:8px"></div>
        <div class="skel" style="height:12px;width:60%;margin-top:8px"></div>
      {:else if content === null}
        <span class="faint">Could not load preview.</span>
      {:else if !content.trim()}
        <span class="faint">Empty file</span>
      {:else}
        <article class="md mini">{@html html}</article>
      {/if}
    </div>
  </div>
{/if}

<style>
  .peek {
    position: fixed;
    z-index: 110;
    width: 390px;
    max-width: calc(100vw - 16px);
    background: var(--panel-solid);
    box-shadow: var(--shadow-lg);
    border-radius: 14px;
    overflow: hidden;
  }
  .peek.above { transform: translateY(-100%); }
  .ph { display: flex; align-items: center; gap: 8px; padding: 10px 10px 4px 14px; }
  .pp { font-size: 12px; font-weight: 600; }
  .pm { font-size: 11px; padding: 0 14px 8px; border-bottom: 1px solid var(--border); }
  .pb { padding: 12px 14px; max-height: 240px; overflow: hidden; mask-image: linear-gradient(180deg, #000 70%, transparent); }
  .mini { font-size: 12.5px; line-height: 1.55; }
  .mini :global(h1) { font-size: 1.3em; margin-top: 0; }
  .mini :global(h2) { font-size: 1.1em; }
</style>
