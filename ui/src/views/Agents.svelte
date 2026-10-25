<script>
  import { api } from '../lib/api.js';
  import { navigate } from '../lib/store.svelte.js';
  import { resource } from '../lib/resource.svelte.js';
  import { toMs } from '../lib/format.js';
  import Tabs from '../lib/Tabs.svelte';
  import Empty from '../lib/Empty.svelte';
  import Matrix from './agents/Matrix.svelte';
  import ToolPanel from './agents/ToolPanel.svelte';
  import RulesTester from './agents/RulesTester.svelte';
  import Templates from './agents/Templates.svelte';
  import Sync from './agents/Sync.svelte';
  import Mcp from './agents/Mcp.svelte';
  import Sessions from './agents/Sessions.svelte';
  import Radar from './agents/Radar.svelte';
  import TimeTravel from './agents/TimeTravel.svelte';

  let { params = {} } = $props();

  const setup = resource(() => api('/api/agents/setup'));
  const sessions = resource(() => api('/api/sessions'));

  const list = $derived(
    (Array.isArray(sessions.data) ? sessions.data : [])
      .map((s) => ({ ...s, last: toMs(s.lastAt), start: toMs(s.startedAt) }))
      .sort((a, b) => b.last - a.last)
  );
  const tools = $derived(setup.data?.tools || []);
  const mcpCount = $derived(tools.reduce((a, t) => a + (t.capabilities?.mcp?.count || 0), 0));

  const TABS = $derived([
    { id: 'matrix', label: 'Matrix' },
    { id: 'tools', label: 'Tools', count: tools.filter((t) => t.detected).length || null },
    { id: 'rules', label: 'Rules for file' },
    { id: 'templates', label: 'Templates' },
    { id: 'sync', label: 'Sync & drift' },
    { id: 'mcp', label: 'MCP', count: mcpCount || null },
    { id: 'sessions', label: 'Sessions & cost', count: list.length || null },
    { id: 'radar', label: 'Radar' },
    { id: 'time', label: 'Time travel' },
  ]);
  const VALID = new Set(['matrix', 'tools', 'rules', 'templates', 'sync', 'mcp', 'sessions', 'radar', 'time']);
  // The URL is the single source of truth for the active tab.
  const tab = $derived(VALID.has(params.tab) ? params.tab : 'matrix');
  const go = (id) => navigate('agents', { tab: id });
</script>

<div class="page">
  <div class="page-h">
    <div>
      <h1>Agents</h1>
      <p>The AI context center — what every tool is told, how files sync, and what agents are doing right now.</p>
    </div>
  </div>

  <div class="tabs"><Tabs tabs={TABS} active={tab} onchange={go} /></div>

  <div class="body">
    {#if ['matrix', 'tools', 'mcp'].includes(tab) && setup.error}
      <Empty icon="alert" title="Could not scan the agent setup">{setup.error.message}</Empty>
    {:else if ['matrix', 'tools', 'mcp'].includes(tab) && !setup.data}
      <div class="skel" style="height:240px"></div>
    {:else if tab === 'matrix'}
      <Matrix {tools} />
    {:else if tab === 'tools'}
      <ToolPanel {tools} selected={params.tool || ''} />
    {:else if tab === 'rules'}
      <RulesTester initial={params.path || ''} />
    {:else if tab === 'templates'}
      <Templates initialTool={params.tool || ''} />
    {:else if tab === 'sync'}
      <Sync />
    {:else if tab === 'mcp'}
      <Mcp {tools} onchange={() => setup.reload()} />
    {:else if tab === 'sessions'}
      <Sessions {list} loading={!sessions.data && !sessions.error} error={sessions.error} />
    {:else if tab === 'radar'}
      <Radar {list} />
    {:else if tab === 'time'}
      <TimeTravel />
    {/if}
  </div>
</div>

<style>
  .tabs { margin-bottom: 16px; max-width: 100%; }
  .body { min-width: 0; }
</style>
