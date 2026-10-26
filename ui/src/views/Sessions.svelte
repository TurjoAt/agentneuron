<script>
  // Sessions: list of agent sessions (?q=&range=&agent=), the replay of one (?id=&at=|ts=),
  // and "Why did it change?" (?view=changes&path=&ts=&session=; old #/insights?tab=replay links land here).
  import { navigate } from '../lib/store.svelte.js';
  import Tabs from '../lib/Tabs.svelte';
  import List from './sessions/List.svelte';
  import Replay from './sessions/Replay.svelte';
  import WhyReplay from './insights/Replay.svelte';

  let { params = {} } = $props();
  const view = $derived(params.view === 'changes' || (!params.id && params.path) ? 'changes' : 'list');
  const TABS = [
    { id: 'list', label: 'Sessions' },
    { id: 'changes', label: 'Why did it change?' },
  ];
</script>

<div class="page">
  <div class="page-h">
    <div>
      <h1>Sessions</h1>
      <p>Every Claude Code and Codex session: replay prompts, tool calls, edits and subagents.</p>
    </div>
  </div>
  {#if params.id}
    {#key params.id}<Replay id={params.id} {params} />{/key}
  {:else}
    <div class="tabs"><Tabs tabs={TABS} active={view} onchange={(id) => navigate('sessions', id === 'changes' ? { view: 'changes' } : {})} /></div>
    {#if view === 'changes'}
      <WhyReplay path={params.path || ''} ts={params.ts || ''} session={params.session || ''} />
    {:else}
      <List {params} />
    {/if}
  {/if}
</div>

<style>
  .tabs { margin-bottom: 14px; max-width: 100%; }
</style>
