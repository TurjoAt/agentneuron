<script>
  // Resume: pick a session or board task, read the evidence-backed brief, copy it as Markdown or save it.
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { navigate, toast } from '../../lib/store.svelte.js';
  import { runAction, actionEnabled } from '../../lib/actions.js';
  import { timeAgo } from '../../lib/format.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';
  import ToolBadge from '../../lib/ToolBadge.svelte';
  import ItemList from './ItemList.svelte';
  import Evidence from './Evidence.svelte';
  import { copyText } from '../usage/shared.js';

  let { params = {} } = $props();
  const session = $derived(params.session || '');
  const task = $derived(params.task || '');
  const saved = $derived(params.saved || '');

  const sources = resource(() => api('/api/brief/sources'), { live: false });
  const briefs = resource(() => api('/api/brief/briefs'), { live: false });
  const res = resource(
    ([s, t, b]) => (b ? api('/api/brief/brief', { id: b }).then((r) => ({ ...r.brief, savedAt: r.createdAt, savedId: r.id })) : api('/api/brief/resume', { session: s || undefined, task: t || undefined })),
    { key: () => [session, task, saved], live: false },
  );
  const brief = $derived(res.data);
  const sessions = $derived(sources.data?.sessions || []);
  const tasks = $derived(sources.data?.tasks || []);
  // debug reports are saved alongside resume briefs; this picker opens resume briefs only
  const savedList = $derived((briefs.data?.briefs || []).filter((b) => b.kind !== 'debug'));
  let pick = $state('sessions');
  const select = (p) => navigate('brief', { tab: 'resume', ...p });
  const saveState = $derived(actionEnabled('brief.save'));
  const label = (s) => s.title || `Session ${String(s.sessionId).slice(0, 8)}`;

  async function copyMd() {
    if (!brief?.markdown) return;
    toast((await copyText(brief.markdown)) ? 'Resume brief copied as Markdown' : 'Could not copy to the clipboard', 'info', 2600);
  }
  async function save() {
    const job = await runAction('brief.save', { kind: 'resume', session: brief?.source?.session || session || undefined, task: task || undefined }, { title: 'Save resume brief' });
    if (job?.status === 'ok') { briefs.reload(); toast('Brief saved; agents see it through get_handoffs', 'ok', 3200); }
  }
  const SECTIONS = [
    ['done', 'Done', 'check', 'ok', 'Nothing recorded as done yet.'],
    ['failed', 'Failed attempts', 'alert', 'err', 'No failures recorded.'],
    ['decisions', 'Decisions and corrections', 'flag', 'info', 'No user corrections or answers recorded.'],
    ['next', 'Next steps', 'target', 'warn', 'No open next steps were derived.'],
  ];
</script>

<div class="grid">
  <aside class="card pick" aria-label="Pick a session or task">
    <div class="segc" role="group" aria-label="Source">
      <button class:on={pick === 'sessions'} aria-pressed={pick === 'sessions'} onclick={() => (pick = 'sessions')}>Sessions</button>
      <button class:on={pick === 'tasks'} aria-pressed={pick === 'tasks'} onclick={() => (pick = 'tasks')}>Tasks</button>
      <button class:on={pick === 'saved'} aria-pressed={pick === 'saved'} onclick={() => (pick = 'saved')}>Saved{#if savedList.length}<span class="n">{savedList.length}</span>{/if}</button>
    </div>
    {#if sources.data === undefined && !sources.error}
      <div class="skel-rows pad"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>
    {:else if pick === 'sessions'}
      {#if !sessions.length}<Empty compact icon="message" title="No sessions">Agent sessions of this project (last 30 days) appear here.</Empty>{/if}
      <ul class="plist">
        {#each sessions as s (s.sessionId)}
          <li><button class="prow" class:on={(brief?.source?.session === s.sessionId && !task && !saved) || session === s.sessionId} onclick={() => select({ session: s.sessionId })}>
            <ToolBadge tool={s.tool} compact />
            <span class="pt">{label(s)}</span>
            <span class="pm">{timeAgo(s.lastAt)}{#if s.errors} · <span class="err">{s.errors} err</span>{/if}</span>
          </button></li>
        {/each}
      </ul>
    {:else if pick === 'tasks'}
      {#if !tasks.length}<Empty compact icon="board" title="No open tasks">Board tasks (markdown checkboxes or native tasks) appear here.</Empty>{/if}
      <ul class="plist">
        {#each tasks as t (t.id)}
          <li><button class="prow" class:on={task === t.id} onclick={() => select({ task: t.id })}>
            <Icon name="board" size={13} /><span class="pt">{t.title || t.id}</span><span class="pm">{t.status}</span>
          </button></li>
        {/each}
      </ul>
    {:else}
      {#if !savedList.length}<Empty compact icon="save" title="No saved briefs">Save a brief to keep it and hand it to the next agent (get_handoffs).</Empty>{/if}
      <ul class="plist">
        {#each savedList as b (b.id)}
          <li><button class="prow" class:on={saved === b.id} onclick={() => select({ saved: b.id })}>
            <Icon name={b.kind === 'debug' ? 'alert' : 'save'} size={13} /><span class="pt">{b.title || b.id}</span><span class="pm">{timeAgo(b.createdAt)}</span>
          </button></li>
        {/each}
      </ul>
    {/if}
  </aside>

  <div class="main">
    {#if res.error && !brief}
      <div class="card"><Empty icon="alert" title={res.error.status === 404 ? 'Not found' : 'Could not build the brief'}>{res.error.message}</Empty></div>
    {:else if brief === undefined}
      <div class="card card-b sk" aria-busy="true"><div class="skel-rows"><div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div></div></div>
    {:else if !brief.source?.sessions?.length && !brief.task}
      <div class="card"><Empty icon="message" title="No agent session yet">Run Claude Code or Codex in this project; the newest session is briefed automatically. Or pick a board task.</Empty></div>
    {:else}
      <article class="card brief" aria-busy={res.loading}>
        <header class="bh">
          <div class="bt">
            <div class="kicker">{brief.savedId ? `Saved brief ${brief.savedId}` : brief.task ? `Task ${brief.task.id}` : 'Session brief'}{#if brief.savedAt} · {timeAgo(brief.savedAt)}{/if}</div>
            <h2>{brief.title || brief.task?.id || (brief.source?.session ? `Session ${brief.source.session.slice(0, 8)}` : 'Resume brief')}</h2>
            <div class="srcs">
              {#each brief.sessions || [] as s (s.sessionId)}<span class="chip"><ToolBadge tool={s.tool} compact /><EntityLink kind="session" id={s.sessionId} label={s.sessionId.slice(0, 8)} mono />{#if s.branch}<span class="muted">{s.branch}</span>{/if}</span>{/each}
              {#if brief.task}<span class="chip"><EntityLink kind="task" id={brief.task.id} label={brief.task.id} mono /></span>{/if}
            </div>
          </div>
          <div class="acts">
            <button class="btn sm" onclick={copyMd} disabled={!brief.markdown} title={brief.markdown ? 'Copy the brief as Markdown to paste into another agent' : 'Markdown export is admin-only'}><Icon name="copy" size={13} />Copy as Markdown</button>
            {#if !brief.savedId}<button class="btn sm primary" onclick={save} disabled={!saveState.enabled} title={saveState.enabled ? 'Save to .agentneuron/briefs/ and add a handoff note' : saveState.reason}><Icon name="save" size={13} />Save</button>{/if}
          </div>
        </header>

        <div class="goal">
          <div class="gl">Goal</div>
          {#if brief.task?.title}<div class="gt">{brief.task.title}</div>{/if}
          {#if brief.goal?.prompt}<blockquote>{brief.goal.prompt}</blockquote>{:else if !brief.task?.title}<p class="muted small">Prompt text is hidden for your role or was not recorded.</p>{/if}
          {#if brief.lastPrompt}<div class="last"><span class="muted">Last request:</span> {brief.lastPrompt}</div>{/if}
          <Evidence evidence={brief.goal?.evidence} />
        </div>

        <div class="kpis">
          {#each [['Done', brief.counts?.done, 'ok'], ['Failed', brief.counts?.failed, 'err'], ['Decisions', brief.counts?.decisions, 'info'], ['Files', brief.counts?.files, ''], ['Next', brief.counts?.next, 'warn']] as [l, n, c] (l)}
            <div class="kpi"><span class="kn {c}">{n ?? 0}</span><span class="kl">{l}</span></div>
          {/each}
        </div>

        <div class="secs">
          {#each SECTIONS.slice(0, 3) as [k, t, ic, tone, empty] (k)}<ItemList title={t} icon={ic} {tone} items={brief[k]} {empty} />{/each}

          <section class="sec" aria-label="Files">
            <h3 class="sec-h"><Icon name="file" size={13} />Files<span class="n">{brief.files?.length || 0}</span></h3>
            {#if !brief.files?.length}<p class="muted small">No files changed.</p>{/if}
            <ul class="files">
              {#each (brief.files || []).slice(0, 30) as f (f.path)}
                <li><EntityLink kind="file" id={f.path} label={f.path} mono />{#if f.edits}<span class="muted">{f.edits} edit{f.edits === 1 ? '' : 's'}</span>{/if}<Evidence evidence={f.evidence} max={2} /></li>
              {/each}
            </ul>
          </section>

          <section class="sec" aria-label="Tests and checks">
            <h3 class="sec-h"><Icon name="play" size={13} />Tests and checks<span class="n">{brief.runs?.length || 0}</span></h3>
            {#if !brief.runs?.length}<p class="muted small">No verification runs recorded. Run the checks from Ship check before continuing.</p>{/if}
            {#each brief.runs || [] as r (r.id)}
              <div class="run">
                <span class="badge {r.failed ? 'err' : r.exitCode === 0 ? 'ok' : 'warn'}">{r.kind}</span>
                <span>{r.failed ? `${r.failed} failing` : r.exitCode === 0 ? 'passing' : `exit ${r.exitCode ?? '?'}`}{r.passed != null ? ` · ${r.passed} passed` : ''}</span>
                {#if r.command}<code class="cmd">{r.command}</code>{/if}
                <span class="muted">{timeAgo(r.endedAt || r.startedAt)}</span>
              </div>
              {#each r.failures || [] as f, i (i)}<div class="fail"><Icon name="x" size={11} />{f.name}{#if f.file} · <EntityLink kind="file" id={f.file} label={f.file} mono />{/if}{#if f.quote}<q class="quote">{f.quote}</q>{/if}</div>{/each}
            {/each}
          </section>

          {#if brief.todos?.length}<ItemList title="Todos" icon="list" items={brief.todos} />{/if}
          {#if brief.criteria?.length}<ItemList title="Acceptance criteria" icon="check" items={brief.criteria} />{/if}
          <ItemList title={SECTIONS[3][1]} icon={SECTIONS[3][2]} tone={SECTIONS[3][3]} items={brief.next} empty={SECTIONS[3][4]} />
        </div>
      </article>
    {/if}
  </div>
</div>

<style>
  .grid { display: grid; grid-template-columns: minmax(220px, 280px) minmax(0, 1fr); gap: 14px; align-items: start; }
  @media (max-width: 860px) { .grid { grid-template-columns: minmax(0, 1fr); } }
  .pick { padding: 10px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .pick .segc { display: flex; }
  .pick .segc button { flex: 1; }
  .segc .n { margin-left: 4px; color: var(--text-3); }
  .pad { padding: 8px 4px; }
  .plist { list-style: none; margin: 0; padding: 0; max-height: 520px; overflow: auto; display: flex; flex-direction: column; gap: 2px; }
  @media (max-width: 860px) { .plist { max-height: 220px; } }
  .prow { width: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-rows: auto auto; column-gap: 8px; align-items: center; text-align: left; padding: 7px 8px; border-radius: var(--radius-xs); background: none; border: 1px solid transparent; color: var(--text); cursor: pointer; font: inherit; font-size: 13px; }
  .prow:hover { background: var(--panel-hover); }
  .prow.on { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
  .pt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pm { grid-column: 2; font-size: 11px; color: var(--text-3); }
  .pm .err { color: var(--err); }
  .main { min-width: 0; }
  .sk { padding-top: 16px; }
  .brief { padding: 16px; display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .bh { display: flex; gap: 12px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
  .bt { min-width: 0; flex: 1 1 260px; }
  .kicker { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); }
  h2 { margin: 2px 0 6px; font-size: 18px; overflow-wrap: anywhere; }
  .srcs { display: flex; flex-wrap: wrap; gap: 6px; }
  .srcs .chip { gap: 6px; cursor: default; }
  .acts { display: flex; gap: 6px; flex-wrap: wrap; }
  .goal { padding: 10px 12px; border-radius: var(--radius-sm); background: var(--inset); border: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; }
  .gl { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); }
  .gt { font-weight: 600; }
  blockquote { margin: 0; padding-left: 10px; border-left: 3px solid var(--accent); overflow-wrap: anywhere; }
  .last { font-size: 12px; overflow-wrap: anywhere; }
  .kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
  @media (max-width: 520px) { .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  .kpi { display: flex; flex-direction: column; align-items: flex-start; padding: 8px 10px; border-radius: var(--radius-xs); background: var(--panel-hover); }
  .kn { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .kn.ok { color: var(--ok); } .kn.err { color: var(--err); } .kn.info { color: var(--info); } .kn.warn { color: var(--warn); }
  .kl { font-size: 11px; color: var(--text-3); }
  .secs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  @media (max-width: 1100px) { .secs { grid-template-columns: minmax(0, 1fr); } }
  .sec-h { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 650; margin: 0 0 8px; }
  .sec-h .n { color: var(--text-3); font-weight: 500; }
  .files { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
  .files li { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 13px; min-width: 0; }
  .run { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 13px; margin-bottom: 4px; }
  .fail { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 12px; color: var(--text-2); padding-left: 8px; margin-bottom: 4px; overflow-wrap: anywhere; }
  .fail .quote { flex-basis: 100%; }
  .cmd { padding: 0 6px; border-radius: 5px; background: var(--panel-active); font-family: var(--mono); font-size: 12px; overflow-wrap: anywhere; }
  .quote { color: var(--text-2); font-size: 12px; }
  .small { font-size: 12px; margin: 0; }
</style>
