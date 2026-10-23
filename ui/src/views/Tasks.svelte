<script>
  import { untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import { app, openFile, navigate, fileIndex } from '../lib/store.svelte.js';
  import { resource } from '../lib/resource.svelte.js';
  import { fmtDay, toMs } from '../lib/format.js';
  import Tabs from '../lib/Tabs.svelte';
  import ToolBadge from '../lib/ToolBadge.svelte';
  import Counter from '../lib/Counter.svelte';
  import Icon from '../lib/Icon.svelte';
  import Empty from '../lib/Empty.svelte';

  let { params = {} } = $props();

  const tasks = resource(() => api('/api/tasks'));
  const decisions = resource(() => api('/api/decisions'));
  let tab = $state(untrack(() => params.tab) === 'decisions' ? 'decisions' : 'board');
  let q = $state('');

  const all = $derived(Array.isArray(tasks.data) ? tasks.data : []);
  const filtered = $derived(q ? all.filter((t) => `${t.text} ${t.path} ${t.section || ''}`.toLowerCase().includes(q.toLowerCase())) : all);
  const open = $derived(filtered.filter((t) => !t.done));
  const done = $derived(filtered.filter((t) => t.done));
  const pct = $derived(all.length ? Math.round((all.filter((t) => t.done).length / all.length) * 100) : 0);

  function byFile(list) {
    const m = new Map();
    for (const t of list) {
      if (!m.has(t.path)) m.set(t.path, []);
      m.get(t.path).push(t);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }
  const progress = $derived.by(() => {
    const m = new Map();
    for (const t of all) {
      const p = m.get(t.path) || { total: 0, done: 0 };
      p.total++;
      if (t.done) p.done++;
      m.set(t.path, p);
    }
    return m;
  });

  const decs = $derived(
    (Array.isArray(decisions.data) ? decisions.data : [])
      .map((d) => ({ ...d, ms: toMs(d.date) }))
      .sort((a, b) => (b.ms || 0) - (a.ms || 0))
  );
  const STATUS = { accepted: 'ok', proposed: 'info', draft: 'info', rejected: 'err', superseded: 'warn', deprecated: 'warn' };
  const tool = (p) => fileIndex().byPath.get(p)?.tool;
</script>

<div class="page">
  <div class="page-h">
    <div>
      <h1>Tasks & decisions</h1>
      <p>Every checkbox, TODO and decision across your markdown — linked to its source line.</p>
    </div>
    <span class="spacer"></span>
    <Tabs
      tabs={[{ id: 'board', label: 'Task board', count: all.filter((t) => !t.done).length }, { id: 'decisions', label: 'Decisions', count: decs.length }]}
      bind:active={tab}
      onchange={(t) => navigate('tasks', t === 'decisions' ? { tab: t } : {})}
    />
  </div>

  {#if tab === 'board'}
    <div class="summary card">
      <div class="col" style="gap:2px">
        <span class="eyebrow">Completion</span>
        <span class="big tnum"><Counter value={pct} />%</span>
      </div>
      <div class="pbar"><span style="width:{pct}%"></span></div>
      <div class="row small muted"><b class="tnum">{all.filter((t) => !t.done).length}</b> open · <b class="tnum">{all.filter((t) => t.done).length}</b> done · {progress.size} files</div>
      <div class="searchbox">
        <Icon name="filter" size={14} />
        <input class="input" placeholder="Filter tasks…" bind:value={q} aria-label="Filter tasks" />
      </div>
    </div>

    {#if tasks.error}
      <Empty icon="alert" title="Could not load tasks">{tasks.error.message}</Empty>
    {:else if !tasks.data}
      <div class="skel" style="height:300px"></div>
    {:else}
      <div class="board">
        {#each [['Open', open, 'open'], ['Done', done, 'done']] as [title, list, cls] (cls)}
          <section class="lane {cls}">
            <div class="lane-h">
              <span class="ld"></span>{title} <span class="faint tnum">{list.length}</span>
            </div>
            {#each byFile(list) as [path, items] (path)}
              {@const p = progress.get(path)}
              <div class="card fcard">
                <button class="fh" onclick={() => openFile(path, { drawer: true })}>
                  <ToolBadge tool={tool(path)} compact />
                  <span class="mono ellipsis grow">{path}</span>
                  {#if p}<span class="faint small tnum">{p.done}/{p.total}</span>{/if}
                </button>
                {#if p}<div class="mini"><span style="width:{(p.done / p.total) * 100}%"></span></div>{/if}
                <ul>
                  {#each items as t (t.path + ':' + t.line)}
                    <li>
                      <button class="task" class:done={t.done} onclick={() => openFile(t.path, { line: t.line })}>
                        <span class="cb">{#if t.done}<Icon name="check" size={11} stroke={3} />{/if}</span>
                        <span class="grow">
                          <span class="tt">{t.text}</span>
                          {#if t.section}<span class="sec">{t.section}</span>{/if}
                        </span>
                        <span class="ln tnum">L{t.line}</span>
                      </button>
                    </li>
                  {/each}
                </ul>
              </div>
            {:else}
              <div class="faint small pad">Nothing here.</div>
            {/each}
          </section>
        {/each}
      </div>
    {/if}
  {:else}
    {#if decisions.error}
      <Empty icon="alert" title="Could not load decisions">{decisions.error.message}</Empty>
    {:else if !decisions.data}
      <div class="skel" style="height:300px"></div>
    {:else if !decs.length}
      <Empty icon="tasks" title="No decisions found">Add ADRs under <code>docs/adr/</code> or “## Decision” headings to DECISIONS.md.</Empty>
    {:else}
      <ol class="timeline">
        {#each decs as d, i (d.path + d.line)}
          <li class="fade-up" style="animation-delay:{Math.min(i, 12) * 35}ms">
            <span class="tdot {STATUS[(d.status || '').toLowerCase()] || ''}"></span>
            <div class="tdate tnum">{d.ms ? fmtDay(d.ms) : 'undated'}</div>
            <button class="card dcard" onclick={() => openFile(d.path, { line: d.line })}>
              <div class="row">
                <span class="dt">{d.title}</span>
                <span class="spacer"></span>
                {#if d.status}<span class="badge {STATUS[d.status.toLowerCase()] || ''}">{d.status}</span>{/if}
              </div>
              <div class="mono faint small">{d.path}{d.line ? `:${d.line}` : ''}</div>
            </button>
          </li>
        {/each}
      </ol>
    {/if}
  {/if}
</div>

<style>
  .summary { display: flex; align-items: center; gap: 20px; padding: 14px 18px; margin-bottom: 16px; flex-wrap: wrap; }
  .big { font-size: 26px; font-weight: 700; letter-spacing: -0.03em; }
  .pbar { flex: 1; min-width: 140px; height: 8px; border-radius: 99px; background: var(--panel-active); overflow: hidden; }
  .pbar span { display: block; height: 100%; background: linear-gradient(90deg, var(--accent), var(--ok)); border-radius: inherit; transition: width 0.8s var(--ease); }
  .searchbox { position: relative; display: flex; align-items: center; color: var(--text-3); }
  .searchbox :global(.icon) { position: absolute; left: 10px; pointer-events: none; }
  .searchbox .input { padding-left: 30px; width: 220px; }
  .small { font-size: 12px; }
  .board { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
  .lane { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .lane-h { display: flex; align-items: center; gap: 8px; font-weight: 650; font-size: 13px; padding: 0 4px; }
  .ld { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
  .done .ld { background: var(--ok); }
  .fcard { padding: 4px 6px 6px; }
  .fh { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px; border: 0; background: transparent; cursor: pointer; font-size: 12.5px; font-weight: 600; text-align: left; border-radius: 8px; }
  .fh:hover { color: var(--accent); }
  .mini { height: 2px; margin: 0 8px 4px; background: var(--panel-active); border-radius: 2px; overflow: hidden; }
  .mini span { display: block; height: 100%; background: var(--ok); }
  ul { list-style: none; margin: 0; padding: 0; }
  .task { display: flex; align-items: flex-start; gap: 10px; width: 100%; border: 0; background: transparent; padding: 7px 8px; border-radius: 8px; cursor: pointer; text-align: left; font-size: 13px; }
  .task:hover { background: var(--panel-hover); }
  .cb { width: 16px; height: 16px; border-radius: 5px; border: 1.5px solid var(--border-strong); display: grid; place-items: center; flex-shrink: 0; margin-top: 2px; color: white; }
  .task.done .cb { background: var(--ok); border-color: var(--ok); }
  .task.done .tt { color: var(--text-3); text-decoration: line-through; }
  .sec { display: block; font-size: 11px; color: var(--text-3); margin-top: 1px; }
  .ln { font: 11px var(--mono); color: var(--text-3); padding-top: 2px; }
  .pad { padding: 10px; }
  .timeline { list-style: none; margin: 0; padding: 0 0 0 130px; position: relative; display: flex; flex-direction: column; gap: 12px; }
  .timeline::before { content: ''; position: absolute; left: 112px; top: 6px; bottom: 6px; width: 2px; background: linear-gradient(var(--accent), var(--border)); border-radius: 2px; }
  .timeline li { position: relative; }
  .tdate { position: absolute; left: -130px; width: 96px; text-align: right; top: 14px; font-size: 12px; color: var(--text-3); }
  .tdot { position: absolute; left: -23px; top: 16px; width: 12px; height: 12px; border-radius: 50%; background: var(--bg); border: 2.5px solid var(--text-3); }
  .tdot.ok { border-color: var(--ok); box-shadow: 0 0 10px var(--ok); }
  .tdot.info { border-color: var(--info); }
  .tdot.warn { border-color: var(--warn); }
  .tdot.err { border-color: var(--err); }
  .dcard { display: flex; flex-direction: column; gap: 4px; width: 100%; padding: 12px 14px; cursor: pointer; text-align: left; transition: transform 0.15s var(--ease), border-color 0.15s; }
  .dcard:hover { border-color: var(--border-strong); transform: translateX(3px); }
  .dt { font-weight: 600; }
  @media (max-width: 860px) {
    .board { grid-template-columns: 1fr; }
    .timeline { padding-left: 24px; }
    .timeline::before { left: 6px; }
    .tdate { position: static; text-align: left; width: auto; margin-bottom: 4px; }
    .tdot { left: -23px; top: 4px; }
    .searchbox .input { width: 100%; }
    .searchbox { width: 100%; }
  }
</style>
