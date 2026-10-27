<script>
  // Ship check (agent A): is the work verified, in scope and ready to deploy?
  // Contract: docs/internal/quality-contract.md.
  import { api } from '../lib/api.js';
  import { navigate } from '../lib/store.svelte.js';
  import { resource } from '../lib/resource.svelte.js';
  import Tabs from '../lib/Tabs.svelte';
  import ReportTab from './ship/ReportTab.svelte';
  import ScopeTab from './ship/ScopeTab.svelte';
  import ReadinessTab from './ship/ReadinessTab.svelte';
  import PlaceholdersTab from './ship/PlaceholdersTab.svelte';
  import RunsTab from './ship/RunsTab.svelte';
  import { VERDICT } from './ship/shared.js';

  let { params = {} } = $props();
  const IDS = ['report', 'scope', 'readiness', 'placeholders', 'runs'];
  const tab = $derived(IDS.includes(params.tab) ? params.tab : IDS[0]);
  const sum = resource(() => api('/api/ship/summary'));
  const s = $derived(sum.data);
  const TABS = $derived([
    { id: 'report', label: 'Report' },
    { id: 'scope', label: 'Scope', count: s ? s.scope.criteria : null },
    { id: 'readiness', label: 'Readiness', count: s ? s.readiness.blockers + s.readiness.counts.medium : null },
    { id: 'placeholders', label: 'Placeholders', count: s ? s.placeholders.count : null },
    { id: 'runs', label: 'Runs', count: s ? s.lastRuns.length : null },
  ]);
  const v = $derived(s ? VERDICT[s.verdict] : null);
</script>

<div class="page">
  <div class="page-h">
    <div>
      <h1>Ship check</h1>
      <p>Is the work verified, in scope and ready to deploy? Evidence from test runs, commits and files; nothing here asks a model.</p>
    </div>
    {#if v}
      <div class="hdr">
        <span class="badge {v.tone}" title="Completion verdict">{v.label}</span>
        <a class="badge {s.readiness.ready ? 'ok' : 'err'}" href="#/ship?tab=readiness" title="Production readiness">{s.readiness.ready ? 'ready' : `${s.readiness.blockers} blocker${s.readiness.blockers === 1 ? '' : 's'}`}</a>
      </div>
    {/if}
  </div>
  <div class="tabs"><Tabs tabs={TABS} active={tab} onchange={(id) => navigate('ship', { tab: id })} /></div>

  {#if tab === 'report'}
    <ReportTab {params} summary={s} onchange={() => sum.reload()} />
  {:else if tab === 'scope'}
    <ScopeTab onchange={() => sum.reload()} />
  {:else if tab === 'readiness'}
    <ReadinessTab />
  {:else if tab === 'placeholders'}
    <PlaceholdersTab />
  {:else}
    <RunsTab {params} />
  {/if}
</div>

<style>
  .tabs { margin-bottom: 16px; max-width: 100%; }
  .hdr { display: flex; gap: 6px; margin-left: auto; margin-bottom: 3px; flex-wrap: wrap; }
  .hdr a { text-decoration: none; }
</style>
