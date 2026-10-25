<script>
  import { api } from '../lib/api.js';
  import { navigate } from '../lib/store.svelte.js';
  import { resource } from '../lib/resource.svelte.js';
  import Tabs from '../lib/Tabs.svelte';
  import Truth from './verify/Truth.svelte';
  import Audit from './verify/Audit.svelte';

  let { params = {} } = $props();

  const verify = resource(() => api('/api/verify'));
  const audit = resource(() => api('/api/audit/config'));

  const tab = $derived(params.tab === 'audit' ? 'audit' : 'truth');
  const TABS = $derived([
    { id: 'truth', label: 'Truth check', count: verify.data?.summary?.false || null },
    { id: 'audit', label: 'Security audit', count: audit.data ? audit.data.counts.high + audit.data.counts.medium || null : null },
  ]);
</script>

<div class="page">
  <div class="page-h">
    <div>
      <h1>Truth &amp; safety</h1>
      <p>Do your context files tell agents the truth about this repo, and is the agent config safe to run?</p>
    </div>
  </div>

  <div class="tabs"><Tabs tabs={TABS} active={tab} onchange={(id) => navigate('verify', { tab: id })} /></div>

  {#if tab === 'truth'}
    <Truth res={verify} status={params.status || ''} />
  {:else}
    <Audit res={audit} />
  {/if}
</div>

<style>
  .tabs { margin-bottom: 16px; max-width: 100%; }
</style>
