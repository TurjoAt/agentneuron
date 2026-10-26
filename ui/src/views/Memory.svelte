<script>
  // Memory & plans: what Claude remembers about this project (memory/*.md) and its saved plans, checked against the repo.
  import { api } from '../lib/api.js';
  import { navigate } from '../lib/store.svelte.js';
  import { resource } from '../lib/resource.svelte.js';
  import Tabs from '../lib/Tabs.svelte';
  import Empty from '../lib/Empty.svelte';
  import MemoryTab from './memory/MemoryTab.svelte';
  import PlansTab from './memory/PlansTab.svelte';

  let { params = {} } = $props();

  const res = resource(() => api('/api/usage/memory'));
  const tab = $derived(params.tab === 'plans' ? 'plans' : 'memory');
  const memory = $derived(Array.isArray(res.data?.memory) ? res.data.memory : []);
  const plans = $derived(Array.isArray(res.data?.plans) ? res.data.plans : []);
  const staleN = $derived(memory.reduce((a, m) => a + (m.stale?.length || 0), 0));
  const TABS = $derived([
    { id: 'memory', label: 'Memory', count: res.data ? memory.length : null },
    { id: 'plans', label: 'Plans', count: res.data ? plans.length : null },
  ]);
</script>

<div class="page">
  <div class="page-h">
    <div>
      <h1>Memory &amp; plans</h1>
      <p>Claude's saved memory and plans for this project, checked against the repo.</p>
    </div>
    {#if staleN}
      <a class="badge warn stale" href="#/verify" title="Memory claims that no longer match the repo">{staleN} stale claim{staleN === 1 ? '' : 's'}</a>
    {/if}
  </div>

  <div class="tabs"><Tabs tabs={TABS} active={tab} onchange={(id) => navigate('memory', { tab: id })} /></div>

  {#if res.error && !res.data}
    <div class="card"><Empty icon="alert" title="Could not load memory">{res.error.message}</Empty></div>
  {:else if res.data === undefined}
    <div class="card card-b sk" aria-busy="true"><div class="skel-rows"><div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div></div></div>
  {:else if tab === 'plans'}
    <PlansTab {plans} focus={params.file || ''} />
  {:else}
    <MemoryTab {memory} focus={params.name || ''} />
  {/if}
</div>

<style>
  .tabs { margin-bottom: 16px; max-width: 100%; }
  .stale { text-decoration: none; margin-left: auto; margin-bottom: 3px; }
  .sk { padding-top: 16px; }
</style>
