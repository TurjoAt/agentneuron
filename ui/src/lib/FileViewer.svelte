<script>
  // Full file viewer: header + Preview / Edit / Raw (annotations gutter) /
  // History / Git log / Links (outgoing + backlinks). Used by Files and the drawer.
  import { api } from './api.js';
  import { app, isPulsing, openFile, navigate, toggleBookmark, isBookmarked } from './store.svelte.js';
  import { resource } from './resource.svelte.js';
  import { timeAgo, fmtBytes, fmtNum, fmtDate, toMs } from './format.js';
  import { KINDS, LINK_TYPES } from './tools.js';
  import { openMenu } from './menu.svelte.js';
  import { fileMenuItems, copyPath } from './fileActions.js';
  import { loadAnnotations } from './annotations.js';
  import { canRun, levelReason } from './actions.svelte.js';
  import { fileHref } from './links.js';
  import { tick } from 'svelte';
  import Markdown from './Markdown.svelte';
  import HistoryPanel from './HistoryPanel.svelte';
  import ToolBadge from './ToolBadge.svelte';
  import GitStatus from './GitStatus.svelte';
  import Tabs from './Tabs.svelte';
  import Icon from './Icon.svelte';
  import Empty from './Empty.svelte';
  import EditorPane from './editor/EditorPane.svelte';
  import AnnotationCard from './AnnotationCard.svelte';

  let { path, line = null, anchor = null, tab = $bindable('preview'), compact = false } = $props();

  const file = resource((p) => api('/api/file', { path: p }), { key: () => path, live: false });
  const backlinks = resource((p) => api('/api/backlinks', { path: p }).catch(() => null), { key: () => path, live: false, enabled: () => tab === 'links' });

  // live: reload when *this* file changes (not while editing — the editor handles it)
  let lastPulse = 0;
  $effect(() => {
    const t = app.pulses[path];
    if (t && t !== lastPulse) {
      lastPulse = t;
      if (tab !== 'edit') file.reload();
    }
  });

  let annots = $state([]);
  $effect(() => {
    void app.annotTick;
    const p = path;
    loadAnnotations(p).then((l) => p === path && (annots = l));
  });
  const openAnnots = $derived(annots.filter((a) => !a.resolved));
  const byLine = $derived.by(() => {
    const m = new Map();
    for (const a of annots) {
      if (!m.has(a.line)) m.set(a.line, []);
      m.get(a.line).push(a);
    }
    return m;
  });
  let composeLine = $state(null);

  const d = $derived(file.data);
  const entry = $derived(d?.entry);
  const isMd = $derived(!entry || /\.(md|mdc|markdown|mdx)$/i.test(entry.path) || !entry.ext);
  const linksOut = $derived(d?.links?.out || []);
  const linksIn = $derived(Array.isArray(backlinks.data) ? backlinks.data : d?.links?.in || []);
  const gitLog = $derived(d?.git?.log || []);
  const history = $derived(d?.history || []);
  const gitStatus = $derived(d?.git?.status || entry?.gitStatus || null);
  const deleted = $derived(file.error?.status === 404);

  const tabs = $derived([
    { id: 'preview', label: isMd ? 'Preview' : 'View' },
    { id: 'edit', label: 'Edit' },
    { id: 'raw', label: 'Lines', count: openAnnots.length || null },
    { id: 'history', label: 'History', count: history.length },
    { id: 'git', label: 'Git', count: gitLog.length },
    { id: 'links', label: 'Links', count: linksOut.length + (d?.links?.in?.length || 0) },
  ]);

  const crumbs = $derived(path.split('/'));
  const rawLines = $derived((d?.content ?? '').split('\n'));

  let rawEl = $state();
  $effect(() => {
    const l = Number(line);
    if (tab !== 'raw' || !l || !rawEl || !d) return;
    tick().then(() => {
      const row = rawEl?.querySelector(`[data-l="${l}"]`);
      row?.scrollIntoView({ block: 'center' });
    });
  });

  function setTab(t) {
    tab = t;
    if (!compact) navigate('files', { path, tab: t === 'preview' ? undefined : t });
  }
</script>

<div class="fv" class:compact class:editing={tab === 'edit'}>
  <header class="fv-h">
    <div class="titlerow">
      <div class="crumbs mono">
        {#each crumbs as c, k (k)}
          {#if k}<span class="sep">/</span>{/if}
          <span class:last={k === crumbs.length - 1}>{c || '/'}</span>
        {/each}
        {#if isPulsing(path)}<span class="live-tag">changed</span>{/if}
      </div>
      <span class="spacer"></span>
      <div class="acts">
        {#if compact}
          <button class="btn sm" onclick={() => openFile(path, { line })}><Icon name="maximize" size={13} /> Open</button>
        {/if}
        <button class="btn sm ghost icon" class:pinned={isBookmarked(path)} title={isBookmarked(path) ? 'Unpin' : 'Pin to sidebar'} onclick={() => toggleBookmark(path)}><Icon name="pin" size={14} /></button>
        <button class="btn sm ghost icon" title="Copy path" onclick={() => copyPath(path)}><Icon name="copy" size={14} /></button>
        {#if !compact}
          <button class="btn sm ghost icon" title="Reveal in graph" onclick={() => navigate('graph', { focus: path })}><Icon name="graph" size={14} /></button>
        {/if}
        <button class="btn sm ghost icon" title="More actions" onclick={(e) => openMenu(e.currentTarget, fileMenuItems(path), path)}><Icon name="more" size={15} /></button>
      </div>
    </div>
    {#if entry}
      <div class="meta">
        <ToolBadge tool={entry.tool} />
        <span class="badge">{KINDS[entry.kind] || entry.kind}</span>
        <GitStatus status={gitStatus} />
        <span class="m tnum"><b>{fmtNum(entry.tokens)}</b> tokens</span>
        <span class="m tnum">{fmtNum(entry.lines)} lines</span>
        <span class="m tnum">{fmtBytes(entry.size)}</span>
        <span class="m" title={fmtDate(toMs(entry.mtime))}>{timeAgo(toMs(entry.mtime), app.now)}</span>
        {#if openAnnots.length}<button class="m notes" onclick={() => setTab('raw')}><Icon name="message" size={12} /> {openAnnots.length} note{openAnnots.length === 1 ? '' : 's'}</button>{/if}
      </div>
    {/if}
    <div class="tabsrow">
      <Tabs {tabs} active={tab} onchange={setTab} />
      {#if tab !== 'edit' && !compact}
        <button class="btn sm" onclick={() => setTab('edit')} title={canRun('edit') ? 'Edit this file' : levelReason('edit')}>
          <Icon name={canRun('edit') ? 'edit' : 'lock'} size={13} /> {canRun('edit') ? 'Edit' : 'View source'}
        </button>
      {/if}
    </div>
  </header>

  <div class="fv-b" class:flush={tab === 'edit' || tab === 'raw'}>
    {#if deleted}
      <Empty icon="file" title="File not found">It may have been deleted or renamed. Check <a href="#/settings?tab=trash">Settings → Trash</a>.</Empty>
    {:else if file.error}
      <Empty icon="alert" title="Could not load file">{file.error.message}</Empty>
    {:else if tab === 'edit'}
      {#key path}<EditorPane {path} {line} />{/key}
    {:else if !d}
      <div class="col" style="gap:12px">
        <div class="skel" style="height:28px;width:55%"></div>
        <div class="skel" style="height:14px;width:90%"></div>
        <div class="skel" style="height:14px;width:80%"></div>
        <div class="skel" style="height:14px;width:86%"></div>
        <div class="skel" style="height:120px"></div>
      </div>
    {:else if tab === 'preview'}
      {#if !d.content?.trim()}
        <Empty icon="file" title="Empty file">
          {#if canRun('edit')}<button class="btn sm" onclick={() => setTab('edit')}><Icon name="edit" size={13} /> Start writing</button>{/if}
        </Empty>
      {:else if isMd}
        <div class="prose"><Markdown source={d.content} {path} {line} {anchor} /></div>
      {:else}
        <pre class="plain mono">{d.content}</pre>
      {/if}
    {:else if tab === 'raw'}
      <div class="raw mono" bind:this={rawEl}>
        {#each rawLines as l, k (k)}
          {@const n = k + 1}
          {@const notes = byLine.get(n)}
          <div class="rl" class:hl={+line === n} class:noted={!!notes} data-l={n}>
            <button class="gut" title={canRun('state') ? `Add a note on line ${n}` : 'Notes need the admin role'} onclick={() => (composeLine = composeLine === n ? null : n)}>
              {#if notes}<span class="ndot" class:res={notes.every((a) => a.resolved)}></span>{:else}<span class="plus">+</span>{/if}
            </button>
            <a class="no" href={fileHref(path, n)} onclick={(e) => { e.preventDefault(); navigate('files', { path, line: n, tab: 'raw' }); }}>{n}</a>
            <span class="tx">{l || ' '}</span>
          </div>
          {#if notes}
            {#each notes as a (a.id)}<AnnotationCard {a} />{/each}
          {/if}
          {#if composeLine === n}
            <AnnotationCard compose={{ path, line: n }} onclose={() => (composeLine = null)} />
          {/if}
        {/each}
      </div>
    {:else if tab === 'history'}
      <HistoryPanel {path} {history} />
    {:else if tab === 'git'}
      {#if !gitLog.length}
        <Empty icon="git" title="No commits">This file has no git history (untracked, ignored, or git unavailable).</Empty>
      {:else}
        <div class="row" style="margin-bottom:10px;flex-wrap:wrap">
          <a class="btn sm" href="#/diff?path={encodeURIComponent(path)}&from=git:HEAD&to=current"><Icon name="diff" size={13} /> Working copy vs HEAD</a>
          <a class="btn sm" href="#/git?tab=blame&path={encodeURIComponent(path)}"><Icon name="user" size={13} /> Blame</a>
          <a class="btn sm" href="#/git?tab=history&path={encodeURIComponent(path)}"><Icon name="history" size={13} /> Full history</a>
        </div>
        <ol class="commits">
          {#each gitLog as c (c.hash)}
            <li>
              <span class="dot"></span>
              <a class="grow cl" href="#/git?tab=history&commit={c.hash}">
                <div class="subj">{c.subject}</div>
                <div class="faint small"><span class="mono">{c.short || c.hash?.slice(0, 7)}</span> · {c.author} · {timeAgo(toMs(c.date), app.now)}</div>
              </a>
            </li>
          {/each}
        </ol>
      {/if}
    {:else if tab === 'links'}
      <div class="links">
        {#each [['Outgoing', linksOut, 'to'], ['Backlinks — who links here', linksIn, 'from']] as [title, list, key] (title)}
          <section>
            <div class="eyebrow">{title} · {list.length}</div>
            {#each list as l, k (k)}
              <a
                class="list-row link"
                class:broken={l.broken}
                href={l.broken ? undefined : fileHref(l[key], key === 'from' ? l.line : undefined)}
                data-path={l.broken ? undefined : l[key]}
                onclick={(e) => { if (l.broken) e.preventDefault(); else if (compact) { e.preventDefault(); openFile(l[key], { drawer: true }); } }}
              >
                <Icon name={l.broken ? 'alert' : key === 'from' ? 'arrowLeft' : 'arrowRight'} size={13} />
                <span class="grow ellipsis mono">{l[key]}</span>
                <span class="badge">{LINK_TYPES[l.type]?.label || l.type}</span>
                {#if l.line}<span class="faint small tnum">L{l.line}</span>{/if}
              </a>
            {:else}
              <div class="faint small pad">None</div>
            {/each}
          </section>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .fv { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%; }
  .fv-h { display: flex; flex-direction: column; gap: 10px; padding: 14px 20px 12px; border-bottom: 1px solid var(--border); }
  .titlerow { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .crumbs { display: flex; align-items: center; flex-wrap: wrap; gap: 2px; font-size: 13px; color: var(--text-3); min-width: 0; }
  .crumbs .last { color: var(--text); font-weight: 650; font-size: 14.5px; }
  .sep { margin: 0 3px; opacity: 0.6; }
  .acts { display: flex; gap: 2px; flex-shrink: 0; }
  .acts .pinned { color: var(--accent); }
  .live-tag { margin-left: 6px; font: 600 10px var(--font); text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); background: var(--accent-soft); padding: 3px 7px; border-radius: 99px; animation: slide-in 0.4s var(--ease); }
  .meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .m { font-size: 12px; color: var(--text-3); }
  .m b { color: var(--text-2); font-weight: 600; }
  .notes { display: inline-flex; align-items: center; gap: 5px; border: 0; background: var(--accent-soft); color: var(--accent); padding: 2px 8px; border-radius: 99px; cursor: pointer; font-weight: 600; font-size: 11.5px; }
  .tabsrow { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .fv-b { padding: 20px; min-width: 0; flex: 1; min-height: 0; overflow: auto; }
  .fv-b.flush { padding: 0; }
  .editing .fv-b { overflow: hidden; }
  .prose { max-width: 860px; }
  .compact .fv-b { padding: 16px 18px 40px; }
  .compact .fv-b.flush { padding: 0; }
  .compact .fv-h { padding-right: 56px; }
  .raw { font-size: 12.5px; line-height: 1.65; padding: 10px 0 40px; min-width: 0; }
  .rl { display: grid; grid-template-columns: 22px 44px minmax(0, 1fr); min-width: max-content; }
  .rl:hover { background: var(--panel-hover); }
  .rl.hl { background: var(--warn-soft); box-shadow: inset 3px 0 0 var(--warn); }
  .rl.noted { background: color-mix(in srgb, var(--accent) 5%, transparent); }
  .gut { border: 0; background: transparent; cursor: pointer; display: grid; place-items: center; padding: 0; }
  .plus { opacity: 0; color: var(--accent); font: 700 13px var(--font); }
  .rl:hover .plus { opacity: 1; }
  .ndot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .ndot.res { background: var(--text-3); box-shadow: none; }
  .no { color: var(--text-3); text-align: right; padding-right: 14px; user-select: none; font-size: 11px; text-decoration: none; }
  .no:hover { color: var(--accent); text-decoration: none; }
  .tx { white-space: pre; padding-right: 20px; }
  .plain { white-space: pre-wrap; font-size: 12.5px; margin: 0; }
  .commits { list-style: none; margin: 0; padding: 0 0 0 6px; border-left: 1px solid var(--border-strong); }
  .commits li { display: flex; gap: 12px; padding: 8px 0 8px 14px; position: relative; }
  .commits .dot { position: absolute; left: -5px; top: 14px; width: 9px; height: 9px; border-radius: 50%; background: var(--bg); border: 2px solid var(--accent); }
  .cl { color: var(--text); text-decoration: none; }
  .cl:hover { text-decoration: none; }
  .cl:hover .subj { color: var(--accent); }
  .subj { font-weight: 550; }
  .small { font-size: 12px; }
  .links { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .links section { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .links .eyebrow { margin-bottom: 6px; }
  .link { font-size: 12.5px; color: var(--text-2); text-decoration: none; }
  .link:hover { color: var(--text); text-decoration: none; }
  .link.broken { color: var(--err); cursor: not-allowed; }
  .pad { padding: 6px 10px; }
  @media (max-width: 860px) {
    .links { grid-template-columns: 1fr; }
    .fv-b { padding: 14px; }
    .fv-h { padding: 12px 14px; }
  }
</style>
