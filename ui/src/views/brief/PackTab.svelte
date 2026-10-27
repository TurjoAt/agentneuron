<script>
  // Context pack: task text (or a board task id) + token budget -> ranked files, tests, rules and facts.
  import { untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { navigate, toast } from '../../lib/store.svelte.js';
  import { fmtNum } from '../../lib/format.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';
  import TokenBar from '../../lib/TokenBar.svelte';
  import { copyText } from '../usage/shared.js';

  let { params = {} } = $props();
  let task = $state(untrack(() => params.task || ''));
  let budget = $state(untrack(() => Math.max(500, Math.min(64000, Number(params.budget) || 8000))));
  const submitted = $derived(params.task || '');
  const usedBudget = $derived(Math.max(500, Math.min(64000, Number(params.budget) || 8000)));
  const res = resource(([t, b]) => api('/api/brief/pack', { task: t, budget: b }), { key: () => [submitted, usedBudget], live: false, enabled: () => !!submitted });
  const pack = $derived(submitted ? res.data : undefined);
  const items = $derived(pack?.items || []);
  const maxTok = $derived(Math.max(1, ...items.map((i) => i.tokens || 0)));
  const KIND = { file: ['file', 'File'], test: ['check', 'Test'], rule: ['shield', 'Rule'], fact: ['info', 'Fact'] };

  function build(e) {
    e?.preventDefault();
    const t = task.trim();
    if (!t) return;
    navigate('brief', { tab: 'pack', task: t, budget: budget === 8000 ? undefined : budget });
  }
  let budgetTimer;
  function onBudget() {
    clearTimeout(budgetTimer);
    if (submitted) budgetTimer = setTimeout(() => navigate('brief', { tab: 'pack', task: submitted, budget: budget === 8000 ? undefined : budget }), 350);
  }
  async function copyMd() {
    if (!pack?.markdown) return;
    toast((await copyText(pack.markdown)) ? 'Context pack copied as Markdown' : 'Could not copy to the clipboard', 'info', 2600);
  }
</script>

<section class="card" aria-label="Build a context pack">
  <form class="card-b form" onsubmit={build}>
    <label class="fl grow"><span>Task <em class="muted">(description or board task id)</em></span>
      <input class="input" placeholder="e.g. add retries to the webhook handler" bind:value={task} /></label>
    <label class="fl budget"><span>Budget <strong>{fmtNum(budget)}</strong> tokens</span>
      <input type="range" min="500" max="64000" step="500" bind:value={budget} oninput={onBudget} aria-label="Token budget" /></label>
    <button class="btn primary" type="submit" disabled={!task.trim()}><Icon name="layers" size={13} />Build pack</button>
  </form>
</section>

{#if !submitted}
  <div class="card"><Empty icon="layers" title="Describe a task">AgentNeuron ranks the files, tests, rule sections and repo facts most relevant to it (keyword and path match, imports, files edited together, verified facts) and fits them into the budget. Deterministic, no model.</Empty></div>
{:else if res.error && !pack}
  <div class="card"><Empty icon="alert" title="Could not build the pack">{res.error.message}</Empty></div>
{:else if pack === undefined}
  <div class="card card-b sk" aria-busy="true"><div class="skel-rows"><div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div></div></div>
{:else}
  <section class="card" aria-busy={res.loading}>
    <div class="ph">
      <div class="pt">
        <div class="kicker">{pack.task?.id ? `Task ${pack.task.id}` : 'Task'}</div>
        <div class="ptxt">{pack.task?.text}</div>
      </div>
      <button class="btn sm" onclick={copyMd} disabled={!pack.markdown}><Icon name="copy" size={13} />Copy Markdown</button>
    </div>
    <div class="usage">
      <TokenBar value={pack.tokens} max={pack.budget} tool="claude" height={8} />
      <div class="ul"><span><strong>{fmtNum(pack.tokens)}</strong> of {fmtNum(pack.budget)} tokens</span><span class="muted">{items.length} item{items.length === 1 ? '' : 's'}{#if pack.skipped?.length} · {pack.skipped.length} did not fit{/if}</span></div>
    </div>
    {#if !items.length}
      <Empty compact icon="search" title="Nothing matched">Use words that appear in file names or code (module, feature or function names), or a board task id.</Empty>
    {:else}
      <ol class="items">
        {#each items as it, i (it.kind + it.path + (it.heading || '') + i)}
          <li>
            <span class="rank">{i + 1}</span>
            <span class="kind {it.kind}" title={KIND[it.kind]?.[1]}><Icon name={KIND[it.kind]?.[0] || 'dot'} size={12} /></span>
            <div class="body">
              <div class="what">
                {#if it.kind === 'fact'}<span>{it.text}</span>
                {:else if it.path}<EntityLink kind="file" id={String(it.path).replace(/:\d+$/, '')} label={it.path} mono />{#if it.heading}<span class="muted"> § {it.heading}</span>{/if}{/if}
              </div>
              <div class="why muted">{it.reason}{#if it.score != null} · score {it.score}{/if}</div>
              {#if it.kind === 'rule' && it.text}<details class="rtext"><summary>Section text</summary><pre>{it.text}</pre></details>{/if}
            </div>
            <div class="tok"><span title={it.partial ? `~${fmtNum(it.fullTokens)} tokens in full; budgeted for the relevant part` : undefined}>{fmtNum(it.tokens)}{it.partial ? " (part)" : ""}</span><TokenBar value={it.tokens} max={maxTok} height={4} /></div>
          </li>
        {/each}
      </ol>
    {/if}
    {#if pack.skipped?.length}
      <details class="skipped"><summary>{pack.skipped.length} candidate{pack.skipped.length === 1 ? '' : 's'} left out</summary>
        <ul>{#each pack.skipped as s, i (i)}<li><span class="mono">{s.path}</span> <span class="muted">~{fmtNum(s.tokens)} tokens · {s.reason}</span></li>{/each}</ul>
      </details>
    {/if}
  </section>
{/if}

<style>
  .form { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; padding-top: 14px; }
  .fl { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 550; color: var(--text-2); min-width: 0; }
  .fl em { font-style: normal; font-weight: 400; }
  .grow { flex: 1 1 280px; }
  .grow .input { width: 100%; }
  .budget { flex: 0 1 240px; }
  .budget input { width: 100%; accent-color: var(--accent); }
  .card { margin-bottom: 14px; }
  .sk { padding-top: 16px; }
  .ph { display: flex; justify-content: space-between; gap: 10px; padding: 14px 16px 6px; flex-wrap: wrap; }
  .pt { min-width: 0; flex: 1 1 240px; }
  .kicker { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); }
  .ptxt { font-weight: 600; overflow-wrap: anywhere; }
  .usage { padding: 4px 16px 10px; }
  .ul { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; font-size: 12px; margin-top: 6px; }
  .items { list-style: none; margin: 0; padding: 0 8px 10px; }
  .items li { display: grid; grid-template-columns: 22px 24px minmax(0, 1fr) 72px; gap: 8px; align-items: start; padding: 8px; border-top: 1px solid var(--border); }
  @media (max-width: 480px) { .items li { grid-template-columns: 20px 22px minmax(0, 1fr); } .tok { grid-column: 3; } }
  .rank { color: var(--text-3); font-variant-numeric: tabular-nums; font-size: 12px; padding-top: 3px; text-align: right; }
  .kind { width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; background: var(--panel-active); color: var(--text-2); }
  .kind.file { background: var(--accent-soft); color: var(--accent); }
  .kind.test { background: var(--ok-soft); color: var(--ok); }
  .kind.rule { background: var(--warn-soft); color: var(--warn); }
  .kind.fact { background: var(--info-soft); color: var(--info); }
  .body { min-width: 0; }
  .what { font-size: 13px; overflow-wrap: anywhere; }
  .why { font-size: 12px; overflow-wrap: anywhere; }
  .tok { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; text-align: right; }
  .rtext summary { font-size: 12px; cursor: pointer; color: var(--text-2); }
  .rtext pre { margin: 6px 0 0; padding: 8px; background: var(--inset); border-radius: var(--radius-xs); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .skipped { padding: 0 16px 14px; font-size: 12px; }
  .skipped summary { cursor: pointer; color: var(--text-2); }
  .skipped ul { margin: 6px 0 0; padding-left: 18px; }
  .skipped li { overflow-wrap: anywhere; }
</style>
