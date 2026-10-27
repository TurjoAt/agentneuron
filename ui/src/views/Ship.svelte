<script>
  // Ship check (agent A). Contract: docs/internal/quality-contract.md.
  import { navigate } from '../lib/store.svelte.js';
  import Tabs from '../lib/Tabs.svelte';
  import Empty from '../lib/Empty.svelte';

  let { params = {} } = $props();
  const IDS = ['report', 'scope', 'readiness', 'placeholders', 'runs'];
  const tab = $derived(IDS.includes(params.tab) ? params.tab : IDS[0]);
  const TABS = [
    { id: 'report', label: 'Report' },
    { id: 'scope', label: 'Scope' },
    { id: 'readiness', label: 'Readiness' },
    { id: 'placeholders', label: 'Placeholders' },
    { id: 'runs', label: 'Runs' },
  ];
</script>

<div class="page">
  <div class="page-h">
    <div>
      <h1>Ship check</h1>
      <p>Is the work verified, in scope and ready to deploy?</p>
    </div>
  </div>
  <div class="tabs"><Tabs tabs={TABS} active={tab} onchange={(id) => navigate('ship', { tab: id })} /></div>
  <div class="card"><Empty icon="info" title="Coming soon">This page is being built.</Empty></div>
</div>
