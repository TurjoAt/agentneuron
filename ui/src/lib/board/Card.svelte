<script>
  import Icon from '../Icon.svelte';
  import { openFile } from '../store.svelte.js';
  import { PRIO, checkProgress, isOverdue, fmtDue } from './util.js';
  import { live, claimsForTask } from '../live.svelte.js';

  let { task, dragging = false, draggable = false, ondragstart, ondragend, onopen, compact = false } = $props();
  const prog = $derived(checkProgress(task));
  const over = $derived(isOverdue(task));
  const pr = $derived(PRIO[task.priority] || PRIO.none);
  // live coordination: advisory claims on this task / its files, agent assignees, handoff notes
  const claims = $derived(claimsForTask(task));
  const agentTool = $derived(/^(claude|codex|cursor)/i.exec(task.assignee || '')?.[1]?.toLowerCase() || null);
  const handoffs = $derived(live.handoffs.filter((h) => h.taskId === task.id).length);
</script>

<div
  class="tcard"
  class:dragging
  class:done={task.status === 'done'}
  data-id={task.id}
  role="button"
  tabindex="0"
  {draggable}
  {ondragstart}
  {ondragend}
  onclick={() => onopen?.(task.id)}
  onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), onopen?.(task.id))}
>
  <div class="top">
    {#if task.priority && task.priority !== 'none'}
      <span class="pf" style="color:{pr.color}" title="Priority: {pr.label}"><Icon name="flag" size={12} /></span>
    {/if}
    <span class="title">{task.title}</span>
  </div>
  {#if !compact && task.labels?.length}
    <div class="labels">
      {#each task.labels as l (l)}<span class="lab"><Icon name="tag" size={9} />{l}</span>{/each}
    </div>
  {/if}
  <div class="meta">
    {#if task.due}<span class="due" class:over title={over ? 'Overdue' : 'Due'}>{fmtDue(task.due)}</span>{/if}
    {#if prog.total}
      <span class="m" title="Checklist"><Icon name="checkSquare" size={11} />{prog.done}/{prog.total}</span>
    {/if}
    {#if task.comments?.length}<span class="m" title="Comments"><Icon name="message" size={11} />{task.comments.length}</span>{/if}
    <span class="spacer"></span>
    {#if handoffs}<span class="m" title="Handoff notes"><Icon name="message" size={11} />{handoffs}</span>{/if}
    {#if claims.length}<span class="m lock" title="Claimed by {claims.map((c) => `${c.agent} (${c.pattern})`).join(', ')}"><Icon name="lock" size={11} />{claims.length}</span>{/if}
    {#if task.assignee}<span class="who" class:agent={agentTool} style={agentTool ? `--c:var(--tool-${agentTool})` : ''} title={task.assignee}>{task.assignee.replace(/^@/, '').slice(0, 2).toUpperCase()}</span>{/if}
  </div>
  {#if prog.total && !compact}<div class="pb"><span style="width:{(prog.done / prog.total) * 100}%"></span></div>{/if}
  <div class="src">
    {#if task.source === 'md' && task.path}
      <button class="srcbtn mono" title="Open {task.path}:{task.line}" onclick={(e) => (e.stopPropagation(), openFile(task.path, { line: task.line }))}>
        <Icon name="file" size={10} /><span class="ellipsis">{task.path}:{task.line}</span>
      </button>
    {:else}
      <span class="badge native">native</span>
    {/if}
  </div>
</div>

<style>
  .tcard {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 10px 11px;
    border-radius: 11px;
    background: var(--panel-solid);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: border-color 0.15s, transform 0.15s var(--ease), box-shadow 0.15s;
    outline: none;
    min-width: 0;
  }
  .tcard[draggable='true'] { cursor: grab; }
  .tcard:hover, .tcard:focus-visible { border-color: var(--border-strong); box-shadow: var(--shadow); }
  .tcard:focus-visible { box-shadow: 0 0 0 3px var(--accent-soft); }
  .tcard.dragging { opacity: 0.4; }
  .top { display: flex; gap: 7px; align-items: flex-start; }
  .pf { display: inline-flex; margin-top: 2px; flex-shrink: 0; }
  .title { font-size: 13px; font-weight: 550; line-height: 1.4; word-break: break-word; }
  .done .title { color: var(--text-3); text-decoration: line-through; }
  .labels { display: flex; flex-wrap: wrap; gap: 4px; }
  .lab { display: inline-flex; align-items: center; gap: 3px; font-size: 10.5px; padding: 1px 7px; border-radius: 99px; background: var(--accent-soft); color: var(--accent); font-weight: 550; }
  .meta { display: flex; align-items: center; gap: 9px; font-size: 11px; color: var(--text-3); }
  .meta:empty { display: none; }
  .m { display: inline-flex; align-items: center; gap: 3px; }
  .due { padding: 1px 6px; border-radius: 6px; background: var(--panel-active); color: var(--text-2); font-weight: 550; }
  .due.over { background: var(--err-soft); color: var(--err); }
  .who { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 9px; font-weight: 700; background: var(--panel-active); color: var(--text-2); }
  .who.agent { background: color-mix(in srgb, var(--c) 22%, transparent); color: var(--c); box-shadow: 0 0 0 1px color-mix(in srgb, var(--c) 50%, transparent); }
  .lock { color: var(--warn); }
  .pb { height: 3px; border-radius: 3px; background: var(--panel-active); overflow: hidden; }
  .pb span { display: block; height: 100%; background: var(--ok); }
  .src { display: flex; min-width: 0; }
  .srcbtn { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; border: 0; background: transparent; padding: 0; font-size: 10.5px; color: var(--text-3); cursor: pointer; }
  .srcbtn:hover { color: var(--accent); }
  .badge.native { height: 16px; font-size: 10px; padding: 0 6px; color: var(--text-3); }
</style>
