<script>
  import { untrack } from 'svelte';
  import Modal from '../Modal.svelte';
  import Icon from '../Icon.svelte';
  import Markdown from '../Markdown.svelte';
  import { api, post } from '../api.js';
  import { app, openFile, toast, fileIndex } from '../store.svelte.js';
  import { canRun, levelReason } from '../actions.js';
  import { PRIORITIES, PRIO, isOverdue } from './util.js';
  import { timeAgo } from '../format.js';
  import { live, claimsForTask } from '../live.svelte.js';

  let { id = null, create = false, title: initTitle = '', files: initFiles = [], line = null, due: initDue = null, status: initStatus = 'todo', onclose } = $props();

  const isNew = untrack(() => !id);
  let board = $state(null);
  let loadErr = $state('');
  let task = $state(null); // server copy (edit)
  let d = $state({ title: untrack(() => initTitle) || '', description: '', status: untrack(() => initStatus) || 'todo', priority: 'none', labels: [], due: untrack(() => initDue) || '', assignee: '', files: [...untrack(() => initFiles || [])], checklist: [] });
  let target = $state(''); // '' = native, else md path
  let preview = $state(false);
  let busy = $state(false);
  let warn = $state('');
  let newLabel = $state('');
  let newCheck = $state('');
  let newFile = $state('');
  let comment = $state('');
  let confirmDel = $state(false);
  let orig = '';

  const mutOk = $derived(canRun('state'));
  // live coordination: handoff notes written for this task, advisory claims on it
  let handoffs = $state.raw([]);
  $effect(() => {
    void live.handoffs;
    const tid = id;
    if (!tid) return;
    api('/api/live/handoffs', { taskId: tid, limit: 10 }).then((r) => (handoffs = r?.handoffs || []), () => (handoffs = []));
  });
  const taskClaims = $derived(task ? claimsForTask(task) : []);
  const reason = $derived(levelReason('state'));
  const mdOk = $derived(canRun('edit'));
  const isMd = $derived(task?.source === 'md');
  const mdFiles = $derived(app.files.filter((f) => /\.(md|mdc|markdown)$/i.test(f.path)).map((f) => f.path));

  function fill(t) {
    task = t;
    d = {
      title: t.title, description: t.description || '', status: t.status, priority: t.priority || 'none', labels: [...(t.labels || [])],
      due: t.due || '', assignee: t.assignee || '', files: [...(t.files || [])], checklist: (t.checklist || []).map((c) => ({ text: c.text, done: !!c.done })),
    };
    orig = JSON.stringify(d);
  }

  async function load(first = false) {
    try {
      const b = await api('/api/board');
      board = b;
      if (id) {
        const t = b.tasks.find((x) => x.id === id);
        if (!t) loadErr = 'Task not found (it may have been deleted or moved).';
        else if (first) fill(t);
        else task = t; // keep draft; refresh comments etc.
      }
    } catch (e) {
      loadErr = e.message;
    }
  }
  $effect(() => {
    untrack(() => load(true));
  });

  const dirty = $derived(isNew || JSON.stringify(d) !== orig);

  function addLabel() {
    for (const l of newLabel.split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean)) if (!d.labels.includes(l)) d.labels.push(l);
    newLabel = '';
  }
  function addCheck() {
    const t = newCheck.trim();
    if (!t) return;
    d.checklist.push({ text: t, done: false });
    newCheck = '';
  }
  function addFile() {
    const f = newFile.trim();
    if (f && !d.files.includes(f)) d.files.push(f);
    newFile = '';
  }

  function result(res) {
    if (res?.mdSynced === false) {
      warn = res.reason || 'Not written back to the markdown file';
      toast('Saved to board only — ' + warn, 'warn', 7000);
    }
  }

  async function save() {
    if (!d.title.trim()) return;
    busy = true;
    try {
      const body = {
        title: d.title.trim(), description: d.description, status: d.status, priority: d.priority, labels: d.labels,
        due: d.due || null, assignee: d.assignee.trim() || null, files: d.files, checklist: d.checklist,
      };
      if (isNew) {
        const res = await post('/api/board/task', { task: body, ...(target ? { path: target } : {}) });
        result(res);
        toast('Task created', 'ok');
      } else {
        const patch = {};
        const o = JSON.parse(orig);
        for (const k of Object.keys(body)) {
          const nk = k === 'due' || k === 'assignee' ? (d[k] || null) : body[k];
          const ok = k === 'due' || k === 'assignee' ? (o[k] || null) : o[k];
          if (JSON.stringify(nk) !== JSON.stringify(ok)) patch[k] = nk;
        }
        if (Object.keys(patch).length) {
          const res = await post('/api/board/update', { id, patch });
          result(res);
          if (res?.mdSynced === false) {
            if (res.task) fill(res.task);
            busy = false;
            return; // stay open so the warning is visible
          }
        }
        toast('Task saved', 'ok');
      }
      onclose?.();
    } catch (e) {
      toast(e.message, 'error', 6000);
    } finally {
      busy = false;
    }
  }

  async function addComment() {
    const text = comment.trim();
    if (!text || !id) return;
    try {
      const res = await post('/api/board/comment', { id, text });
      comment = '';
      if (res?.task) task = { ...task, comments: res.task.comments };
      else await load();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function remove() {
    busy = true;
    try {
      await post('/api/board/delete', { id });
      toast('Task deleted', 'ok');
      onclose?.();
    } catch (e) {
      toast(e.message, 'error');
      busy = false;
    }
  }

  const doneN = $derived(d.checklist.filter((c) => c.done).length);
  const modalTitle = $derived(isNew ? 'New task' : 'Task');
</script>

<Modal title={modalTitle} icon="tasks" width={760} {onclose} subtitle={task ? (isMd ? `Markdown · ${task.path}:${task.line}` : 'Native board task') : ''}>
  {#if loadErr}
    <p class="err">{loadErr}</p>
  {:else if !isNew && !task}
    <div class="skel" style="height:240px"></div>
  {:else}
    {#if !mutOk}
      <div class="notice"><Icon name="lock" size={13} />Read-only — {reason}</div>
    {/if}
    {#if warn}
      <div class="notice warn"><Icon name="alert" size={13} />Not written back to markdown: {warn}</div>
    {:else if isMd && !mdOk && mutOk}
      <div class="notice"><Icon name="info" size={13} />Markdown write-back is off ({levelReason('edit')}). Changes are kept on the board only.</div>
    {/if}

    <div class="layout">
      <div class="main">
        <input class="input title" placeholder="Task title" bind:value={d.title} disabled={!mutOk} aria-label="Title" />

        <div class="sect">
          <div class="sh">
            <span class="eyebrow">Description</span>
            <span class="spacer"></span>
            <div class="seg">
              <button class:on={!preview} onclick={() => (preview = false)}>Edit</button>
              <button class:on={preview} onclick={() => (preview = true)}>Preview</button>
            </div>
          </div>
          {#if preview}
            <div class="prev card">
              {#if d.description.trim()}<Markdown source={d.description} path={task?.path || ''} />{:else}<span class="faint">Nothing to preview.</span>{/if}
            </div>
          {:else}
            <textarea class="input ta" rows="6" placeholder="Markdown supported…" bind:value={d.description} disabled={!mutOk}></textarea>
          {/if}
        </div>

        <div class="sect">
          <div class="sh">
            <span class="eyebrow"><Icon name="checkSquare" size={11} /> Checklist</span>
            {#if d.checklist.length}<span class="faint small tnum">{doneN}/{d.checklist.length}</span>{/if}
          </div>
          {#if d.checklist.length}
            <div class="pb"><span style="width:{(doneN / d.checklist.length) * 100}%"></span></div>
          {/if}
          {#each d.checklist as c, i (i)}
            <div class="ck">
              <input type="checkbox" bind:checked={c.done} disabled={!mutOk} aria-label="Done" />
              <span class="grow" class:done={c.done}>{c.text}</span>
              <button class="btn icon ghost sm" aria-label="Remove item" disabled={!mutOk} onclick={() => d.checklist.splice(i, 1)}><Icon name="x" size={12} /></button>
            </div>
          {/each}
          <form class="add" onsubmit={(e) => (e.preventDefault(), addCheck())}>
            <input class="input" placeholder="Add checklist item…" bind:value={newCheck} disabled={!mutOk} />
            <button class="btn sm" type="submit" disabled={!mutOk || !newCheck.trim()}><Icon name="plus" size={12} />Add</button>
          </form>
        </div>

        <div class="sect">
          <div class="sh"><span class="eyebrow"><Icon name="paperclip" size={11} /> Linked files</span></div>
          <div class="chips">
            {#each d.files as f, i (f)}
              <span class="fchip">
                <button class="fl mono" onclick={() => openFile(f, { line: f === task?.path ? task?.line : undefined })} title="Open {f}">{f}</button>
                <button class="x" aria-label="Unlink {f}" disabled={!mutOk} onclick={() => d.files.splice(i, 1)}><Icon name="x" size={10} /></button>
              </span>
            {:else}<span class="faint small">None</span>{/each}
          </div>
          <form class="add" onsubmit={(e) => (e.preventDefault(), addFile())}>
            <input class="input" list="tm-files" placeholder="Link a file path…" bind:value={newFile} disabled={!mutOk} />
            <datalist id="tm-files">{#each fileIndex().byPath.keys() as p (p)}<option value={p}></option>{/each}</datalist>
            <button class="btn sm" type="submit" disabled={!mutOk || !newFile.trim()}><Icon name="plus" size={12} />Link</button>
          </form>
        </div>

        {#if !isNew && (handoffs.length || taskClaims.length)}
          <div class="sect">
            <div class="sh"><span class="eyebrow"><Icon name="users" size={11} /> Agents</span></div>
            {#each taskClaims as c (c.id)}
              <div class="faint small"><Icon name="lock" size={11} /> <b>{c.agent}</b> claims <code>{c.pattern}</code> · {Math.max(0, Math.round((c.expiresAt - Date.now()) / 60000))} min left</div>
            {/each}
            {#each handoffs as h (h.id)}
              <div class="cm">
                <div class="cmh"><b>{h.agent}</b><span class="faint">handoff · {timeAgo(h.ts)}</span></div>
                <div class="cmb">
                  {#if h.summary}{h.summary}{/if}
                  {#if h.done.length}<div><span class="faint">Done:</span> {h.done.join(' · ')}</div>{/if}
                  {#if h.next.length}<div><span class="faint">Next:</span> {h.next.join(' · ')}</div>{/if}
                  {#if h.blockers.length}<div><span class="faint">Blockers:</span> {h.blockers.join(' · ')}</div>{/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}

        {#if !isNew}
          <div class="sect">
            <div class="sh"><span class="eyebrow"><Icon name="message" size={11} /> Comments</span><span class="faint small tnum">{task?.comments?.length || 0}</span></div>
            {#each task?.comments || [] as c (c.id)}
              <div class="cm">
                <div class="cmh"><b>{c.author || 'user'}</b><span class="faint">{timeAgo(c.ts)}</span></div>
                <div class="cmb">{c.text}</div>
              </div>
            {/each}
            <form class="add" onsubmit={(e) => (e.preventDefault(), addComment())}>
              <input class="input" placeholder={mutOk ? 'Write a comment…' : reason} bind:value={comment} disabled={!mutOk} />
              <button class="btn sm primary" type="submit" disabled={!mutOk || !comment.trim()}>Comment</button>
            </form>
          </div>
        {/if}
      </div>

      <aside class="side">
        <label class="f">Status
          <select class="input" bind:value={d.status} disabled={!mutOk}>
            {#each board?.columns || [] as c (c.id)}<option value={c.id}>{c.title}</option>{/each}
          </select>
        </label>
        <label class="f">Priority
          <select class="input" bind:value={d.priority} disabled={!mutOk}>
            {#each PRIORITIES as p (p)}<option value={p}>{PRIO[p].label}</option>{/each}
          </select>
        </label>
        <label class="f">Due date
          <input class="input" type="date" bind:value={d.due} disabled={!mutOk} class:over={task && isOverdue({ ...task, due: d.due, status: d.status })} />
        </label>
        <label class="f">Assignee
          <input class="input" list="tm-who" placeholder="@name" bind:value={d.assignee} disabled={!mutOk} />
          <datalist id="tm-who">{#each board?.assignees || [] as a (a)}<option value={a}></option>{/each}</datalist>
        </label>
        <div class="f">Labels
          <div class="chips">
            {#each d.labels as l, i (l)}
              <span class="lab">{l}<button aria-label="Remove label {l}" disabled={!mutOk} onclick={() => d.labels.splice(i, 1)}><Icon name="x" size={9} /></button></span>
            {/each}
          </div>
          <form class="add" onsubmit={(e) => (e.preventDefault(), addLabel())}>
            <input class="input" list="tm-labels" placeholder="Add label…" bind:value={newLabel} disabled={!mutOk} onblur={addLabel} />
            <datalist id="tm-labels">{#each board?.labels || [] as l (l)}<option value={l}></option>{/each}</datalist>
          </form>
        </div>
        {#if isNew}
          <label class="f">Save to
            <select class="input" bind:value={target} disabled={!mutOk}>
              <option value="">Board only (native)</option>
              {#if mdOk}
                {#each mdFiles as p (p)}<option value={p}>Append to {p}</option>{/each}
              {/if}
            </select>
            {#if !mdOk}<span class="faint small">Markdown targets: {levelReason('edit')}</span>{/if}
          </label>
        {:else if task}
          <div class="faint small meta">
            <div>Created {timeAgo(task.createdAt)}</div>
            <div>Updated {timeAgo(task.updatedAt)}</div>
            {#if isMd}<button class="lnk mono" onclick={() => openFile(task.path, { line: task.line })}>{task.path}:{task.line}</button>{/if}
          </div>
        {/if}
      </aside>
    </div>
  {/if}

  {#snippet footer()}
    {#if !isNew && task}
      {#if confirmDel}
        <span class="small">Delete this task{isMd ? ' (hidden from board; markdown line is kept)' : ''}?</span>
        <button class="btn sm" onclick={() => (confirmDel = false)}>Keep</button>
        <button class="btn sm danger" onclick={remove} disabled={busy}><Icon name="trash" size={12} />Delete</button>
      {:else}
        <button class="btn sm danger" title={mutOk ? '' : reason} disabled={!mutOk || busy} onclick={() => (confirmDel = true)}><Icon name="trash" size={12} />Delete</button>
      {/if}
    {/if}
    <span class="spacer"></span>
    <button class="btn" onclick={onclose}>{dirty && !isNew ? 'Discard' : 'Close'}</button>
    <button class="btn primary" onclick={save} disabled={!mutOk || busy || !d.title.trim() || !dirty} title={mutOk ? '' : reason}>
      {isNew ? 'Create task' : 'Save changes'}
    </button>
  {/snippet}
</Modal>

<style>
  .err { color: var(--err); }
  .notice { display: flex; align-items: center; gap: 8px; font-size: 12.5px; padding: 8px 12px; border-radius: 9px; background: var(--panel-active); color: var(--text-2); margin-bottom: 12px; }
  .notice.warn { background: var(--warn-soft); color: var(--warn); }
  .layout { display: grid; grid-template-columns: minmax(0, 1fr) 210px; gap: 20px; }
  .main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .side { display: flex; flex-direction: column; gap: 12px; }
  .title { height: 40px; font-size: 16px; font-weight: 600; }
  .sect { display: flex; flex-direction: column; gap: 8px; }
  .sh { display: flex; align-items: center; gap: 8px; }
  .eyebrow { display: inline-flex; align-items: center; gap: 5px; }
  .small { font-size: 12px; }
  .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; padding: 2px; background: var(--inset); }
  .seg button { border: 0; background: transparent; font-size: 11.5px; padding: 2px 10px; border-radius: 6px; color: var(--text-2); cursor: pointer; }
  .seg button.on { background: var(--panel-active); color: var(--text); }
  .ta { height: auto; padding: 9px 11px; resize: vertical; font-family: var(--mono); font-size: 12.5px; line-height: 1.55; width: 100%; box-sizing: border-box; }
  .prev { padding: 10px 14px; min-height: 120px; max-height: 280px; overflow: auto; }
  .pb { height: 4px; background: var(--panel-active); border-radius: 4px; overflow: hidden; }
  .pb span { display: block; height: 100%; background: var(--ok); transition: width 0.3s var(--ease); }
  .ck { display: flex; align-items: center; gap: 9px; font-size: 13px; }
  .ck .done { color: var(--text-3); text-decoration: line-through; }
  .add { display: flex; gap: 6px; }
  .add .input { flex: 1; height: 30px; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .fchip { display: inline-flex; align-items: center; border: 1px solid var(--border); border-radius: 99px; background: var(--panel-active); }
  .fl { border: 0; background: transparent; font-size: 11.5px; padding: 3px 4px 3px 10px; cursor: pointer; color: var(--text-2); }
  .fl:hover { color: var(--accent); }
  .x { border: 0; background: transparent; color: var(--text-3); cursor: pointer; padding: 3px 7px 3px 3px; display: grid; place-items: center; }
  .x:hover { color: var(--err); }
  .cm { padding: 8px 11px; border-radius: 10px; background: var(--inset); border: 1px solid var(--border); }
  .cmh { display: flex; gap: 8px; font-size: 11.5px; margin-bottom: 2px; }
  .cmb { font-size: 13px; white-space: pre-wrap; word-break: break-word; }
  .f { display: flex; flex-direction: column; gap: 5px; font-size: 11.5px; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em; }
  .f :global(.input) { text-transform: none; letter-spacing: 0; font-weight: 400; color: var(--text); font-size: 13px; }
  .f :global(.input.over) { border-color: var(--err); }
  .f .small { text-transform: none; letter-spacing: 0; font-weight: 400; }
  .lab { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 2px 4px 2px 8px; border-radius: 99px; background: var(--accent-soft); color: var(--accent); font-weight: 550; text-transform: none; letter-spacing: 0; }
  .lab button { border: 0; background: transparent; color: inherit; cursor: pointer; display: grid; place-items: center; padding: 2px; }
  .meta { display: flex; flex-direction: column; gap: 3px; }
  .lnk { border: 0; background: transparent; padding: 0; text-align: left; color: var(--text-3); cursor: pointer; font-size: 11.5px; }
  .lnk:hover { color: var(--accent); }
  @media (max-width: 700px) { .layout { grid-template-columns: 1fr; } .side { order: -1; } }
</style>
