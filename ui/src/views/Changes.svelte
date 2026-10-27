<script>
  // Change review (agent B). Contract: docs/internal/quality-contract.md.
  import { navigate } from '../lib/store.svelte.js';
  import Tabs from '../lib/Tabs.svelte';
  import Empty from '../lib/Empty.svelte';

  let { params = {} } = $props();
  const IDS = ['review', 'impact', 'checkpoints', 'packages'];
  const tab = $derived(IDS.includes(params.tab) ? params.tab : IDS[0]);
  const TABS = [
    { id: 'review', label: 'Review' },
    { id: 'impact', label: 'Impact' },
    { id: 'checkpoints', label: 'Checkpoints' },
    { id: 'packages', label: 'Packages' },
  ];
</script>

<div class="page">
  <div class="page-h">
    <div>
      <h1>Change review</h1>
      <p>Risk, impact, checkpoints and dependency checks for what agents changed.</p>
    </div>
  </div>
  <div class="tabs"><Tabs tabs={TABS} active={tab} onchange={(id) => navigate('changes', { tab: id })} /></div>
  <div class="card"><Empty icon="info" title="Coming soon">This page is being built.</Empty></div>
</div>
