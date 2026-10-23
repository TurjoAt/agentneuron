<script>
  import { openFile } from '../../lib/store.svelte.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import ActionBtn from '../overview/ActionBtn.svelte';
  import { toolKey } from './shared.js';

  let { tools = [], onchange = null } = $props();
  let results = $state({});

  const servers = $derived(
    tools.flatMap((t) => (t.capabilities?.mcp?.items || []).map((m) => ({ ...m, tool: t.id, toolName: t.name })))
  );
  const editable = (m) => m.tool === 'claude' && m.source === '.mcp.json';
  const key = (m) => m.tool + ':' + m.name;

  function tested(m, job) {
    const r = job?.result;
    const n = r?.tools?.length ?? r?.toolCount;
    results[key(m)] = { ok: job?.status === 'ok', text: job?.status === 'ok' ? (n != null ? `${n} tools` : 'reachable') : job?.error || 'failed', ts: Date.now() };
  }
</script>

<section class="card">
  <div class="card-h"><Icon name="server" size={14} /> MCP servers <span class="sub">{servers.length} across {new Set(servers.map((s) => s.tool)).size} tools</span><span class="spacer"></span>
    <ActionBtn id="agents.mcp.add" params={{ type: 'stdio' }} label="Add server" icon="plus" cls="sm primary" hint onrun={() => onchange?.()} />
  </div>
  {#if !servers.length}
    <Empty icon="server" title="No MCP servers configured">Add one to .mcp.json to give agents extra tools.</Empty>
  {:else}
    <div class="list">
      {#each servers as m (key(m) + m.source)}
        {@const r = results[key(m)]}
        <div class="srv" style="--c:var(--tool-{toolKey(m.tool)})">
          <div class="top">
            <span class="d"></span><b>{m.name}</b>
            <span class="badge {m.type === 'stdio' ? '' : 'info'}">{m.type || 'stdio'}</span>
            <span class="faint small">{m.toolName}</span>
            {#if m.scope && m.scope !== 'project'}<span class="badge info">{m.scope}</span>{/if}
            <span class="spacer"></span>
            {#if r}<span class="badge {r.ok ? 'ok' : 'err'}" title={r.text}>{r.ok ? 'ok' : 'failed'} · {r.text}</span>{/if}
          </div>
          <code class="cmd ellipsis" title={m.command || m.url}>{m.command || m.url}</code>
          <div class="bot">
            <button class="src mono" onclick={() => m.source && !m.source.startsWith('~') && openFile(m.source, { drawer: true })}>{m.source}</button>
            <span class="spacer"></span>
            <ActionBtn id="agents.mcp.test" params={{ name: m.name }} label="Test" icon="play" cls="sm" opts={{ wait: true }} onrun={(j) => tested(m, j)} />
            {#if editable(m)}<ActionBtn id="agents.mcp.remove" params={{ name: m.name }} label="Remove" icon="trash" cls="sm danger" onrun={() => onchange?.()} />{/if}
          </div>
        </div>
      {/each}
    </div>
    <div class="card-b faint small">Testing spawns the server (stdio) or calls it (http) and lists its tools — requires the <b>exec</b> level.</div>
  {/if}
</section>

<style>
  .list { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 10px; padding: 0 16px 14px; }
  .srv { border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; background: var(--panel-hover); min-width: 0; }
  .top, .bot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
  .d { width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
  .cmd { font-family: var(--mono); font-size: 12px; background: var(--inset); border: 1px solid var(--border); padding: 4px 9px; border-radius: 7px; display: block; }
  .src { border: 0; background: none; color: var(--text-3); font-size: 11.5px; cursor: pointer; padding: 0; }
  .src:hover { color: var(--accent); }
  .small { font-size: 12.5px; }
</style>
