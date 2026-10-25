<script>
  import { api } from '../lib/api.js';
  import { navigate } from '../lib/store.svelte.js';
  import { resource } from '../lib/resource.svelte.js';
  import Tabs from '../lib/Tabs.svelte';
  import Studio from './rules/Studio.svelte';
  import CompilePanel from './rules/CompilePanel.svelte';
  import ImportPanel from './rules/ImportPanel.svelte';
  import GeneratePanel from './rules/GeneratePanel.svelte';

  let { params = {} } = $props();

  const rules = resource(() => api('/api/compiler/rules'), { live: false });
  const preview = resource(() => api('/api/compiler/preview'));
  const reload = () => { rules.reload(); preview.reload(); };

  const pending = $derived((preview.data?.stale || 0) + (preview.data?.edited?.length || 0));
  const TABS = $derived([
    { id: 'rules', label: 'Source rules', count: rules.data?.rules?.length || null },
    { id: 'compile', label: 'Compile', count: pending || null },
    { id: 'import', label: 'Import' },
    { id: 'generate', label: 'Generate from code' },
  ]);
  const VALID = new Set(['rules', 'compile', 'import', 'generate']);
  const tab = $derived(VALID.has(params.tab) ? params.tab : 'rules');
  const go = (id) => navigate('rules', { tab: id });
</script>

<div class="page">
  <div class="page-h">
    <div>
      <h1>Rules studio</h1>
      <p>Write each rule once in <span class="mono">{rules.data?.dir || '.agentneuron/rules'}/</span> and compile it into every tool's native format.</p>
    </div>
  </div>

  <div class="tabs"><Tabs tabs={TABS} active={tab} onchange={go} /></div>

  <div class="body">
    {#if tab === 'rules'}
      <Studio {rules} {preview} selected={params.rule || ''} onchange={reload} />
    {:else if tab === 'compile'}
      <CompilePanel {preview} onchange={reload} />
    {:else if tab === 'import'}
      <ImportPanel onchange={reload} />
    {:else}
      <GeneratePanel initialTool={params.tool || 'agents'} />
    {/if}
  </div>
</div>

<style>
  .tabs { margin-bottom: 16px; max-width: 100%; }
  .body { min-width: 0; }
</style>
