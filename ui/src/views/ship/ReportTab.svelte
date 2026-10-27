<script>
  // Completion report: verdict hero, changed files, checks with Run, criteria progress, failures.
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { navigate } from '../../lib/store.svelte.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';
  import VerdictHero from './VerdictHero.svelte';
  import ChecksCard from './ChecksCard.svelte';
  import CriteriaBar from './CriteriaBar.svelte';
  import CriteriaList from './CriteriaList.svelte';
  import { STATUS_LABEL, groupBy, plural } from './shared.js';

  let { params = {}, summary = null, onchange } = $props();
  const base = $derived(params.base || 'HEAD');
  const res = resource((b) => api('/api/ship/report', { base: b }), { key: () => base });
  const r = $derived(res.data);
  let baseInput = $state('');
  $effect(() => { baseInput = base === 'HEAD' ? '' : base; });
  let showAll = $state(false);

  const files = $derived(r?.changedFiles || []);
  const maxLines = $derived(Math.max(1, ...files.map((f) => (f.added || 0) + (f.removed || 0))));
  const tasks = $derived(r ? groupBy(r.criteria || [], (c) => c.task.id).map(([id, cs]) => {
    const s = { criteria: cs.length, verified: 0, incomplete: 0, untested: 0, failed: 0 };
    for (const c of cs) s[c.status]++;
    return { id, title: cs[0].task.title, status: cs[0].task.status, criteria: cs, summary: s };
  }) : []);

  function applyBase(e) {
    e.preventDefault();
    navigate('ship', { tab: 'report', base: baseInput.trim() || undefined });
  }
  const reload = () => { res.reload(); onchange?.(); };
</script>

{#if res.error && !r}
  <div class="card"><Empty icon="alert" title="Could not build the report">{res.error.message}</Empty></div>
{:else if !r}
  <div class="col" style="gap:14px" aria-busy="true">
    <div class="card skel" style="height:190px"></div>
    <div class="grid"><div class="card skel" style="height:220px"></div><div class="card skel" style="height:220px"></div></div>
  </div>
{:else}
  <div class="col wrap stagger">
    <VerdictHero report={r} {summary} />

    <form class="row basef" onsubmit={applyBase}>
      <label class="faint small" for="ship-base">Compare against</label>
      <input id="ship-base" class="input mono" placeholder="HEAD (uncommitted changes)" bind:value={baseInput} spellcheck="false" autocomplete="off" />
      <button class="btn sm" type="submit">Apply</button>
      {#if base !== 'HEAD'}<button class="btn sm ghost" type="button" onclick={() => navigate('ship', { tab: 'report' })}>Reset</button>{/if}
      {#if r.git?.error}<span class="badge warn">{r.git.error}</span>{/if}
    </form>

    <div class="grid">
      <section class="card" aria-labelledby="ship-files">
        <div class="card-h" id="ship-files"><Icon name="diff" size={14} /> Changed files <span class="sub">{base === 'HEAD' ? 'vs HEAD' : `since ${base}`}</span><span class="spacer"></span>
          {#if files.length}<span class="tnum small"><span class="add">+{r.totals.added}</span> <span class="del">−{r.totals.removed}</span></span>{/if}
        </div>
        <div class="card-b">
          {#if !r.git?.available}
            <p class="faint small">Not a git repository, so changed files cannot be listed.</p>
          {:else if !files.length}
            <p class="faint small">No changes {base === 'HEAD' ? 'in the working tree' : `since ${base}`}.</p>
          {:else}
            <ul class="files">
              {#each (showAll ? files : files.slice(0, 12)) as f (f.path)}
                <li>
                  <span class="st s{f.status === '?' ? 'n' : f.status}" title={STATUS_LABEL[f.status] || f.status}>{f.status === '?' ? 'N' : f.status}</span>
                  <EntityLink kind="file" id={f.path} label={f.path} mono class="fp" />
                  <span class="nums tnum"><span class="add">+{f.added}</span> <span class="del">−{f.removed}</span></span>
                  <span class="spark" aria-hidden="true"><i class="a" style="width:{(f.added / maxLines) * 100}%"></i><i class="d" style="width:{(f.removed / maxLines) * 100}%"></i></span>
                </li>
              {/each}
            </ul>
            {#if files.length > 12}<button class="btn sm ghost more" onclick={() => (showAll = !showAll)}>{showAll ? 'Show fewer' : `Show all ${files.length}`}</button>{/if}
          {/if}
        </div>
      </section>

      <ChecksCard checks={r.checks} run={r.run} onran={reload} />
    </div>

    <section class="card" aria-labelledby="ship-crit">
      <div class="card-h" id="ship-crit"><Icon name="target" size={14} /> Acceptance criteria <span class="sub">open and recently finished tasks</span><span class="spacer"></span>
        <a class="small" href="#/ship?tab=scope">All tasks →</a>
      </div>
      <div class="card-b col" style="gap:14px">
        {#if !r.criteria.length}
          <p class="faint small">No criteria yet. Add sub-items to a task (<code>- [ ] Logout clears the session</code> under a markdown task, or the task's checklist on the board), or a <code>Criteria:</code> list in its description. Each criterion is then matched to tests, commits and files.</p>
        {:else}
          <CriteriaBar summary={r.criteriaSummary} />
          <CriteriaList {tasks} override={r.override} onchange={reload} compact evidenceLimit={3} />
        {/if}
      </div>
    </section>

    {#if r.failures.length}
      <section class="card" aria-labelledby="ship-fail">
        <div class="card-h" id="ship-fail"><Icon name="error" size={14} /> Failures <span class="sub">{plural(r.failures.length, 'failure')} in the last runs</span></div>
        <div class="card-b">
          <ul class="fails">
            {#each r.failures as f, i (i)}
              <li>
                <div class="row" style="gap:8px;flex-wrap:wrap">
                  <b class="fn">{f.name}</b>
                  <span class="badge">{f.check}</span>
                  {#if f.file}<EntityLink kind="file" id={f.file} label="{f.file}{f.line ? `:${f.line}` : ''}" mono class="loc" />{/if}
                </div>
                {#if f.message}<pre class="msg">{f.message}</pre>{/if}
                <a class="small" href="#/ship?tab=runs&run={f.run}">Open run</a>
              </li>
            {/each}
          </ul>
        </div>
      </section>
    {/if}
  </div>
{/if}

<style>
  .wrap { gap: 14px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr)); gap: 14px; align-items: start; }
  .basef { gap: 8px; flex-wrap: wrap; }
  .basef .input { height: 30px; width: 260px; max-width: 100%; flex: 1 1 160px; font-size: 12.5px; }
  .small { font-size: 12px; }
  .add { color: var(--ok); }
  .del { color: var(--err); }
  .files { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .files li { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto 60px; gap: 8px; align-items: center; padding: 5px 4px; border-radius: 6px; font-size: 12.5px; }
  .files li:hover { background: var(--panel-hover); }
  .files :global(.fp) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
  .st { font: 600 10px/18px var(--mono); text-align: center; border-radius: 5px; background: var(--panel-active); color: var(--text-2); }
  .st.sM { color: var(--warn); background: var(--warn-soft); }
  .st.sA, .st.sn { color: var(--ok); background: var(--ok-soft); }
  .st.sD { color: var(--err); background: var(--err-soft); }
  .nums { font-size: 11.5px; white-space: nowrap; }
  .spark { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: var(--panel-active); }
  .spark i { display: block; height: 100%; }
  .spark .a { background: var(--ok); }
  .spark .d { background: var(--err); }
  .more { margin-top: 6px; }
  .fails { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .fails li { display: flex; flex-direction: column; gap: 5px; padding: 10px; border-radius: var(--radius-sm); background: var(--err-soft); border: 1px solid color-mix(in srgb, var(--err) 25%, transparent); min-width: 0; }
  .fn { font-size: 13px; overflow-wrap: anywhere; }
  .msg { margin: 0; font: 12px/1.45 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-2); }
  code { font-family: var(--mono); font-size: 0.92em; }
  @media (max-width: 480px) { .files li { grid-template-columns: 22px minmax(0, 1fr) auto; } .spark { display: none; } .card-h .sub { display: none; } }
</style>
