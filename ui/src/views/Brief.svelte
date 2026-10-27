<script>
  // Agent brief (agent C). Contract: docs/internal/quality-contract.md.
  import { navigate } from '../lib/store.svelte.js';
  import Tabs from '../lib/Tabs.svelte';
  import Empty from '../lib/Empty.svelte';

  let { params = {} } = $props();
  const IDS = ['resume', 'warnings', 'pack', 'debug'];
  const tab = $derived(IDS.includes(params.tab) ? params.tab : IDS[0]);
  const TABS = [
    { id: 'resume', label: 'Resume' },
    { id: 'warnings', label: 'Warnings' },
    { id: 'pack', label: 'Context pack' },
    { id: 'debug', label: 'Bug detective' },
  ];
</script>

<div class="page">
  <div class="page-h">
    <div>
      <h1>Agent brief</h1>
      <p>Resume work, avoid known mistakes, build task context and diagnose errors.</p>
    </div>
  </div>
  <div class="tabs"><Tabs tabs={TABS} active={tab} onchange={(id) => navigate('brief', { tab: id })} /></div>
  <div class="card"><Empty icon="info" title="Coming soon">This page is being built.</Empty></div>
</div>
