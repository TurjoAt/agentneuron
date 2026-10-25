<script>
  import { slide } from 'svelte/transition';
  import { api } from '../lib/api.js';
  import { app, openFile, navigate } from '../lib/store.svelte.js';
  import { resource } from '../lib/resource.svelte.js';
  import { SEVERITY } from '../lib/tools.js';
  import { dur } from '../lib/motion.js';
  import HealthRing from '../lib/HealthRing.svelte';
  import Counter from '../lib/Counter.svelte';
  import Icon from '../lib/Icon.svelte';
  import Empty from '../lib/Empty.svelte';

  let { params = {} } = $props();

  const health = resource(() => api('/api/health'));
  let q = $state('');
  let collapsed = $state(new Set());
  const sev = $derived(params.severity || '');

  const RULES = {
    'broken-link': { label: 'Broken links', icon: 'link', desc: 'Links and @imports pointing at files that do not exist.' },
    'missing-path': { label: 'Missing paths', icon: 'file', desc: 'Backticked paths mentioned in docs that no longer exist.' },
    secret: { label: 'Secrets', icon: 'key', desc: 'API keys, tokens or passwords pasted into context files.' },
    orphan: { label: 'Orphans', icon: 'target', desc: 'Files nothing links to.' },
    'large-context': { label: 'Large context', icon: 'layers', desc: 'Context files that eat the agent window.' },
    'duplicate-rule': { label: 'Duplicate rules', icon: 'copy', desc: 'Same rule repeated across tools — drift risk.' },
    'stale-plan': { label: 'Stale plans', icon: 'clock', desc: 'Plans / TODOs untouched for 30+ days.' },
    'empty-file': { label: 'Empty files', icon: 'file', desc: 'Tracked files with no content.' },
    'false-claim': { label: 'False claims', icon: 'flag', desc: 'Commands, versions or env vars in context files that do not match the repo (Truth & safety).' },
  };
  const SEV_ICON = { error: 'error', warn: 'alert', info: 'info' };

  const data = $derived(health.data);
  const issues = $derived(data?.issues || []);
  const visible = $derived(
    issues.filter(
      (i) =>
        (!sev || i.severity === sev) &&
        (!q || `${i.message} ${i.path} ${i.rule}`.toLowerCase().includes(q.toLowerCase()))
    )
  );
  const groups = $derived.by(() => {
    const m = new Map();
    for (const i of visible) {
      if (!m.has(i.rule)) m.set(i.rule, []);
      m.get(i.rule).push(i);
    }
    const rank = (list) => Math.min(...list.map((i) => SEVERITY[i.severity]?.rank ?? 3));
    return [...m.entries()]
      .map(([rule, list]) => ({ rule, list: list.sort((a, b) => (SEVERITY[a.severity]?.rank ?? 3) - (SEVERITY[b.severity]?.rank ?? 3)), rank: rank(list) }))
      .sort((a, b) => a.rank - b.rank || b.list.length - a.list.length);
  });
  const score = $derived(app.health?.score ?? data?.score ?? 0);
  const grade = $derived(app.health?.grade ?? data?.grade ?? '–');
  const counts = $derived(data?.counts || app.health?.counts || {});

  function toggle(rule) {
    const s = new Set(collapsed);
    s.has(rule) ? s.delete(rule) : s.add(rule);
    collapsed = s;
  }
  function jump(i) {
    openFile(i.path, i.line ? { line: i.line, tab: 'raw' } : {});
  }
</script>

<div class="page">
  <div class="page-h">
    <div>
      <h1>Health</h1>
      <p>Context lint, secret scanning and drift detection across every AI tool.</p>
    </div>
  </div>

  <div class="top">
    <section class="card scorecard">
      <HealthRing {score} {grade} size={168} stroke={12} />
      <div class="col" style="gap:10px">
        <div class="eyebrow">Project score</div>
        <div class="sevs">
          {#each ['error', 'warn', 'info'] as k (k)}
            <button class="sevbtn {k}" class:on={sev === k} onclick={() => navigate('health', sev === k ? {} : { severity: k })}>
              <Icon name={SEV_ICON[k]} size={15} />
              <b class="tnum"><Counter value={counts[k] || 0} /></b>
              <span>{SEVERITY[k].label}{(counts[k] || 0) === 1 ? '' : 's'}</span>
            </button>
          {/each}
        </div>
      </div>
    </section>
    <section class="card rules">
      <div class="card-h">By rule</div>
      <div class="card-b rgrid">
        {#each Object.entries(data?.byRule || {}).sort((a, b) => b[1] - a[1]) as [rule, n] (rule)}
          <button class="rchip" onclick={() => document.getElementById(`rule-${rule}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            <Icon name={RULES[rule]?.icon || 'alert'} size={14} />
            <span class="grow ellipsis">{RULES[rule]?.label || rule}</span>
            <b class="tnum">{n}</b>
          </button>
        {:else}
          <span class="faint">No issues</span>
        {/each}
      </div>
    </section>
  </div>

  <div class="filter row">
    <div class="searchbox grow">
      <Icon name="filter" size={14} />
      <input class="input" placeholder="Filter issues…" bind:value={q} aria-label="Filter issues" />
    </div>
    {#if sev}<button class="chip on" onclick={() => navigate('health', {})}>{SEVERITY[sev]?.label} only <Icon name="x" size={12} /></button>{/if}
  </div>

  {#if health.error}
    <Empty icon="alert" title="Could not load health">{health.error.message}</Empty>
  {:else if !data}
    <div class="skel" style="height:300px"></div>
  {:else if !groups.length}
    <div class="card"><Empty icon="shield" title={issues.length ? 'No issues match the filter' : 'All clear'}>{issues.length ? '' : 'No lint issues or secrets found.'}</Empty></div>
  {:else}
    <div class="col" style="gap:12px">
      {#each groups as g (g.rule)}
        <section class="card group" id="rule-{g.rule}">
          <button class="gh" onclick={() => toggle(g.rule)} aria-expanded={!collapsed.has(g.rule)}>
            <span class="gi {g.list[0].severity}"><Icon name={RULES[g.rule]?.icon || 'alert'} size={15} /></span>
            <span class="col" style="gap:0;flex:1;min-width:0">
              <span class="gt">{RULES[g.rule]?.label || g.rule} <span class="faint tnum">· {g.list.length}</span></span>
              {#if RULES[g.rule]?.desc}<span class="faint small ellipsis">{RULES[g.rule].desc}</span>{/if}
            </span>
            <span class="chev" class:open={!collapsed.has(g.rule)}><Icon name="chevron" size={14} /></span>
          </button>
          {#if !collapsed.has(g.rule)}
            <ul class="issues" transition:slide={{ duration: dur(220) }}>
              {#each g.list as i (i.id)}
                <li>
                  <button class="issue" onclick={() => jump(i)}>
                    <span class="si {i.severity}"><Icon name={SEV_ICON[i.severity] || 'info'} size={14} /></span>
                    <span class="col" style="gap:2px;flex:1;min-width:0">
                      <span class="msg">{i.message}</span>
                      {#if i.hint}<span class="faint small">{i.hint}</span>{/if}
                    </span>
                    <span class="loc mono">{i.path}{i.line ? `:${i.line}` : ''}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .top { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 16px; margin-bottom: 16px; }
  .scorecard { display: flex; align-items: center; gap: 28px; padding: 20px 24px; flex-wrap: wrap; }
  .sevs { display: flex; flex-direction: column; gap: 6px; }
  .sevbtn { display: flex; align-items: center; gap: 10px; border: 1px solid var(--border); background: transparent; padding: 7px 12px; border-radius: 10px; cursor: pointer; color: var(--text-2); font-size: 13px; min-width: 190px; transition: all 0.15s; }
  .sevbtn b { font-size: 16px; color: var(--text); min-width: 26px; }
  .sevbtn.error :global(.icon) { color: var(--err); }
  .sevbtn.warn :global(.icon) { color: var(--warn); }
  .sevbtn.info :global(.icon) { color: var(--info); }
  .sevbtn:hover { background: var(--panel-hover); }
  .sevbtn.on { border-color: var(--border-strong); background: var(--panel-active); color: var(--text); }
  .rgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 6px; }
  .rchip { border: 0; cursor: pointer; text-align: left; display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 9px; background: var(--panel-hover); color: var(--text-2); font-size: 12.5px; text-decoration: none; }
  .rchip:hover { background: var(--panel-active); color: var(--text); text-decoration: none; }
  .rchip b { color: var(--text); }
  .filter { margin-bottom: 12px; }
  .searchbox { position: relative; display: flex; align-items: center; color: var(--text-3); }
  .searchbox :global(.icon) { position: absolute; left: 10px; pointer-events: none; }
  .searchbox .input { padding-left: 30px; width: 100%; }
  .group { overflow: hidden; scroll-margin-top: 80px; }
  .gh { display: flex; align-items: center; gap: 12px; width: 100%; padding: 14px 16px; border: 0; background: transparent; cursor: pointer; text-align: left; }
  .gh:hover { background: var(--panel-hover); }
  .gt { font-weight: 600; }
  .gi, .si { display: grid; place-items: center; flex-shrink: 0; border-radius: 9px; }
  .gi { width: 32px; height: 32px; }
  .si { width: 24px; height: 24px; border-radius: 7px; }
  .error { background: var(--err-soft); color: var(--err); }
  .warn { background: var(--warn-soft); color: var(--warn); }
  .info { background: var(--info-soft); color: var(--info); }
  .chev { color: var(--text-3); transition: transform 0.2s var(--ease); display: grid; }
  .chev.open { transform: rotate(90deg); }
  .issues { list-style: none; margin: 0; padding: 0 8px 8px; border-top: 1px solid var(--border); }
  .issue { display: flex; align-items: flex-start; gap: 12px; width: 100%; border: 0; background: transparent; padding: 10px 8px; border-radius: 9px; cursor: pointer; text-align: left; }
  .issue:hover { background: var(--panel-hover); }
  .issue:hover .loc { color: var(--accent); }
  .msg { font-size: 13px; }
  .loc { font-size: 11.5px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 40%; padding-top: 2px; }
  .small { font-size: 12px; }
  @media (max-width: 900px) {
    .top { grid-template-columns: 1fr; }
    .issue { flex-wrap: wrap; }
    .loc { max-width: 100%; padding-left: 36px; }
  }
</style>
