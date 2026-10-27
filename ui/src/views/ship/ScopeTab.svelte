<script>
  // Scope tracker: every board task with acceptance criteria, their status and evidence.
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import Empty from '../../lib/Empty.svelte';
  import CriteriaBar from './CriteriaBar.svelte';
  import CriteriaList from './CriteriaList.svelte';

  let { onchange } = $props();
  const res = resource(() => api('/api/ship/scope'));
  const d = $derived(res.data);
  let filter = $state('open');
  const tasks = $derived((d?.tasks || []).filter((t) => filter === 'all' || (filter === 'open' ? t.status !== 'done' : t.criteria.some((c) => c.status !== 'verified'))));
  const reload = () => { res.reload(); onchange?.(); };
</script>

{#if res.error && !d}
  <div class="card"><Empty icon="alert" title="Could not load the scope">{res.error.message}</Empty></div>
{:else if !d}
  <div class="card card-b" aria-busy="true"><div class="skel-rows"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div></div>
{:else if !d.tasks.length}
  <div class="card"><Empty icon="target" title="No acceptance criteria yet">
    Give a task sub-items (<code>- [ ] Logout clears the session</code> under a markdown task, or its checklist on the board) or a <code>Criteria:</code> list in its description. Each criterion is matched to test results, commits that mention the task id and the files it names.
    <br /><a href="#/tasks">Open the board →</a>
  </Empty></div>
{:else}
  <div class="col" style="gap:14px">
    <section class="card card-b top">
      <CriteriaBar summary={d.totals} />
      <div class="row" role="group" aria-label="Filter tasks" style="gap:6px;flex-wrap:wrap">
        <button class="chip" class:on={filter === 'open'} onclick={() => (filter = 'open')}>Open tasks</button>
        <button class="chip" class:on={filter === 'gaps'} onclick={() => (filter = 'gaps')}>Not verified</button>
        <button class="chip" class:on={filter === 'all'} onclick={() => (filter = 'all')}>All <span class="n">{d.tasks.length}</span></button>
      </div>
      {#if !d.override?.enabled}<p class="faint xs">Manual status overrides need the admin role.</p>{/if}
    </section>
    <section class="card card-b list">
      {#if tasks.length}
        <CriteriaList {tasks} override={d.override} onchange={reload} />
      {:else}
        <p class="faint xs">No tasks match this filter.</p>
      {/if}
    </section>
  </div>
{/if}

<style>
  .top { display: flex; flex-direction: column; gap: 12px; padding-top: 16px; }
  .list { padding-top: 16px; }
  .xs { font-size: 12px; margin: 0; }
  code { font-family: var(--mono); font-size: 0.92em; }
</style>
