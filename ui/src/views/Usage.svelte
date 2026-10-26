<script>
  // Usage & cost: cockpit and analytics over local agent sessions (docs/internal/usage-contract.md).
  import { navigate } from '../lib/store.svelte.js';
  import Tabs from '../lib/Tabs.svelte';
  import Cockpit from './usage/Cockpit.svelte';
  import Tools from './usage/Tools.svelte';
  import Prompts from './usage/Prompts.svelte';
  import Fleet from './usage/Fleet.svelte';
  import Impact from './usage/Impact.svelte';
  import Activity from './usage/Activity.svelte';

  let { params = {} } = $props();
  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'tools', label: 'Tools' },
    { id: 'prompts', label: 'Prompts' },
    { id: 'fleet', label: 'Agent fleet' },
    { id: 'impact', label: 'Code impact' },
    { id: 'activity', label: 'Activity' },
  ];
  const tab = $derived(TABS.some((t) => t.id === params.tab) ? params.tab : 'overview');
  const range = $derived(['24h', '7d', '30d', '90d', 'all'].includes(params.range) ? params.range : '30d');
</script>

<div class="page">
  <div class="page-h">
    <div>
      <h1>Usage &amp; cost</h1>
      <p>Tokens, cost, cache, tools and patterns from your local Claude Code and Codex sessions.</p>
    </div>
  </div>
  <div class="tabs"><Tabs tabs={TABS} active={tab} onchange={(id) => navigate('usage', { ...params, tab: id })} /></div>
  {#if tab === 'overview'}<Cockpit {params} {range} />
  {:else if tab === 'tools'}<Tools {params} {range} />
  {:else if tab === 'prompts'}<Prompts {params} {range} />
  {:else if tab === 'fleet'}<Fleet {params} {range} />
  {:else if tab === 'impact'}<Impact {params} {range} />
  {:else}<Activity {params} {range} />{/if}
</div>

<style>
  .tabs { margin-bottom: 16px; max-width: 100%; }
</style>
