<script>
  // Acceptance criteria grouped by task, with status, evidence and (admin) manual override.
  import Icon from '../../lib/Icon.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';
  import { runAction } from '../../lib/actions.js';
  import Evidence from './Evidence.svelte';
  import CriteriaBar from './CriteriaBar.svelte';
  import { CRIT } from './shared.js';

  let { tasks = [], override = null, onchange, evidenceLimit = 4, compact = false } = $props();
  let busy = $state(null);

  async function setStatus(task, c, status) {
    if (!status || busy) return;
    busy = c.id;
    try {
      await runAction('ship.criterion.set', { task: task.id, criterion: c.id, status }, { title: status === 'auto' ? 'Use the automatic status' : `Mark criterion ${status}`, description: c.text });
    } finally {
      busy = null;
      onchange?.();
    }
  }
</script>

<div class="tl">
  {#each tasks as t (t.id)}
    <article class="task">
      <header class="row th">
        <Icon name="checkSquare" size={14} />
        <EntityLink kind="task" id={t.id} label={t.title} class="tt" />
        {#if t.status}<span class="badge">{t.status}</span>{/if}
        <span class="spacer"></span>
        {#if !compact && t.summary}<span class="faint small tnum">{t.summary.verified}/{t.summary.criteria}</span>{/if}
      </header>
      {#if !compact && t.summary}<div class="bar"><CriteriaBar summary={t.summary} /></div>{/if}
      <ul class="crit">
        {#each t.criteria as c (c.id)}
          {@const m = CRIT[c.status] || CRIT.incomplete}
          <li class={m.tone}>
            <span class="st" title={c.auto === false ? `${m.label} (set by hand)` : m.label}><Icon name={m.icon} size={12} /></span>
            <div class="col grow cb">
              <div class="row ct">
                <span class="txt">{c.text}</span>
                <span class="badge {m.tone}">{m.label}{c.auto === false ? ' · manual' : ''}</span>
              </div>
              {#if c.evidence?.length}
                <div class="evs">
                  {#each c.evidence.slice(0, evidenceLimit) as e, i (i)}<Evidence {e} />{/each}
                  {#if c.evidence.length > evidenceLimit}<span class="faint small">+{c.evidence.length - evidenceLimit} more</span>{/if}
                </div>
              {:else if c.status !== 'verified'}
                <span class="faint small">{c.status === 'incomplete' ? 'Not done yet.' : 'No test, commit or file evidence found.'}</span>
              {/if}
            </div>
            {#if override?.enabled}
              <select class="input ov" aria-label="Set status of: {c.text}" disabled={busy === c.id} value="" onchange={(ev) => { const v = ev.currentTarget.value; ev.currentTarget.value = ''; setStatus(t, c, v); }}>
                <option value="" disabled>Set…</option>
                <option value="verified">verified</option>
                <option value="untested">untested</option>
                <option value="incomplete">incomplete</option>
                <option value="failed">failed</option>
                {#if c.auto === false}<option value="auto">automatic</option>{/if}
              </select>
            {/if}
          </li>
        {/each}
      </ul>
    </article>
  {/each}
</div>

<style>
  .tl { display: flex; flex-direction: column; gap: 14px; }
  .task { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .th { gap: 8px; color: var(--text-2); font-size: 13px; }
  .th :global(.tt) { font-weight: 600; color: var(--text); min-width: 0; }
  .bar { padding-left: 22px; }
  .crit { list-style: none; margin: 0; padding: 0 0 0 4px; display: flex; flex-direction: column; gap: 4px; }
  li { display: flex; gap: 9px; align-items: flex-start; padding: 7px 8px; border-radius: var(--radius-sm); min-width: 0; }
  li:hover { background: var(--panel-hover); }
  .st { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; flex-shrink: 0; background: var(--panel-active); color: var(--text-3); margin-top: 1px; }
  li.ok .st { background: var(--ok-soft); color: var(--ok); }
  li.err .st { background: var(--err-soft); color: var(--err); }
  li.warn .st { background: var(--warn-soft); color: var(--warn); }
  .cb { gap: 5px; }
  .ct { gap: 8px; flex-wrap: wrap; align-items: baseline; }
  .txt { font-size: 13px; overflow-wrap: anywhere; min-width: 0; }
  .evs { display: flex; flex-wrap: wrap; gap: 5px; }
  .small { font-size: 12px; }
  .ov { height: 26px; font-size: 12px; width: 84px; flex-shrink: 0; }
  @media (max-width: 480px) { li { flex-wrap: wrap; } .ov { margin-left: 29px; } }
</style>
