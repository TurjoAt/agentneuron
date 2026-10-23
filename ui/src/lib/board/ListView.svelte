<script>
  import Icon from '../Icon.svelte';
  import { byOrder, fmtDue, isOverdue, statusColor, PRIO, checkProgress } from './util.js';
  import { openFile } from '../store.svelte.js';

  let { tasks = [], columns = [], canMutate = true, reason = '', onstatus, onopen } = $props();
  let collapsed = $state({});
  const groups = $derived(columns.map((c) => ({ ...c, items: tasks.filter((t) => t.status === c.id).sort(byOrder) })));
</script>

<div class="list">
  {#each groups as g (g.id)}
    <section class="card grp">
      <button class="gh" onclick={() => (collapsed[g.id] = !collapsed[g.id])} aria-expanded={!collapsed[g.id]}>
        <Icon name={collapsed[g.id] ? 'chevron' : 'chevronDown'} size={13} />
        <span class="dot" style="background:{statusColor(g.id)}"></span>
        <b>{g.title}</b><span class="faint tnum">{g.items.length}</span>
      </button>
      {#if !collapsed[g.id]}
        {#each g.items as t (t.id)}
          {@const p = checkProgress(t)}
          <div class="row-t" role="button" tabindex="0" onclick={() => onopen(t.id)} onkeydown={(e) => e.key === 'Enter' && e.target === e.currentTarget && onopen(t.id)}>
            <button class="chk" class:on={t.status === 'done'} disabled={!canMutate} title={canMutate ? (t.status === 'done' ? 'Reopen' : 'Mark done') : reason}
              aria-label="Toggle done" onclick={(e) => (e.stopPropagation(), onstatus(t.id, t.status === 'done' ? 'todo' : 'done'))}>
              {#if t.status === 'done'}<Icon name="check" size={11} stroke={3} />{/if}
            </button>
            {#if t.priority && t.priority !== 'none'}<span style="color:{PRIO[t.priority].color}" title={PRIO[t.priority].label}><Icon name="flag" size={12} /></span>{/if}
            <span class="tt grow ellipsis" class:done={t.status === 'done'}>{t.title}</span>
            {#each (t.labels || []).slice(0, 3) as l (l)}<span class="lab hide-m">{l}</span>{/each}
            {#if p.total}<span class="faint small tnum hide-m">{p.done}/{p.total}</span>{/if}
            {#if t.due}<span class="due small" class:over={isOverdue(t)}>{fmtDue(t.due)}</span>{/if}
            {#if t.assignee}<span class="faint small hide-m">{t.assignee}</span>{/if}
            {#if t.source === 'md'}
              <button class="src mono hide-m" onclick={(e) => (e.stopPropagation(), openFile(t.path, { line: t.line }))}>{t.path}:{t.line}</button>
            {:else}<span class="badge hide-m">native</span>{/if}
          </div>
        {:else}
          <div class="faint small empty">No tasks</div>
        {/each}
      {/if}
    </section>
  {/each}
</div>

<style>
  .list { display: flex; flex-direction: column; gap: 12px; }
  .grp { padding: 4px; }
  .gh { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: transparent; padding: 8px 10px; cursor: pointer; font-size: 13px; text-align: left; }
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  .row-t { display: flex; align-items: center; gap: 9px; padding: 7px 10px; border-radius: 8px; cursor: pointer; font-size: 13px; outline: none; }
  .row-t:hover, .row-t:focus-visible { background: var(--panel-hover); }
  .chk { width: 16px; height: 16px; border-radius: 5px; border: 1.5px solid var(--border-strong); background: transparent; display: grid; place-items: center; color: white; cursor: pointer; flex-shrink: 0; padding: 0; }
  .chk.on { background: var(--ok); border-color: var(--ok); }
  .tt.done { color: var(--text-3); text-decoration: line-through; }
  .lab { font-size: 10.5px; padding: 1px 7px; border-radius: 99px; background: var(--accent-soft); color: var(--accent); font-weight: 550; }
  .due { padding: 1px 6px; border-radius: 6px; background: var(--panel-active); color: var(--text-2); }
  .due.over { background: var(--err-soft); color: var(--err); }
  .small { font-size: 11.5px; }
  .src { border: 0; background: transparent; color: var(--text-3); font-size: 11px; cursor: pointer; padding: 0; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .src:hover { color: var(--accent); }
  .empty { padding: 6px 12px 10px 36px; }
  @media (max-width: 720px) { .hide-m { display: none; } }
</style>
