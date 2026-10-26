<script>
  // Usage & cost: cockpit and analytics over local agent sessions (docs/internal/usage-contract.md).
  // URL: #/usage?tab=&range=24h|7d|30d|90d|all&agent=claude|codex (tool=claude|codex is an alias).
  import { navigate } from '../lib/store.svelte.js';
  import Tabs from '../lib/Tabs.svelte';
  import ToolBadge from '../lib/ToolBadge.svelte';
  import Cockpit from './usage/Cockpit.svelte';
  import Tools from './usage/Tools.svelte';
  import Prompts from './usage/Prompts.svelte';
  import Fleet from './usage/Fleet.svelte';
  import Impact from './usage/Impact.svelte';
  import Activity from './usage/Activity.svelte';
  import { RANGES, AGENTS, agentOf } from './usage/shared.js';

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
  const range = $derived(RANGES.includes(params.range) ? params.range : '30d');
  const agent = $derived(agentOf(params));

  // Only range + agent carry across tabs; tab-specific keys (tool, model, q) do not.
  const base = $derived({ range: range === '30d' ? undefined : range, agent: agent === 'all' ? undefined : agent });
  const goTab = (id) => navigate('usage', { tab: id, ...base });
  function set(patch) {
    const { tool: t, agent: _a, ...rest } = params;
    // keep a tool-name highlight (Tools tab) but drop the agent alias
    const keepTool = t && !['claude', 'codex', 'all'].includes(t) ? { tool: t } : {};
    navigate('usage', { ...rest, ...keepTool, tab, ...base, ...patch });
  }
</script>

<div class="page">
  <div class="page-h">
    <div>
      <h1>Usage &amp; cost</h1>
      <p>Tokens, cost, cache, tools and patterns from your local Claude Code and Codex sessions.</p>
    </div>
    <span class="spacer"></span>
    <div class="ctl">
      <div class="segc" role="group" aria-label="Agent">
        {#each AGENTS as a (a)}
          <button class:on={agent === a} aria-pressed={agent === a} onclick={() => set({ agent: a === 'all' ? undefined : a })}>
            {#if a === 'all'}All agents{:else}<ToolBadge tool={a} compact />{a === 'claude' ? 'Claude' : 'Codex'}{/if}
          </button>
        {/each}
      </div>
      <div class="segc" role="group" aria-label="Time range">
        {#each RANGES as r (r)}
          <button class:on={range === r} aria-pressed={range === r} onclick={() => set({ range: r === '30d' ? undefined : r })}>{r === 'all' ? 'All' : r}</button>
        {/each}
      </div>
    </div>
  </div>
  <div class="tabs"><Tabs tabs={TABS} active={tab} onchange={goTab} /></div>
  {#if tab === 'overview'}<Cockpit {params} {range} {agent} />
  {:else if tab === 'tools'}<Tools {params} {range} {agent} />
  {:else if tab === 'prompts'}<Prompts {params} {range} {agent} />
  {:else if tab === 'fleet'}<Fleet {params} {range} {agent} />
  {:else if tab === 'impact'}<Impact {params} {range} {agent} />
  {:else}<Activity {params} {range} />{/if}
</div>

<style>
  .tabs { margin-bottom: 16px; max-width: 100%; overflow-x: auto; }
  .ctl { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .segc { max-width: 100%; overflow-x: auto; }
  @media (max-width: 640px) {
    .ctl { width: 100%; }
    .segc { flex: 1 1 auto; }
    .segc button { flex: 1; justify-content: center; padding: 0 6px; }
  }
</style>
