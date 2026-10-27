<script>
  // Findings grouped by category (or rule), each with why / fix and a file:line link.
  import Icon from '../../lib/Icon.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';
  import { SEV, groupBy } from './shared.js';

  let { findings = [], groupKey = 'category', labels = {}, emptyText = 'Nothing found.' } = $props();
  let sev = $state('all');
  let open = $state({});
  const shown = $derived(sev === 'all' ? findings : findings.filter((f) => f.severity === sev));
  const counts = $derived({ high: findings.filter((f) => f.severity === 'high').length, medium: findings.filter((f) => f.severity === 'medium').length, low: findings.filter((f) => f.severity === 'low').length });
  const RANK = { high: 0, medium: 1, low: 2 };
  const groups = $derived(groupBy(shown, groupKey).map(([k, list]) => ({ k, list, top: Math.min(...list.map((f) => RANK[f.severity])) })).sort((a, b) => a.top - b.top || b.list.length - a.list.length));
  const LIMIT = 8;
</script>

<div class="row filters" role="group" aria-label="Filter by severity">
  <button class="chip" class:on={sev === 'all'} onclick={() => (sev = 'all')}>All <span class="n">{findings.length}</span></button>
  {#each ['high', 'medium', 'low'] as k (k)}
    {#if counts[k]}<button class="chip" class:on={sev === k} onclick={() => (sev = k)}><span class="dot {SEV[k].tone}"></span>{k} <span class="n">{counts[k]}</span></button>{/if}
  {/each}
</div>

{#if !shown.length}
  <p class="faint small none">{emptyText}</p>
{:else}
  <div class="groups">
    {#each groups as g (g.k)}
      <section class="card grp" aria-label={labels[g.k] || g.k}>
        <div class="card-h">
          <span class="dot {SEV[['high', 'medium', 'low'][g.top]].tone}"></span>
          {labels[g.k] || g.k}
          <span class="sub">{g.list.length}</span>
        </div>
        <ul class="fl">
          {#each (open[g.k] ? g.list : g.list.slice(0, LIMIT)) as f (f.id)}
            <li class={SEV[f.severity].tone}>
              <span class="si"><Icon name={SEV[f.severity].icon} size={13} /></span>
              <div class="col fb">
                <div class="row ft">
                  <b>{f.title}</b>
                  <span class="badge {SEV[f.severity].tone}">{f.severity}</span>
                </div>
                {#if f.location?.path}<EntityLink kind="file" id={f.location.path} label="{f.location.path}{f.location.line ? `:${f.location.line}` : ''}" mono class="loc" />{/if}
                <p class="why">{f.why}</p>
                <p class="fix"><Icon name="wand" size={12} /> {f.fix}</p>
              </div>
            </li>
          {/each}
        </ul>
        {#if g.list.length > LIMIT}
          <button class="btn sm ghost more" onclick={() => (open = { ...open, [g.k]: !open[g.k] })}>{open[g.k] ? 'Show fewer' : `Show all ${g.list.length}`}</button>
        {/if}
      </section>
    {/each}
  </div>
{/if}

<style>
  .filters { gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-3); display: inline-block; flex-shrink: 0; }
  .dot.err { background: var(--err); }
  .dot.warn { background: var(--warn); }
  .dot.info { background: var(--info); }
  .groups { display: flex; flex-direction: column; gap: 12px; }
  .grp { padding-bottom: 8px; }
  .fl { list-style: none; margin: 0; padding: 0 10px; display: flex; flex-direction: column; gap: 2px; }
  .fl li { display: flex; gap: 10px; padding: 9px 6px; border-top: 1px solid var(--border); min-width: 0; }
  .fl li:first-child { border-top: 0; }
  .si { width: 22px; height: 22px; border-radius: 7px; display: grid; place-items: center; flex-shrink: 0; background: var(--panel-active); color: var(--text-2); }
  li.err .si { background: var(--err-soft); color: var(--err); }
  li.warn .si { background: var(--warn-soft); color: var(--warn); }
  li.info .si { background: var(--info-soft); color: var(--info); }
  .fb { gap: 3px; flex: 1; }
  .ft { gap: 8px; flex-wrap: wrap; font-size: 13px; }
  .ft b { overflow-wrap: anywhere; min-width: 0; }
  .fb :global(.loc) { font-size: 11.5px; color: var(--text-2); align-self: flex-start; }
  .why { margin: 0; font-size: 12.5px; color: var(--text-2); }
  .fix { margin: 0; font-size: 12.5px; color: var(--text); display: flex; gap: 6px; align-items: baseline; }
  .fix :global(svg) { flex-shrink: 0; color: var(--accent); position: relative; top: 1px; }
  .more { margin: 4px 0 0 10px; }
  .none { margin: 8px 2px; font-size: 13px; }
</style>
