<script>
  import Icon from '../Icon.svelte';
  import { PRIO, fmtDue, isOverdue, statusColor } from './util.js';
  import { openFile } from '../store.svelte.js';

  let { tasks = [], columns = [], onopen } = $props();
  let key = $state('due');
  let dir = $state(1);
  const COLS = [
    ['title', 'Title'], ['status', 'Status'], ['priority', 'Priority'], ['labels', 'Labels'],
    ['due', 'Due'], ['assignee', 'Assignee'], ['source', 'Source'],
  ];
  const colTitle = (id) => columns.find((c) => c.id === id)?.title || id;
  const colIdx = (id) => columns.findIndex((c) => c.id === id);
  function val(t, k) {
    switch (k) {
      case 'title': return t.title.toLowerCase();
      case 'status': return colIdx(t.status);
      case 'priority': return PRIO[t.priority]?.rank ?? 0;
      case 'labels': return (t.labels || []).join(',').toLowerCase();
      case 'due': return t.due || null;
      case 'assignee': return (t.assignee || '').toLowerCase() || null;
      case 'source': return t.source === 'md' ? t.path + ':' + String(t.line).padStart(6, '0') : 'native';
    }
  }
  const sorted = $derived(
    [...tasks].sort((a, b) => {
      const x = val(a, key), y = val(b, key);
      if (x == null && y == null) return 0;
      if (x == null) return 1; // empties always last
      if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * dir * (key === 'priority' ? -1 : 1);
    })
  );
  function sort(k) {
    if (key === k) dir = -dir;
    else { key = k; dir = 1; }
  }
</script>

<div class="card wrap">
  <table>
    <thead>
      <tr>
        {#each COLS as [k, label] (k)}
          <th aria-sort={key === k ? (dir > 0 ? 'ascending' : 'descending') : 'none'}>
            <button onclick={() => sort(k)}>{label}{#if key === k}<Icon name={dir > 0 ? 'chevronUp' : 'chevronDown'} size={11} />{/if}</button>
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each sorted as t (t.id)}
        <tr tabindex="0" onclick={() => onopen(t.id)} onkeydown={(e) => e.key === 'Enter' && onopen(t.id)}>
          <td class="tt">{t.title}</td>
          <td><span class="st"><span class="dot" style="background:{statusColor(t.status)}"></span>{colTitle(t.status)}</span></td>
          <td>{#if t.priority && t.priority !== 'none'}<span class="pr" style="color:{PRIO[t.priority].color}"><Icon name="flag" size={11} />{PRIO[t.priority].label}</span>{:else}<span class="faint">—</span>{/if}</td>
          <td>{#each t.labels || [] as l (l)}<span class="lab">{l}</span>{:else}<span class="faint">—</span>{/each}</td>
          <td class="tnum" class:over={isOverdue(t)}>{t.due ? fmtDue(t.due) : '—'}</td>
          <td>{t.assignee || '—'}</td>
          <td>
            {#if t.source === 'md'}
              <button class="src mono" onclick={(e) => (e.stopPropagation(), openFile(t.path, { line: t.line }))}>{t.path}:{t.line}</button>
            {:else}<span class="badge">native</span>{/if}
          </td>
        </tr>
      {:else}
        <tr><td colspan="7" class="faint" style="padding:20px;text-align:center">No tasks match.</td></tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .wrap { overflow-x: auto; padding: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 760px; }
  th { text-align: left; padding: 0; border-bottom: 1px solid var(--border); }
  th button { display: inline-flex; align-items: center; gap: 4px; width: 100%; border: 0; background: transparent; padding: 10px 12px; font-size: 11.5px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-3); cursor: pointer; }
  th button:hover { color: var(--text); }
  td { padding: 9px 12px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  tbody tr { cursor: pointer; outline: none; }
  tbody tr:hover, tbody tr:focus-visible { background: var(--panel-hover); }
  tbody tr:last-child td { border-bottom: 0; }
  .tt { font-weight: 550; max-width: 340px; }
  .st, .pr { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
  .dot { width: 7px; height: 7px; border-radius: 50%; }
  .lab { font-size: 10.5px; padding: 1px 7px; border-radius: 99px; background: var(--accent-soft); color: var(--accent); font-weight: 550; margin-right: 4px; }
  .over { color: var(--err); font-weight: 600; }
  .src { border: 0; background: transparent; color: var(--text-3); font-size: 11.5px; cursor: pointer; padding: 0; }
  .src:hover { color: var(--accent); }
</style>
