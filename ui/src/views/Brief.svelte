<script>
  // Agent brief: resume briefs, mistake prevention (warnings / preflight), context packs, bug detective.
  // Contract: docs/internal/quality-contract.md (Slice C). User doc: docs/brief.md.
  import { navigate } from '../lib/store.svelte.js';
  import Tabs from '../lib/Tabs.svelte';
  import ResumeTab from './brief/ResumeTab.svelte';
  import WarningsTab from './brief/WarningsTab.svelte';
  import PackTab from './brief/PackTab.svelte';
  import DebugTab from './brief/DebugTab.svelte';

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
      <p>Resume work, avoid known mistakes, build task context and diagnose errors. Every item cites its evidence; nothing here calls a model.</p>
    </div>
  </div>
  <div class="tabs"><Tabs tabs={TABS} active={tab} onchange={(id) => navigate('brief', { tab: id })} /></div>
  {#if tab === 'warnings'}
    <WarningsTab {params} />
  {:else if tab === 'pack'}
    <PackTab {params} />
  {:else if tab === 'debug'}
    <DebugTab />
  {:else}
    <ResumeTab {params} />
  {/if}
</div>

<style>
  .tabs { margin-bottom: 16px; max-width: 100%; }
</style>
