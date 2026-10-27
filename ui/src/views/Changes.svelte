<script>
  // Change review: risk review of the diff, impact of the changed code, checkpoints with selective restore,
  // dependency checks. Contract: docs/internal/quality-contract.md (Slice B).
  import { navigate } from '../lib/store.svelte.js';
  import Tabs from '../lib/Tabs.svelte';
  import ReviewTab from './changes/ReviewTab.svelte';
  import ImpactTab from './changes/ImpactTab.svelte';
  import CheckpointsTab from './changes/CheckpointsTab.svelte';
  import PackagesTab from './changes/PackagesTab.svelte';

  let { params = {} } = $props();
  const IDS = ['review', 'impact', 'checkpoints', 'packages'];
  const tab = $derived(IDS.includes(params.tab) ? params.tab : IDS[0]);
  const TABS = [
    { id: 'review', label: 'Review' },
    { id: 'impact', label: 'Impact' },
    { id: 'checkpoints', label: 'Checkpoints' },
    { id: 'packages', label: 'Packages' },
  ];
  const go = (p) => navigate('changes', { tab, ...p });
</script>

<div class="page">
  <div class="page-h">
    <div>
      <h1>Change review</h1>
      <p>Risk, impact, checkpoints and dependency checks for what agents changed.</p>
    </div>
  </div>
  <div class="tabs"><Tabs tabs={TABS} active={tab} onchange={(id) => navigate('changes', { tab: id })} /></div>
  {#if tab === 'impact'}
    <ImpactTab {params} {go} />
  {:else if tab === 'checkpoints'}
    <CheckpointsTab {params} {go} />
  {:else if tab === 'packages'}
    <PackagesTab />
  {:else}
    <ReviewTab {params} {go} />
  {/if}
</div>

<style>
  .tabs { margin-bottom: 16px; max-width: 100%; }
</style>
