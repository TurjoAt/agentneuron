<script>
  import Icon from '../Icon.svelte';
  import Card from './Card.svelte';
  import { byOrder, laneOf, orderBetween, statusColor, PRIO } from './util.js';

  let { tasks = [], allTasks = [], columns = [], swimlane = 'none', canMutate = true, reason = '', onmove, onadd, onopen } = $props();

  let dragId = $state(null);
  let drop = $state(null); // { status, lane, index }
  let adding = $state(null);
  let newTitle = $state('');

  const lanes = $derived.by(() => {
    if (swimlane === 'none') return [{ key: '', label: '' }];
    const seen = new Map();
    for (const t of tasks) {
      const k = laneOf(t, swimlane);
      if (!seen.has(k)) seen.set(k, { key: k, label: swimlane === 'priority' ? PRIO[k]?.label || k : k });
    }
    const arr = [...seen.values()];
    if (swimlane === 'priority') arr.sort((a, b) => (PRIO[b.key]?.rank ?? 0) - (PRIO[a.key]?.rank ?? 0));
    else arr.sort((a, b) => a.label.localeCompare(b.label));
    return arr.length ? arr : [{ key: '', label: '' }];
  });

  const cells = $derived.by(() => {
    const m = new Map();
    for (const t of tasks) {
      const k = laneOf(t, swimlane) + '\u0000' + t.status;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(t);
    }
    for (const l of m.values()) l.sort(byOrder);
    return m;
  });
  const cell = (lane, status) => cells.get(lane + '\u0000' + status) || [];
  const count = (status) => allTasks.filter((t) => t.status === status).length;

  function start(e, t) {
    if (!canMutate) return e.preventDefault();
    dragId = t.id;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', t.id); } catch {}
  }
  function end() {
    dragId = null;
    drop = null;
  }
  function over(e, status, lane) {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const cards = [...e.currentTarget.querySelectorAll('.tcard')].filter((c) => c.dataset.id !== dragId);
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { index = i; break; }
    }
    if (!drop || drop.status !== status || drop.lane !== lane || drop.index !== index) drop = { status, lane, index };
  }
  function doDrop(e, status, lane) {
    if (!dragId) return;
    e.preventDefault();
    const id = dragId;
    const d = drop && drop.status === status && drop.lane === lane ? drop : { index: Infinity };
    const list = cell(lane, status).filter((t) => t.id !== id);
    const i = Math.min(d.index, list.length);
    const order = orderBetween(list[i - 1]?.order, list[i]?.order);
    end();
    onmove?.(id, status, order);
  }
  function leave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) drop = null;
  }

  async function submitAdd(status) {
    const t = newTitle.trim();
    if (!t) return (adding = null);
    newTitle = '';
    await onadd?.(status, t);
  }
</script>

<div class="scroller">
  <div class="grid" style="--n:{columns.length}">
    {#each columns as col (col.id)}
      {@const c = count(col.id)}
      {@const wipOver = col.wip && c > col.wip}
      <div class="ch" class:wipOver>
        <span class="dot" style="background:{statusColor(col.id)}"></span>
        <span class="ct">{col.title}</span>
        <span class="cn tnum" title={col.wip ? `WIP limit ${col.wip}` : ''}>{c}{#if col.wip}<span class="lim"> / {col.wip}</span>{/if}</span>
        {#if wipOver}<span class="badge err" title="WIP limit exceeded">WIP</span>{/if}
        <span class="spacer"></span>
        <button class="btn icon ghost sm" title={canMutate ? 'Quick add' : reason} aria-label="Add card to {col.title}" disabled={!canMutate} onclick={() => { adding = adding === col.id ? null : col.id; newTitle = ''; }}>
          <Icon name="plus" size={14} />
        </button>
      </div>
    {/each}

    {#each lanes as lane (lane.key)}
      {#if swimlane !== 'none'}
        <div class="lh"><Icon name={swimlane === 'file' ? 'file' : swimlane === 'assignee' ? 'user' : swimlane === 'priority' ? 'flag' : 'tag'} size={12} />{lane.label}
          <span class="faint tnum">{tasks.filter((t) => laneOf(t, swimlane) === lane.key).length}</span></div>
      {/if}
      {#each columns as col (col.id)}
        {@const list = cell(lane.key, col.id)}
        {@const nd = list.filter((t) => t.id !== dragId)}
        {@const here = drop && drop.status === col.id && drop.lane === lane.key}
        <div class="cell" class:hot={here} role="list" ondragover={(e) => over(e, col.id, lane.key)} ondrop={(e) => doDrop(e, col.id, lane.key)} ondragleave={leave}>
          {#if adding === col.id && lane === lanes[0]}
            <form class="qa" onsubmit={(e) => (e.preventDefault(), submitAdd(col.id))}>
              <!-- svelte-ignore a11y_autofocus -->
              <input class="input" placeholder="Card title…" bind:value={newTitle} autofocus onkeydown={(e) => e.key === 'Escape' && (adding = null)} />
              <button class="btn primary sm" type="submit">Add</button>
            </form>
          {/if}
          {#each list as t (t.id)}
            {#if here && drop.index < nd.length && nd[drop.index].id === t.id}<div class="ind"></div>{/if}
            <Card task={t} draggable={canMutate} dragging={dragId === t.id} ondragstart={(e) => start(e, t)} ondragend={end} {onopen} />
          {/each}
          {#if here && drop.index >= nd.length}<div class="ind"></div>{/if}
          {#if !list.length && !here}<div class="none">{dragId ? 'Drop here' : ''}</div>{/if}
        </div>
      {/each}
    {/each}
  </div>
</div>

<style>
  .scroller { overflow-x: auto; padding-bottom: 12px; margin: 0 -4px; padding: 0 4px 12px; }
  .grid { display: grid; grid-template-columns: repeat(var(--n), minmax(256px, 1fr)); gap: 10px 12px; min-width: min-content; align-items: start; }
  .ch { display: flex; align-items: center; gap: 7px; padding: 4px 6px 4px 10px; font-size: 12.5px; font-weight: 650; position: sticky; top: 0; z-index: 2; background: var(--bg); border-radius: 9px; height: 34px; }
  .ch.wipOver { box-shadow: inset 0 0 0 1px var(--err); background: color-mix(in srgb, var(--err) 8%, var(--bg)); }
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  .cn { color: var(--text-3); font-weight: 500; }
  .lim { opacity: 0.7; }
  .lh { grid-column: 1 / -1; display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 650; color: var(--text-2); padding: 8px 4px 0; border-top: 1px solid var(--border); margin-top: 4px; }
  .cell { display: flex; flex-direction: column; gap: 8px; min-height: 60px; padding: 8px; border-radius: 12px; background: var(--inset); border: 1px dashed transparent; transition: border-color 0.15s, background 0.15s; }
  .cell.hot { border-color: var(--accent); background: var(--accent-soft); }
  .ind { height: 3px; border-radius: 3px; background: var(--accent); margin: -3px 0; flex-shrink: 0; }
  .none { text-align: center; font-size: 12px; color: var(--accent); padding: 14px 0; }
  .qa { display: flex; gap: 6px; }
  .qa .input { flex: 1; height: 30px; }
</style>
