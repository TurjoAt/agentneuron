<script>
  import Icon from '../Icon.svelte';
  import { addDays, dayKey, isOverdue, statusColor, todayKey } from './util.js';

  let { tasks = [], canMutate = true, onopen, oncreate } = $props();
  let cursor = $state(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const title = $derived(cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
  const days = $derived.by(() => {
    const first = cursor;
    const lead = (first.getDay() + 6) % 7; // Monday first
    const start = addDays(first, -lead);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const n = Math.ceil((lead + last.getDate()) / 7) * 7;
    return Array.from({ length: n }, (_, i) => addDays(start, i));
  });
  const byDay = $derived.by(() => {
    const m = new Map();
    for (const t of tasks) if (t.due) (m.get(t.due) || m.set(t.due, []).get(t.due)).push(t);
    return m;
  });
  const undated = $derived(tasks.filter((t) => !t.due && t.status !== 'done').length);
  const today = todayKey();
  const shift = (n) => (cursor = new Date(cursor.getFullYear(), cursor.getMonth() + n, 1));
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
</script>

<div class="bar">
  <button class="btn icon sm" onclick={() => shift(-1)} aria-label="Previous month"><Icon name="chevronLeft" size={14} /></button>
  <h3>{title}</h3>
  <button class="btn icon sm" onclick={() => shift(1)} aria-label="Next month"><Icon name="chevron" size={14} /></button>
  <button class="btn sm" onclick={() => (cursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</button>
  <span class="spacer"></span>
  {#if undated}<span class="faint small">{undated} open without due date</span>{/if}
</div>
<div class="scroll">
  <div class="cal card">
    {#each WD as w (w)}<div class="wd">{w}</div>{/each}
    {#each days as d (d.getTime())}
      {@const k = dayKey(d)}
      {@const list = byDay.get(k) || []}
      <div class="day" class:out={d.getMonth() !== cursor.getMonth()} class:today={k === today}>
        <div class="dh">
          <span class="dn tnum">{d.getDate()}</span>
          {#if canMutate}<button class="add" title="New task due {k}" aria-label="New task due {k}" onclick={() => oncreate?.(k)}><Icon name="plus" size={11} /></button>{/if}
        </div>
        {#each list.slice(0, 4) as t (t.id)}
          <button class="ev" class:over={isOverdue(t)} class:done={t.status === 'done'} style="--c:{statusColor(t.status)}" onclick={() => onopen(t.id)} title={t.title}>
            <span class="ellipsis">{t.title}</span>
          </button>
        {/each}
        {#if list.length > 4}<span class="more faint">+{list.length - 4} more</span>{/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .bar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
  h3 { margin: 0 6px; font-size: 15px; font-weight: 650; min-width: 140px; text-align: center; }
  .small { font-size: 12px; }
  .scroll { overflow-x: auto; }
  .cal { display: grid; grid-template-columns: repeat(7, minmax(104px, 1fr)); padding: 0; overflow: hidden; min-width: 740px; }
  .wd { padding: 8px 10px; font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-3); border-bottom: 1px solid var(--border); }
  .day { min-height: 104px; padding: 4px 5px 6px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .day:nth-child(7n + 7) { border-right: 0; }
  .day.out { background: var(--inset); }
  .day.out .dn { opacity: 0.4; }
  .dh { display: flex; align-items: center; justify-content: space-between; height: 22px; }
  .dn { font-size: 12px; color: var(--text-2); padding: 1px 6px; border-radius: 99px; }
  .today .dn { background: var(--accent); color: white; font-weight: 700; }
  .add { opacity: 0; border: 0; background: transparent; color: var(--text-3); cursor: pointer; width: 20px; height: 20px; border-radius: 6px; display: grid; place-items: center; }
  .day:hover .add, .add:focus-visible { opacity: 1; }
  .add:hover { background: var(--panel-active); color: var(--text); }
  .ev { display: flex; border: 0; border-left: 3px solid var(--c); background: var(--panel-active); border-radius: 5px; padding: 3px 6px; font-size: 11.5px; text-align: left; cursor: pointer; min-width: 0; color: var(--text); }
  .ev:hover { background: var(--panel-hover); outline: 1px solid var(--border-strong); }
  .ev.over { background: var(--err-soft); color: var(--err); }
  .ev.done { opacity: 0.55; text-decoration: line-through; }
  .more { font-size: 11px; padding-left: 4px; }
</style>
