<script>
  import { api, post } from '../lib/api.js';
  import { app, openFile, navigate, onStream, toast, saveLocal } from '../lib/store.svelte.js';
  import { resource } from '../lib/resource.svelte.js';
  import { fmtDay, toMs } from '../lib/format.js';
  import { canRun, levelReason, runAction } from '../lib/actions.js';
  import { openTask, createTask } from '../lib/fileActions.js';
  import Tabs from '../lib/Tabs.svelte';
  import Icon from '../lib/Icon.svelte';
  import Empty from '../lib/Empty.svelte';
  import BoardView from '../lib/board/BoardView.svelte';
  import ListView from '../lib/board/ListView.svelte';
  import TableView from '../lib/board/TableView.svelte';
  import CalendarView from '../lib/board/CalendarView.svelte';
  import TimelineView from '../lib/board/TimelineView.svelte';
  import { applyFilters, PRIORITIES, PRIO, isOverdue } from '../lib/board/util.js';

  let { params = {} } = $props();

  const VIEWS = ['board', 'list', 'table', 'calendar', 'timeline', 'decisions'];
  // Table is the default view: `#/tasks` ↔ table, `#/tasks?tab=board` ↔ board.
  // `?tab=table` (and legacy `?view=`) still resolve. The URL is the source of truth.
  const DEFAULT_TAB = 'table';
  const tab = $derived.by(() => {
    const t = params.tab || params.view;
    return VIEWS.includes(t) ? t : DEFAULT_TAB;
  });

  const board = resource(() => api('/api/board'));
  const decisions = resource(() => api('/api/decisions'), { enabled: () => tab === 'decisions' });
  $effect(() => onStream('board', () => board.reload()));

  let swimlane = $state(load('agentneuron.tasks.swimlane', 'none'));
  function load(k, d) {
    try { return localStorage.getItem(k) || d; } catch { return d; }
  }
  $effect(() => { try { localStorage.setItem('agentneuron.tasks.swimlane', swimlane); } catch {} });

  let f = $state({ q: '', label: '', priority: '', assignee: '', source: '', due: '' });
  const columns = $derived(board.data?.columns || []);
  const all = $derived(board.data?.tasks || []);
  const tasks = $derived(applyFilters(all, f));
  const filtering = $derived(Object.values(f).some(Boolean));
  const mutOk = $derived(canRun('state'));
  const reason = $derived(levelReason('state'));
  const open = $derived(all.filter((t) => t.status !== 'done').length);
  const overdue = $derived(all.filter(isOverdue).length);

  function setTab(t) {
    navigate('tasks', t === DEFAULT_TAB ? {} : { tab: t });
  }

  async function move(id, status, order) {
    const t = board.data?.tasks.find((x) => x.id === id);
    if (t) { t.status = status; t.order = order; } // optimistic
    try {
      const res = await post('/api/board/move', { id, status, order });
      if (res?.mdSynced === false) toast('Moved on board only — ' + (res.reason || 'markdown not updated'), 'warn', 6000);
    } catch (e) {
      toast(e.message, 'error');
    }
    board.reload();
  }
  async function setStatus(id, status) {
    const t = board.data?.tasks.find((x) => x.id === id);
    const order = Math.max(0, ...all.filter((x) => x.status === status).map((x) => x.order ?? 0)) + 1000;
    await move(id, status, t ? order : undefined);
  }
  async function quickAdd(status, title) {
    try {
      const order = Math.max(0, ...all.filter((x) => x.status === status).map((x) => x.order ?? 0)) + 1000;
      await post('/api/board/task', { task: { title, status, order } });
    } catch (e) {
      toast(e.message, 'error');
    }
    board.reload();
  }

  const decs = $derived(
    (Array.isArray(decisions.data) ? decisions.data : [])
      .map((d) => ({ ...d, ms: toMs(d.date) }))
      .sort((a, b) => (b.ms || 0) - (a.ms || 0))
  );
  const STATUS = { accepted: 'ok', proposed: 'info', draft: 'info', rejected: 'err', superseded: 'warn', deprecated: 'warn' };
</script>

<div class="page">
  <div class="page-h">
    <div>
      <h1>Tasks</h1>
      <p>
        {#if board.data}<b class="tnum">{open}</b> open{#if overdue} · <span class="od"><b class="tnum">{overdue}</b> overdue</span>{/if} · markdown checkboxes and native cards on one board.{:else}Markdown checkboxes and native cards on one board.{/if}
      </p>
    </div>
    <span class="spacer"></span>
    <button class="btn" onclick={() => runAction('tasks.export')} title="Write native tasks to TASKS.md"><Icon name="download" size={13} />Export</button>
    <button class="btn primary" disabled={!mutOk} title={mutOk ? '' : reason} onclick={() => createTask({})}><Icon name="plus" size={13} />New task</button>
  </div>

  <div class="tabrow">
    <Tabs
      tabs={[
        { id: 'board', label: 'Board' }, { id: 'list', label: 'List' }, { id: 'table', label: 'Table' },
        { id: 'calendar', label: 'Calendar' }, { id: 'timeline', label: 'Timeline' },
        { id: 'decisions', label: 'Decisions', count: decs.length || undefined },
      ]}
      active={tab}
      onchange={setTab}
    />
  </div>

  {#if tab !== 'decisions'}
    <div class="filters">
      <div class="searchbox">
        <Icon name="search" size={14} />
        <input class="input" placeholder="Search tasks…" bind:value={f.q} aria-label="Search tasks" />
      </div>
      <select class="input" bind:value={f.label} aria-label="Label"><option value="">All labels</option>{#each board.data?.labels || [] as l (l)}<option>{l}</option>{/each}</select>
      <select class="input" bind:value={f.priority} aria-label="Priority"><option value="">Any priority</option>{#each PRIORITIES as p (p)}<option value={p}>{PRIO[p].label}</option>{/each}</select>
      <select class="input" bind:value={f.assignee} aria-label="Assignee"><option value="">Anyone</option><option value="__none">Unassigned</option>{#each board.data?.assignees || [] as a (a)}<option>{a}</option>{/each}</select>
      <select class="input" bind:value={f.source} aria-label="Source"><option value="">All sources</option><option value="md">Markdown</option><option value="native">Native</option></select>
      <select class="input" bind:value={f.due} aria-label="Due"><option value="">Any due date</option><option value="overdue">Overdue</option><option value="week">Due this week</option></select>
      {#if tab === 'board'}
        <select class="input" bind:value={swimlane} aria-label="Swimlanes">
          <option value="none">No swimlanes</option><option value="label">Lanes: label</option><option value="priority">Lanes: priority</option>
          <option value="assignee">Lanes: assignee</option><option value="file">Lanes: file</option>
        </select>
      {/if}
      {#if filtering}<button class="btn ghost sm" onclick={() => (f = { q: '', label: '', priority: '', assignee: '', source: '', due: '' })}>Clear</button>{/if}
      <span class="faint small tnum">{tasks.length}/{all.length}</span>
    </div>
    {#if !mutOk}<div class="ro small"><Icon name="lock" size={12} />Read-only: {reason}. Dragging and editing are disabled.</div>{/if}

    {#if board.error}
      <Empty icon="alert" title="Could not load the board">{board.error.message}</Empty>
    {:else if !board.data}
      <div class="tskel" aria-label="Loading tasks">
        <span class="skel hd"></span>
        {#each [0, 1, 2, 3, 4, 5, 6] as i (i)}<span class="skel"></span>{/each}
      </div>
    {:else if !all.length}
      <Empty icon="tasks" title="No tasks yet">Add <code>- [ ] something</code> to any markdown file, or create a native card with “New task”.</Empty>
    {:else if tab === 'board'}
      <BoardView {tasks} allTasks={all} {columns} {swimlane} canMutate={mutOk} {reason} onmove={move} onadd={quickAdd} onopen={openTask} />
    {:else if tab === 'list'}
      <ListView {tasks} {columns} canMutate={mutOk} {reason} onstatus={setStatus} onopen={openTask} />
    {:else if tab === 'table'}
      <TableView {tasks} {columns} onopen={openTask} />
    {:else if tab === 'calendar'}
      <CalendarView {tasks} canMutate={mutOk} onopen={openTask} oncreate={(due) => createTask({ due })} />
    {:else if tab === 'timeline'}
      <TimelineView {tasks} onopen={openTask} />
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
  .tabrow { margin-bottom: 12px; display: flex; }
  .od { color: var(--err); }
  .filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 14px; }
  .filters select.input { height: 32px; width: auto; max-width: 150px; font-size: 12.5px; }
  .searchbox { position: relative; display: flex; align-items: center; color: var(--text-3); }
  .searchbox :global(.icon) { position: absolute; left: 10px; pointer-events: none; }
  .searchbox .input { padding-left: 30px; width: 200px; height: 32px; }
  .small { font-size: 12px; }
  .ro { display: flex; align-items: center; gap: 6px; color: var(--text-3); margin: -6px 0 12px; }
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
    .timeline { padding-left: 24px; }
    .timeline::before { left: 6px; }
    .tdate { position: static; text-align: left; width: auto; margin-bottom: 4px; }
    .tdot { left: -23px; top: 4px; }
    .searchbox, .searchbox .input { width: 100%; }
    .filters select.input { flex: 1; min-width: 120px; }
  }
  .tskel { display: flex; flex-direction: column; gap: 10px; padding: 6px 0; }
  .tskel .skel { height: 34px; border-radius: 9px; }
  .tskel .hd { height: 28px; opacity: 0.7; }
</style>
