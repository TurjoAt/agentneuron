<script>
  // ⌘K / Ctrl+K command palette: views, actions, fuzzy file search, full-text search.
  import { fade, scale } from 'svelte/transition';
  import { tick, untrack } from 'svelte';
  import { app, navigate, openFile, toggleTheme, reconnect } from './store.svelte.js';
  import { api } from './api.js';
  import { VIEWS } from './nav.js';
  import { fuzzy, highlight, escapeHtml, basename, dirname } from './format.js';
  import { dur } from './motion.js';
  import Icon from './Icon.svelte';
  import ToolBadge from './ToolBadge.svelte';

  let q = $state('');
  let sel = $state(0);
  let inputEl = $state();
  let listEl = $state();
  let remote = $state({ q: '', items: [], loading: false });
  let timer;

  $effect(() => {
    if (app.palette) {
      q = '';
      sel = 0;
      tick().then(() => inputEl?.focus());
    }
  });

  $effect(() => {
    const query = q.trim();
    clearTimeout(timer);
    if (query.length < 2) {
      remote = { q: '', items: [], loading: false };
      return;
    }
    untrack(() => (remote.loading = true));
    timer = setTimeout(() => {
      api('/api/search', { q: query })
        .then((r) => q.trim() === query && (remote = { q: query, items: Array.isArray(r) ? r.slice(0, 40) : [], loading: false }))
        .catch(() => (remote = { q: query, items: [], loading: false }));
    }, 180);
  });

  const items = $derived.by(() => {
    const query = q.trim();
    const out = [];
    const cmds = [
      ...VIEWS.map((v, i) => ({ kind: 'view', label: `Go to ${v.label}`, icon: v.icon, key: String(i + 1), run: () => navigate(v.id) })),
      { kind: 'action', label: `Switch to ${app.theme === 'dark' ? 'light' : 'dark'} theme`, icon: app.theme === 'dark' ? 'sun' : 'moon', run: toggleTheme },
      { kind: 'action', label: 'Reconnect live stream', icon: 'refresh', run: reconnect },
    ];
    for (const c of cmds) {
      const m = fuzzy(query, c.label);
      if (m) out.push({ ...c, section: 'Commands', score: m.score + (query ? 0 : 1000), html: highlight(c.label, m.idx) });
    }
    if (query) {
      const files = [];
      for (const f of app.files) {
        const m = fuzzy(query, f.path);
        if (m) files.push({ kind: 'file', section: 'Files', path: f.path, tool: f.tool, score: m.score, html: highlight(f.path, m.idx), run: () => openFile(f.path) });
      }
      files.sort((a, b) => b.score - a.score);
      out.sort((a, b) => b.score - a.score);
      const cmdsTop = out.slice(0, 4);
      out.length = 0;
      out.push(...files.slice(0, 12), ...cmdsTop);
      const needle = query.toLowerCase();
      for (const r of remote.q === query ? remote.items : []) {
        const t = r.text || '';
        const i = t.toLowerCase().indexOf(needle);
        const html = i < 0 ? escapeHtml(t) : escapeHtml(t.slice(0, i)) + '<mark>' + escapeHtml(t.slice(i, i + query.length)) + '</mark>' + escapeHtml(t.slice(i + query.length));
        out.push({ kind: 'hit', section: 'In content', path: r.path, line: r.line, html, run: () => openFile(r.path, { line: r.line }) });
      }
    }
    return out;
  });

  $effect(() => {
    void items.length;
    if (sel >= items.length) sel = Math.max(0, items.length - 1);
  });

  function run(item) {
    if (!item) return;
    app.palette = false;
    item.run();
  }

  function onkeydown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(1, items.length); scrollSel(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % Math.max(1, items.length); scrollSel(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(items[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); app.palette = false; }
  }
  function scrollSel() {
    tick().then(() => listEl?.querySelector('.it.on')?.scrollIntoView({ block: 'nearest' }));
  }
</script>

{#if app.palette}
  <div class="pal-bg" transition:fade={{ duration: dur(140) }} onclick={() => (app.palette = false)} aria-hidden="true"></div>
  <div class="pal card" role="dialog" aria-modal="true" aria-label="Command palette" transition:scale={{ start: 0.96, duration: dur(180) }}>
    <div class="in">
      <Icon name="search" size={17} />
      <input
        bind:this={inputEl}
        bind:value={q}
        {onkeydown}
        placeholder="Search files, content, commands…"
        aria-label="Search"
        autocomplete="off"
        spellcheck="false"
      />
      {#if remote.loading}<span class="spin"></span>{/if}
      <span class="kbd">esc</span>
    </div>
    <div class="list" bind:this={listEl} role="listbox">
      {#each items as it, i (it.kind + (it.path || '') + (it.line || '') + it.html + i)}
        {#if i === 0 || items[i - 1].section !== it.section}
          <div class="sec">{it.section}</div>
        {/if}
        <button class="it" class:on={i === sel} role="option" aria-selected={i === sel} onmousemove={() => (sel = i)} onclick={() => run(it)}>
          {#if it.kind === 'file'}
            <ToolBadge tool={it.tool} compact />
            <span class="lbl mono">{@html it.html}</span>
          {:else if it.kind === 'hit'}
            <Icon name="file" size={14} />
            <span class="lbl col" style="gap:1px">
              <span class="hit-text">{@html it.html}</span>
              <span class="faint mono small">{it.path}:{it.line}</span>
            </span>
          {:else}
            <Icon name={it.icon} size={15} />
            <span class="lbl">{@html it.html}</span>
            {#if it.key}<span class="kbd">{it.key}</span>{/if}
          {/if}
        </button>
      {:else}
        <div class="none">{remote.loading ? 'Searching…' : 'No results'}</div>
      {/each}
    </div>
    <div class="foot">
      <span><span class="kbd">↑</span><span class="kbd">↓</span> navigate</span>
      <span><span class="kbd">↵</span> open</span>
      <span class="spacer"></span>
      <span class="faint">{app.files.length} files indexed</span>
    </div>
  </div>
{/if}

<style>
  .pal-bg { position: fixed; inset: 0; z-index: 80; background: rgba(5, 6, 10, 0.5); backdrop-filter: blur(4px); }
  .pal {
    position: fixed;
    z-index: 81;
    top: min(14vh, 120px);
    left: 50%;
    translate: -50% 0;
    width: min(640px, calc(100vw - 24px));
    max-height: min(70vh, 620px);
    display: flex;
    flex-direction: column;
    background: var(--panel-solid);
    box-shadow: var(--shadow-lg);
    border-radius: 16px;
    overflow: hidden;
  }
  .in { display: flex; align-items: center; gap: 10px; padding: 0 16px; border-bottom: 1px solid var(--border); color: var(--text-3); }
  .in input { flex: 1; height: 54px; border: 0; background: transparent; outline: none; font-size: 15.5px; min-width: 0; }
  .list { overflow: auto; padding: 6px; flex: 1; }
  .sec { padding: 10px 10px 4px; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-3); }
  .it {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px;
    border: 0;
    background: transparent;
    border-radius: 9px;
    text-align: left;
    cursor: pointer;
    color: var(--text-2);
    font-size: 13.5px;
  }
  .it.on { background: var(--accent-soft); color: var(--text); }
  .lbl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lbl.mono { font-size: 12.5px; }
  .hit-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .small { font-size: 11px; }
  .it :global(mark) { background: transparent; color: var(--accent); font-weight: 700; }
  .none { padding: 30px; text-align: center; color: var(--text-3); }
  .foot { display: flex; align-items: center; gap: 14px; padding: 9px 14px; border-top: 1px solid var(--border); font-size: 11.5px; color: var(--text-3); }
  .foot span { display: inline-flex; gap: 4px; align-items: center; }
  .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--border-strong); border-top-color: var(--accent); animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
