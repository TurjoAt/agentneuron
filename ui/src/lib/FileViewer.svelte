<script>
  // Full file viewer: header + Preview / Raw / History / Git log / Links.
  // Used by the Files view and the slide-over drawer.
  import { api } from './api.js';
  import { app, isPulsing, openFile, navigate } from './store.svelte.js';
  import { resource } from './resource.svelte.js';
  import { timeAgo, fmtBytes, fmtNum, fmtDate, toMs } from './format.js';
  import { KINDS, LINK_TYPES } from './tools.js';
  import { tick } from 'svelte';
  import Markdown from './Markdown.svelte';
  import HistoryPanel from './HistoryPanel.svelte';
  import ToolBadge from './ToolBadge.svelte';
  import GitStatus from './GitStatus.svelte';
  import Tabs from './Tabs.svelte';
  import Icon from './Icon.svelte';
  import Empty from './Empty.svelte';

  let { path, line = null, anchor = null, tab = $bindable('preview'), compact = false } = $props();

  const file = resource((p) => api('/api/file', { path: p }), { key: () => path, live: false });

  // live: reload when *this* file changes
  let lastPulse = 0;
  $effect(() => {
    const t = app.pulses[path];
    if (t && t !== lastPulse) {
      lastPulse = t;
      file.reload();
    }
  });

  const d = $derived(file.data);
  const entry = $derived(d?.entry);
  const isMd = $derived(!entry || /\.(md|mdc|markdown)$/i.test(entry.path) || !entry.ext);
  const linksOut = $derived(d?.links?.out || []);
  const linksIn = $derived(d?.links?.in || []);
  const gitLog = $derived(d?.git?.log || []);
  const history = $derived(d?.history || []);
  const gitStatus = $derived(d?.git?.status || entry?.gitStatus || null);
  const deleted = $derived(file.error?.status === 404);

  const tabs = $derived([
    { id: 'preview', label: isMd ? 'Preview' : 'View' },
    { id: 'raw', label: 'Raw' },
    { id: 'history', label: 'History', count: history.length },
    { id: 'git', label: 'Git log', count: gitLog.length },
    { id: 'links', label: 'Links', count: linksOut.length + linksIn.length },
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

  function copyPath() {
    navigator.clipboard?.writeText(path).catch(() => {});
  }
</script>

<div class="fv" class:compact>
  <header class="fv-h">
    <div class="crumbs mono">
      {#each crumbs as c, k (k)}
        {#if k}<span class="sep">/</span>{/if}
        <span class:last={k === crumbs.length - 1}>{c || '/'}</span>
      {/each}
      <button class="btn sm ghost icon" title="Copy path" onclick={copyPath}><Icon name="copy" size={13} /></button>
      {#if isPulsing(path)}<span class="live-tag">changed</span>{/if}
    </div>
    {#if entry}
      <div class="meta">
        <ToolBadge tool={entry.tool} />
        <span class="badge">{KINDS[entry.kind] || entry.kind}</span>
        <GitStatus status={gitStatus} />
        <span class="m tnum"><b>{fmtNum(entry.tokens)}</b> tokens</span>
        <span class="m tnum">{fmtNum(entry.lines)} lines</span>
        <span class="m tnum">{fmtBytes(entry.size)}</span>
        <span class="m" title={fmtDate(entry.mtime)}>{timeAgo(toMs(entry.mtime), app.now)}</span>
        {#if compact}
          <span class="spacer"></span>
          <button class="btn sm" onclick={() => openFile(path, { line })}><Icon name="maximize" size={13} /> Open</button>
        {/if}
      </div>
    {/if}
    <div class="tabsrow">
      <Tabs {tabs} bind:active={tab} />
      {#if !compact && entry}
        <button class="btn sm ghost" onclick={() => navigate('graph', { focus: path })}><Icon name="graph" size={13} /> In graph</button>
      {/if}
    </div>
  </header>

  <div class="fv-b">
    {#if deleted}
      <Empty icon="file" title="File not found">It may have been deleted or renamed.</Empty>
    {:else if file.error}
      <Empty icon="alert" title="Could not load file">{file.error.message}</Empty>
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
        <Empty icon="file" title="Empty file" />
      {:else if isMd}
        <Markdown source={d.content} {path} {line} {anchor} />
      {:else}
        <pre class="plain mono">{d.content}</pre>
      {/if}
    {:else if tab === 'raw'}
      <div class="raw mono" bind:this={rawEl}>
        {#each rawLines as l, k (k)}
          <div class="rl" class:hl={+line === k + 1} data-l={k + 1}><span class="no">{k + 1}</span><span class="tx">{l || ' '}</span></div>
        {/each}
      </div>
    {:else if tab === 'history'}
      <HistoryPanel {path} {history} />
    {:else if tab === 'git'}
      {#if !gitLog.length}
        <Empty icon="git" title="No commits">This file has no git history (untracked, ignored, or git unavailable).</Empty>
      {:else}
        <div class="row" style="margin-bottom:10px">
          <a class="btn sm" href="#/diff?path={encodeURIComponent(path)}&from=git:HEAD&to=current"><Icon name="diff" size={13} /> Diff working copy vs HEAD</a>
        </div>
        <ol class="commits">
          {#each gitLog as c (c.hash)}
            <li>
              <span class="dot"></span>
              <div class="grow">
                <div class="subj">{c.subject}</div>
                <div class="faint small"><span class="mono">{c.short || c.hash?.slice(0, 7)}</span> · {c.author} · {timeAgo(toMs(c.date), app.now)}</div>
              </div>
            </li>
          {/each}
        </ol>
      {/if}
    {:else if tab === 'links'}
      <div class="links">
        {#each [['Outgoing', linksOut, 'to'], ['Incoming', linksIn, 'from']] as [title, list, key] (title)}
          <section>
            <div class="eyebrow">{title} · {list.length}</div>
            {#each list as l, k (k)}
              <button
                class="list-row link"
                class:broken={l.broken}
                disabled={l.broken}
                onclick={() => openFile(l[key], { drawer: compact, line: key === 'from' ? l.line : undefined })}
              >
                <Icon name={l.broken ? 'alert' : 'link'} size={14} />
                <span class="grow ellipsis mono">{l[key]}</span>
                <span class="badge">{LINK_TYPES[l.type]?.label || l.type}</span>
                {#if l.line}<span class="faint small tnum">L{l.line}</span>{/if}
              </button>
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
  .fv { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .fv-h {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 20px 12px;
    border-bottom: 1px solid var(--border);
  }
  .crumbs { display: flex; align-items: center; flex-wrap: wrap; gap: 2px; font-size: 13px; color: var(--text-3); }
  .crumbs .last { color: var(--text); font-weight: 600; font-size: 14px; }
  .sep { margin: 0 3px; opacity: 0.6; }
  .live-tag {
    margin-left: 6px;
    font: 600 10px var(--font);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
    background: var(--accent-soft);
    padding: 3px 7px;
    border-radius: 99px;
    animation: slide-in 0.4s var(--ease);
  }
  .meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .m { font-size: 12px; color: var(--text-3); }
  .m b { color: var(--text-2); font-weight: 600; }
  .tabsrow { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .fv-b { padding: 20px; min-width: 0; }
  .compact .fv-b { padding: 16px 18px 40px; }
  .compact .fv-h { padding-right: 56px; }
  .raw {
    font-size: 12.5px;
    line-height: 1.65;
    background: var(--inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: auto;
    padding: 8px 0;
  }
  .rl { display: grid; grid-template-columns: 52px minmax(0, 1fr); min-width: max-content; }
  .rl:hover { background: var(--panel-hover); }
  .rl.hl { background: var(--warn-soft); box-shadow: inset 3px 0 0 var(--warn); }
  .no { color: var(--text-3); text-align: right; padding-right: 14px; user-select: none; font-size: 11px; }
  .tx { white-space: pre; padding-right: 20px; }
  .plain { white-space: pre-wrap; font-size: 12.5px; margin: 0; }
  .commits { list-style: none; margin: 0; padding: 0 0 0 6px; border-left: 1px solid var(--border-strong); }
  .commits li { display: flex; gap: 12px; padding: 8px 0 8px 14px; position: relative; }
  .commits .dot {
    position: absolute;
    left: -5px;
    top: 14px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--bg);
    border: 2px solid var(--accent);
  }
  .subj { font-weight: 550; }
  .small { font-size: 12px; }
  .links { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .links section { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .links .eyebrow { margin-bottom: 6px; }
  .link { font-size: 12.5px; color: var(--text-2); }
  .link:hover { color: var(--text); }
  .link.broken { color: var(--err); cursor: not-allowed; }
  .pad { padding: 6px 10px; }
  @media (max-width: 860px) {
    .links { grid-template-columns: 1fr; }
    .fv-b { padding: 14px; }
    .fv-h { padding: 14px; }
  }
</style>
