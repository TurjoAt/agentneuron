<script>
  import { navigate, openFile } from '../../lib/store.svelte.js';
  import { runAction, actionEnabled } from '../../lib/actions.js';
  import Icon from '../../lib/Icon.svelte';
  import { CAPS, toolKey, templateFor, itemPath, capCount, capItems } from './shared.js';

  let { tools = [] } = $props();
  let showAll = $state(false);
  const rows = $derived(showAll ? tools : tools.filter((t) => t.detected));
  const hidden = $derived(tools.filter((t) => !t.detected).length);
  const createOk = $derived(actionEnabled('agents.create'));

  function have(t, cap) {
    const p = itemPath(capItems(t, cap.id)[0]);
    if (p && !p.startsWith('~')) openFile(p, { drawer: true });
    else navigate('agents', { tab: 'tools', tool: t.id });
  }
  function create(t, cap) {
    const tpl = templateFor(t.id, cap.id);
    if (tpl) return runAction('agents.create', { template: tpl });
    if (cap.id === 'mcp') return runAction('agents.mcp.add', { type: 'stdio' });
    navigate('agents', { tab: 'templates', tool: t.id });
  }
  function hint(t, cap) {
    const tpl = templateFor(t.id, cap.id);
    if (tpl) return createOk.enabled ? `Create from template (${tpl})` : createOk.reason;
    if (cap.id === 'mcp') return 'Add an MCP server';
    return `${t.name} has no ${cap.label.toLowerCase()} — browse templates`;
  }
</script>

<section class="card">
  <div class="card-h">Capability matrix <span class="sub">which tool has which context</span><span class="spacer"></span>
    {#if hidden}<button class="chip" class:on={showAll} onclick={() => (showAll = !showAll)}>{showAll ? 'Hide' : 'Show'} {hidden} undetected</button>{/if}
  </div>
  <div class="scroll">
    <table class="mx">
      <thead>
        <tr>
          <th class="tcol">Tool</th>
          {#each CAPS as c (c.id)}<th title={c.label}><span class="ch"><Icon name={c.icon} size={13} /><span>{c.label}</span></span></th>{/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as t (t.id)}
          <tr class:off={!t.detected}>
            <th class="tcol">
              <button class="tn" style="--c:var(--tool-{toolKey(t.id)})" onclick={() => navigate('agents', { tab: 'tools', tool: t.id })}>
                <span class="dot"></span>{t.name}
              </button>
            </th>
            {#each CAPS as c (c.id)}
              {@const n = capCount(t, c.id)}
              <td>
                {#if n > 0}
                  <button class="cell on" style="--c:var(--tool-{toolKey(t.id)})" title="{c.label}: {n} — open" onclick={() => have(t, c)}>
                    <Icon name="check" size={12} stroke={2.4} /><b class="tnum">{n}</b>
                  </button>
                {:else}
                  <button class="cell miss" title={hint(t, c)} onclick={() => create(t, c)}>
                    <Icon name="plus" size={12} />
                  </button>
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <div class="card-b legend faint">
    <span><i class="lg on"></i> present — click to open</span>
    <span><i class="lg miss"></i> missing — click to create from a template</span>
  </div>
</section>

<style>
  .scroll { overflow-x: auto; padding: 0 8px 4px; }
  .mx { width: 100%; border-collapse: separate; border-spacing: 4px; font-size: 12.5px; }
  .mx th { font-weight: 600; color: var(--text-3); font-size: 11px; letter-spacing: 0.02em; padding: 4px 2px; white-space: nowrap; }
  .ch { display: inline-flex; flex-direction: column; align-items: center; gap: 3px; }
  .tcol { text-align: left; position: sticky; left: 0; background: var(--panel-solid); z-index: 1; padding-right: 10px; }
  .mx td { text-align: center; }
  .off { opacity: 0.55; }
  .tn { display: inline-flex; align-items: center; gap: 8px; border: 0; background: none; color: var(--text); font-weight: 600; font-size: 13px; cursor: pointer; padding: 6px 4px; }
  .tn:hover { color: var(--c); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
  .cell { width: 100%; min-width: 46px; height: 34px; border-radius: 9px; border: 1px dashed var(--border); background: transparent; color: var(--text-3); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 4px; font-size: 12px; }
  .cell.on { border: 1px solid color-mix(in srgb, var(--ok) 35%, transparent); background: var(--ok-soft); color: var(--ok); }
  .cell.on:hover { background: color-mix(in srgb, var(--ok) 22%, transparent); }
  .cell.miss:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
  .legend { display: flex; gap: 18px; flex-wrap: wrap; font-size: 12px; }
  .lg { display: inline-block; width: 12px; height: 12px; border-radius: 4px; vertical-align: -2px; margin-right: 5px; }
  .lg.on { background: var(--ok-soft); border: 1px solid color-mix(in srgb, var(--ok) 35%, transparent); }
  .lg.miss { border: 1px dashed var(--border-strong); }
</style>
