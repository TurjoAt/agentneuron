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
  import { actionsState, runAction, actionEnabled, jobs } from './actions.svelte.js';
  import { LEVELS, CATEGORY_ICON } from './levels.js';
  import { newFile, findReplace, createTask, renameFile, deleteFile, copyPath } from './fileActions.js';
  import { isBookmarked, toggleBookmark, logout } from './store.svelte.js';
  import { openEntity, entityLabel } from './entity.svelte.js';
  import { timeAgo } from './format.js';

  // entity index for search (sessions, tools, models), fetched lazily when the palette opens
  let ents = $state.raw({ sessions: [], tools: [], models: [], at: 0 });
  function loadEntities() {
    if (Date.now() - ents.at < 120_000) return;
    ents = { ...ents, at: Date.now() };
    Promise.allSettled([api('/api/usage/sessions', { range: '90d' }), api('/api/usage/tools', { range: '90d' })]).then(async ([s, t]) => {
      let sessions = s.status === 'fulfilled' && Array.isArray(s.value?.sessions) ? s.value.sessions : [];
      // older servers / scaffolds: fall back to the live session list
      if (!sessions.length) sessions = await api('/api/sessions').then((l) => (Array.isArray(l) ? l.filter((x) => x?.sessionId) : []), () => []);
      const tools = t.status === 'fulfilled' && Array.isArray(t.value?.tools) ? t.value.tools : [];
      const models = [...new Set(sessions.flatMap((x) => x.models || []))];
      ents = { sessions, tools, models, at: Date.now() };
    });
  }

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
      untrack(loadEntities);
      tick().then(() => inputEl?.focus());
    }
  });

  $effect(() => {
    const query = q.trim();
    clearTimeout(timer);
    if (query.length < 2 || query.startsWith('>')) {
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
    const raw = q.trim();
    const cmdMode = raw.startsWith('>');
    const query = cmdMode ? raw.slice(1).trim() : raw;
    const out = [];
    const cur = app.route.view === 'files' ? app.route.params.path : null;
    const cmds = [
      ...VIEWS.map((v, i) => ({ kind: 'view', label: `Go to ${v.label}`, desc: v.desc, icon: v.icon, key: i < 9 ? String(i + 1) : v.id === 'settings' ? '0' : '', run: () => navigate(v.id) })),
      { kind: 'cmd', label: 'Product map: how pages and data connect', icon: 'map', key: 'm', run: () => (app.modal = { kind: 'map', props: {} }) },
      { kind: 'cmd', label: 'New file…', icon: 'filePlus', key: 'n', run: () => newFile() },
      { kind: 'cmd', label: 'Find & replace in files…', icon: 'replace', run: () => findReplace(query) },
      { kind: 'cmd', label: 'New task…', icon: 'tasks', run: () => createTask({}) },
      { kind: 'cmd', label: jobs.dock ? 'Hide jobs dock' : 'Show jobs dock', icon: 'terminal', run: () => { jobs.dockVisible = true; jobs.dock = !jobs.dock; } },
      ...(cur
        ? [
            { kind: 'cmd', label: `Edit ${cur}`, icon: 'edit', run: () => openFile(cur, { tab: 'edit' }) },
            { kind: 'cmd', label: `${isBookmarked(cur) ? 'Unpin' : 'Pin'} ${cur}`, icon: 'pin', run: () => toggleBookmark(cur) },
            { kind: 'cmd', label: `Rename / move ${cur}…`, icon: 'replace', run: () => renameFile(cur) },
            { kind: 'cmd', label: `Copy path ${cur}`, icon: 'copy', run: () => copyPath(cur) },
            { kind: 'cmd', label: `Move ${cur} to trash`, icon: 'trash', run: () => deleteFile(cur) },
          ]
        : []),
      { kind: 'cmd', label: `Switch to ${app.theme === 'dark' ? 'light' : 'dark'} theme`, icon: app.theme === 'dark' ? 'sun' : 'moon', run: toggleTheme },
      { kind: 'cmd', label: 'Keyboard shortcuts', icon: 'command', key: '?', run: () => (app.modal = { kind: 'shortcuts', props: {} }) },
      { kind: 'cmd', label: 'Reconnect live stream', icon: 'refresh', run: reconnect },
      ...(app.me?.tokenRequired ? [{ kind: 'cmd', label: 'Sign out', icon: 'logout', run: logout }] : []),
    ];
    for (const c of cmds) {
      const m = fuzzy(query, c.label) || (c.desc && query.length > 2 && c.desc.toLowerCase().includes(query.toLowerCase()) ? { score: -20, idx: [] } : null);
      if (m) out.push({ ...c, section: 'Commands', score: m.score + (query ? 0 : 1000), html: highlight(c.label, m.idx) });
    }
    const acts = [];
    for (const a of actionsState.list) {
      const label = `${a.title}`;
      const m = fuzzy(query, `${a.title} ${a.id} ${a.category}`);
      if (!m) continue;
      const st = actionEnabled(a.id);
      const mt = fuzzy(query, label);
      acts.push({
        kind: 'action', section: 'Actions', label, id: a.id, level: a.level, enabled: st.enabled, reason: st.reason,
        icon: CATEGORY_ICON[a.category] || 'zap', score: m.score - (st.enabled ? 0 : 30), html: mt ? highlight(label, mt.idx) : escapeHtml(label),
        run: () => runAction(a.id, {}),
      });
    }
    acts.sort((a, b) => b.score - a.score);
    if (!query) {
      out.sort((a, b) => b.score - a.score);
      return cmdMode ? [...out, ...acts] : [...out.slice(0, 16), ...acts.slice(0, 6)];
    }
    out.sort((a, b) => b.score - a.score);
    if (cmdMode) return [...out.slice(0, 10), ...acts.slice(0, 30)];
    const files = [];
    for (const f of app.files) {
      const m = fuzzy(query, f.path);
      if (m) files.push({ kind: 'file', section: 'Files', path: f.path, tool: f.tool, score: m.score, html: highlight(f.path, m.idx), run: () => openFile(f.path) });
    }
    files.sort((a, b) => b.score - a.score);
    const sess = [];
    for (const x of ents.sessions) {
      const label = x.title || entityLabel('session', x.sessionId);
      const m = fuzzy(query, `${label} ${x.sessionId}`);
      const mt = fuzzy(query, label);
      if (m) sess.push({ kind: 'entity', ek: 'session', section: 'Sessions', icon: 'message', tool: x.tool, label, sub: x.lastAt ? timeAgo(x.lastAt, app.now) : '', score: m.score, html: mt ? highlight(label, mt.idx) : escapeHtml(label), run: () => openEntity('session', x.sessionId, label) });
    }
    sess.sort((a, b) => b.score - a.score);
    const tl = [];
    for (const t of ents.tools) {
      const m = fuzzy(query, t.name);
      if (m) tl.push({ kind: 'entity', ek: 'tool', section: 'Tools & models', icon: 'terminal', label: t.name, sub: t.calls != null ? `${t.calls} calls` : '', score: m.score, html: highlight(t.name, m.idx), run: () => openEntity('tool', t.name, t.name) });
    }
    for (const id of ents.models) {
      const m = fuzzy(query, id);
      if (m) tl.push({ kind: 'entity', ek: 'model', section: 'Tools & models', icon: 'sparkles', label: id, sub: 'model', score: m.score, html: highlight(id, m.idx), run: () => openEntity('model', id, id) });
    }
    tl.sort((a, b) => b.score - a.score);
    const res = [...files.slice(0, 8), ...sess.slice(0, 5), ...tl.slice(0, 4), ...out.slice(0, 4), ...acts.slice(0, 5)];
    const needle = query.toLowerCase();
    for (const r of remote.q === query ? remote.items : []) {
      const t = r.text || '';
      const i = t.toLowerCase().indexOf(needle);
      const html = i < 0 ? escapeHtml(t) : escapeHtml(t.slice(0, i)) + '<mark>' + escapeHtml(t.slice(i, i + query.length)) + '</mark>' + escapeHtml(t.slice(i + query.length));
      res.push({ kind: 'hit', section: 'In content', path: r.path, line: r.line, html, run: () => openFile(r.path, { line: r.line }) });
    }
    return res;
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
        placeholder="Search pages, files, sessions, tools… or type > for actions"
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
          {:else if it.kind === 'action'}
            <Icon name={it.icon} size={15} />
            <span class="lbl" class:dim={!it.enabled}>{@html it.html} <span class="aid mono">{it.id}</span></span>
            {#if !it.enabled}<span class="lock" title={it.reason}><Icon name="lock" size={12} /></span>{/if}
            <span class="lvl {LEVELS[it.level]?.tone}">{LEVELS[it.level]?.label || it.level}</span>
          {:else if it.kind === 'entity'}
            {#if it.tool}<ToolBadge tool={it.tool} compact />{:else}<Icon name={it.icon} size={15} />{/if}
            <span class="lbl" class:mono={it.ek === 'tool' || it.ek === 'model'}>{@html it.html}</span>
            {#if it.sub}<span class="sub">{it.sub}</span>{/if}
            <span class="ek">details</span>
          {:else}
            <Icon name={it.icon} size={15} />
            <span class="lbl">{@html it.html}{#if it.desc}<span class="desc">{it.desc}</span>{/if}</span>
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
      <span><span class="kbd">&gt;</span> actions</span>
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
  .dim { opacity: 0.55; }
  .desc { margin-left: 10px; font-size: 12px; color: var(--text-3); }
  .sub { font-size: 11.5px; color: var(--text-3); flex-shrink: 0; }
  .ek { font-size: 10px; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; padding: 2px 6px; border-radius: 5px; background: var(--panel-active); color: var(--text-3); flex-shrink: 0; }
  .it.on .ek { background: var(--accent-soft); color: var(--accent); }
  @media (max-width: 560px) { .desc { display: none; } }
  .aid { font-size: 11px; color: var(--text-3); margin-left: 6px; }
  .lock { color: var(--text-3); display: grid; }
  .lvl { font-size: 10px; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; padding: 2px 6px; border-radius: 5px; background: var(--panel-active); color: var(--text-3); }
  .lvl.accent { background: var(--accent-soft); color: var(--accent); }
  .lvl.warn { background: var(--warn-soft); color: var(--warn); }
  .lvl.err { background: var(--err-soft); color: var(--err); }
  .lvl.info { background: var(--info-soft); color: var(--info); }
  .none { padding: 30px; text-align: center; color: var(--text-3); }
  .foot { display: flex; align-items: center; gap: 14px; padding: 9px 14px; border-top: 1px solid var(--border); font-size: 11.5px; color: var(--text-3); }
  .foot span { display: inline-flex; gap: 4px; align-items: center; }
  .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--border-strong); border-top-color: var(--accent); animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
