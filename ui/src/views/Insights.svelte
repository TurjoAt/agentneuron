<script>
  import { navigate } from '../lib/store.svelte.js';
  import Tabs from '../lib/Tabs.svelte';
  import Lessons from './insights/Lessons.svelte';
  import RuleEffect from './insights/RuleEffect.svelte';
  import Replay from './insights/Replay.svelte';
  import FeatureCosts from './insights/FeatureCosts.svelte';

  let { params = {} } = $props();
  const TABS = [
    { id: 'lessons', label: 'Lessons' },
    { id: 'rules', label: 'Rule effectiveness' },
    { id: 'replay', label: 'Replay' },
    { id: 'costs', label: 'Cost by feature' },
  ];
  const tab = $derived(TABS.some((t) => t.id === params.tab) ? params.tab : 'lessons');
</script>

<div class="page">
  <div class="page-h">
    <div>
      <h1>Insights</h1>
      <p>What your agent sessions teach: rules to add, rules that work (or don't), why an agent did something, and what each feature cost.</p>
    </div>
  </div>
  <div class="tabs"><Tabs tabs={TABS} active={tab} onchange={(id) => navigate('insights', { tab: id })} /></div>
  {#if tab === 'lessons'}
    <Lessons />
  {:else if tab === 'rules'}
    <RuleEffect />
  {:else if tab === 'replay'}
    <Replay path={params.path || ''} ts={params.ts || ''} session={params.session || ''} />
  {:else}
    <FeatureCosts />
  {/if}
</div>

<style>
  .tabs { margin-bottom: 16px; max-width: 100%; }
</style>
