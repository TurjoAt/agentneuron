<script>
  import { navigate, openFile } from '../../lib/store.svelte.js';
  import { runAction } from '../../lib/actions.js';
  import Icon from '../../lib/Icon.svelte';
  import ActionBtn from '../overview/ActionBtn.svelte';
  import { CAPS, toolKey, templateFor, itemPath, permKind } from './shared.js';
  import EntityLink from '../../lib/EntityLink.svelte';

  let { tools = [], selected = '' } = $props();
  const list = $derived(tools.filter((t) => t.detected));
  const tool = $derived(list.find((t) => t.id === selected) || list[0]);
  const c = $derived(`var(--tool-${toolKey(tool?.id)})`);
  const cap = (id) => tool?.capabilities?.[id]?.items || [];
  const open = (p) => p && !p.startsWith('~') && openFile(p, { drawer: true });
  const perms = $derived(['allow', 'ask', 'deny'].map((k) => [k, cap('permissions').filter((p) => permKind(p) === k)]));
  const sel = (id) => navigate('agents', { tab: 'tools', tool: id });
  // instructions sorted shallow → deep: shows the hierarchy Claude/Codex walk.
  const depth = (p) => (p || '').split('/').length - 1;
  const instr = $derived([...cap('instructions')].sort((a, b) => depth(a.path) - depth(b.path)));
</script>

{#if !list.length}
  <div class="card pad faint">No AI tool configuration detected in this project.</div>
{:else}
  <div class="pick">
    {#each list as t (t.id)}
      <button class="chip" class:on={t.id === tool.id} style="--c:var(--tool-{toolKey(t.id)})" onclick={() => sel(t.id)}>
        <span class="d"></span>{t.name}
      </button>
    {/each}
    {#if tool.id === 'claude' || tool.id === 'codex'}
      <span class="spacer"></span>
      <EntityLink kind="agent" id={tool.id} class="small" title="Sessions, cost and files for {tool.name}">{tool.name} sessions &amp; cost</EntityLink>
    {/if}
  </div>

  <div class="cols" style="--c:{c}">
    <section class="card">
      <div class="card-h"><Icon name="file" size={14} /> Files <span class="sub">{tool.files.length}</span></div>
      <div class="card-b col" style="gap:2px">
        {#each tool.files as f (f.path)}
          <button class="list-row" onclick={() => open(f.path)}>
            <span class="mono small ellipsis grow">{f.path}</span>
            <span class="badge">{f.kind}</span>
            {#if f.scope && f.scope !== 'project'}<span class="badge info">{f.scope}</span>{/if}
          </button>
        {/each}
      </div>
    </section>

    <section class="card">
      <div class="card-h">{tool.id === 'claude' || tool.id === 'codex' ? 'Instruction hierarchy' : 'Instructions'} <span class="sub">{instr.length}</span></div>
      <div class="card-b col" style="gap:2px">
        {#each instr as it (it.path)}
          <button class="list-row" style="padding-left:{8 + depth(it.path) * 14}px" onclick={() => open(it.path)}>
            {#if depth(it.path)}<span class="faint">↳</span>{/if}
            <span class="mono small ellipsis grow">{it.path}</span>
            {#if it.tokens != null}<span class="faint tiny tnum">{it.tokens} tok</span>{/if}
            {#if it.scope && it.scope !== 'project'}<span class="badge info">{it.scope}</span>{/if}
            {#if it.legacy}<span class="badge warn">legacy</span>{/if}
          </button>
        {:else}
          <div class="none">
            None.
            {#if templateFor(tool.id, 'instructions')}
              <ActionBtn id="agents.create" params={{ template: templateFor(tool.id, 'instructions') }} label="Create from template" icon="plus" cls="sm" />
            {/if}
          </div>
        {/each}
      </div>
    </section>

    {#if cap('rules').length || tool.id === 'cursor' || tool.id === 'copilot'}
      <section class="card">
        <div class="card-h">Rules <span class="sub">{cap('rules').length}</span><span class="spacer"></span>
          {#if templateFor(tool.id, 'rules')}<ActionBtn id="agents.create" params={{ template: templateFor(tool.id, 'rules') }} label="New rule" icon="plus" cls="sm" />{/if}
        </div>
        <div class="card-b col" style="gap:6px">
          {#each cap('rules') as r (r.path)}
            <button class="rule" onclick={() => open(r.path)}>
              <div class="row" style="gap:8px"><span class="mono small ellipsis grow">{r.path}</span>
                {#if r.alwaysApply || r.trigger === 'always_on'}<span class="badge ok">always</span>{:else if r.globs?.length || r.applyTo}<span class="badge accent">glob</span>{:else}<span class="badge">manual</span>{/if}
              </div>
              {#if r.description}<div class="muted small">{r.description}</div>{/if}
              {#if r.globs?.length || r.applyTo}<div class="gl">{#each r.globs?.length ? r.globs : [r.applyTo] as g (g)}<code>{g}</code>{/each}</div>{/if}
            </button>
          {:else}<div class="none">None.</div>{/each}
        </div>
      </section>
    {/if}

    {#each [['agents', 'Agents', 'agents'], ['skills', 'Skills', 'sparkles'], ['commands', 'Commands', 'terminal']] as [id, label, icon] (id)}
      {#if cap(id).length || templateFor(tool.id, id)}
        <section class="card">
          <div class="card-h"><Icon name={icon} size={14} /> {label} <span class="sub">{cap(id).length}</span><span class="spacer"></span>
            {#if templateFor(tool.id, id)}<ActionBtn id="agents.create" params={{ template: templateFor(tool.id, id) }} label="New" icon="plus" cls="sm" />{/if}
          </div>
          <div class="card-b col" style="gap:2px">
            {#each cap(id) as it (it.path || it.name)}
              <button class="list-row top" onclick={() => open(it.path)}>
                <div class="grow col" style="gap:2px;min-width:0">
                  <b class="small">{id === 'commands' ? '/' : ''}{it.name}</b>
                  {#if it.description}<span class="muted small">{it.description}</span>{/if}
                  <span class="row" style="gap:6px;flex-wrap:wrap">
                    {#if it.tools}<span class="faint tiny">tools: {Array.isArray(it.tools) ? it.tools.join(', ') : it.tools}</span>{/if}
                    {#if it.argumentHint}<code class="tiny">{it.argumentHint}</code>{/if}
                    {#if it.files}<span class="faint tiny">{it.files} file{it.files === 1 ? '' : 's'}</span>{/if}
                  </span>
                </div>
                {#if it.model}<span class="badge accent">{it.model}</span>{/if}
              </button>
            {:else}<div class="none">None.</div>{/each}
          </div>
        </section>
      {/if}
    {/each}

    <section class="card">
      <div class="card-h"><Icon name="server" size={14} /> MCP servers <span class="sub">{cap('mcp').length}</span><span class="spacer"></span>
        {#if tool.id === 'claude'}<ActionBtn id="agents.mcp.add" params={{ type: 'stdio' }} label="Add" icon="plus" cls="sm" />{/if}
      </div>
      <div class="card-b col" style="gap:2px">
        {#each cap('mcp') as m (m.name + m.source)}
          <button class="list-row" onclick={() => open(m.source)}>
            <b class="small">{m.name}</b><span class="badge {m.type === 'stdio' ? '' : 'info'}">{m.type}</span>
            <span class="mono small muted ellipsis grow">{m.command || m.url}</span>
          </button>
        {:else}<div class="none">None.</div>{/each}
      </div>
    </section>

    {#if cap('hooks').length || tool.id === 'claude'}
      <section class="card">
        <div class="card-h"><Icon name="hook" size={14} /> Hooks <span class="sub">{cap('hooks').length}</span><span class="spacer"></span>
          {#if tool.id === 'claude'}<ActionBtn id="agents.hooks.update" label="Edit" icon="edit" cls="sm" />{/if}
        </div>
        <div class="card-b col" style="gap:2px">
          {#each cap('hooks') as h, i (i)}
            <button class="list-row" onclick={() => open(h.source)}>
              <span class="badge accent">{h.event}</span>{#if h.matcher}<span class="mono small muted">{h.matcher}</span>{/if}
              <code class="cmd grow ellipsis">{h.command}</code>
            </button>
          {:else}<div class="none">None.</div>{/each}
        </div>
      </section>
    {/if}

    {#if cap('permissions').length || tool.id === 'claude'}
      <section class="card">
        <div class="card-h"><Icon name="shield" size={14} /> Permissions <span class="sub">{cap('permissions').length}</span><span class="spacer"></span>
          {#if tool.id === 'claude'}<ActionBtn id="agents.permissions.update" label="Edit" icon="edit" cls="sm" />{/if}
        </div>
        <div class="card-b perms">
          {#each perms as [k, items] (k)}
            <div class="pcol">
              <div class="eyebrow"><span class="pd {k}"></span>{k} · {items.length}</div>
              {#each items as p, i (k + i)}<code class="pr {k}" title={p.source || ''}>{p.rule}</code>{:else}<span class="faint small">None</span>{/each}
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if cap('ignore').length}
      <section class="card">
        <div class="card-h"><Icon name="eye" size={14} /> Ignore <span class="sub">{cap('ignore').length}</span></div>
        <div class="card-b col" style="gap:6px">
          {#each cap('ignore') as ig (ig.path)}
            <button class="rule" onclick={() => open(ig.path)}>
              <span class="mono small">{ig.path}</span>
              <div class="gl">{#each (ig.patterns || []).slice(0, 8) as g (g)}<code>{g}</code>{/each}</div>
            </button>
          {/each}
        </div>
      </section>
    {/if}
  </div>
{/if}

<style>
  .pick { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
  .pick .chip .d { width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
  .pick .chip.on { border-color: color-mix(in srgb, var(--c) 55%, transparent); }
  .cols { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; align-items: start; }
  .pad { padding: 18px; }
  .small { font-size: 12.5px; }
  .tiny { font-size: 11px; }
  .none { color: var(--text-3); font-size: 12.5px; padding: 4px 4px; display: flex; gap: 10px; align-items: center; }
  .list-row.top { align-items: flex-start; }
  .rule { text-align: left; border: 1px solid var(--border); background: var(--panel-hover); border-radius: 10px; padding: 9px 11px; display: flex; flex-direction: column; gap: 5px; color: inherit; cursor: pointer; }
  .rule:hover { border-color: var(--border-strong); }
  .gl { display: flex; gap: 5px; flex-wrap: wrap; }
  .gl code, code.tiny { font-family: var(--mono); font-size: 11px; background: var(--inset); border: 1px solid var(--border); border-radius: 5px; padding: 1px 6px; }
  .cmd { font-family: var(--mono); font-size: 12px; background: var(--inset); border: 1px solid var(--border); padding: 3px 8px; border-radius: 6px; }
  .perms { display: flex; flex-direction: column; gap: 12px; }
  .pcol { display: flex; flex-direction: column; gap: 5px; align-items: flex-start; }
  .pcol .eyebrow { display: flex; align-items: center; gap: 6px; }
  .pd { width: 8px; height: 8px; border-radius: 50%; }
  .pd.allow { background: var(--ok); } .pd.ask { background: var(--warn); } .pd.deny { background: var(--err); }
  .pr { font-family: var(--mono); font-size: 12px; padding: 3px 9px; border-radius: 7px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .pr.allow { background: var(--ok-soft); color: var(--ok); }
  .pr.ask { background: var(--warn-soft); color: var(--warn); }
  .pr.deny { background: var(--err-soft); color: var(--err); }
</style>
