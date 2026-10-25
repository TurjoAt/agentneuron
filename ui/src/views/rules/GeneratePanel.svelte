<script>
  import { untrack } from 'svelte';
  import { api, post } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { openFile, toast } from '../../lib/store.svelte.js';
  import { canRun, levelReason } from '../../lib/actions.svelte.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';

  let { initialTool = 'agents' } = $props();
  const TOOLS = [['agents', 'AGENTS.md'], ['claude', 'CLAUDE.md'], ['gemini', 'GEMINI.md'], ['copilot', 'Copilot'], ['cursor', 'Cursor .mdc'], ['windsurf', 'Windsurf']];

  let tool = $state(untrack(() => initialTool));
  let view = $state('cited');
  let overwrite = $state(false);
  let busy = $state(false);
  const gen = resource((t) => api('/api/compiler/generate', { tool: t }), { key: () => tool, live: false });
  const g = $derived(gen.data);
  const canEdit = $derived(canRun('edit'));
  const why = $derived(levelReason('edit'));
  const sections = $derived.by(() => {
    const m = new Map();
    for (const it of g?.items || []) { if (!m.has(it.section)) m.set(it.section, []); m.get(it.section).push(it); }
    return [...m];
  });

  async function write() {
    busy = true;
    try {
      const r = await post('/api/compiler/generate/write', { tool, overwrite, baseHash: g?.currentHash || undefined });
      toast(`${r.created ? 'Created' : 'Replaced'} ${r.path}`, 'ok');
      gen.reload();
      openFile(r.path, { drawer: true });
    } catch (e) { toast(e.message, 'error'); }
    busy = false;
  }
</script>

<section class="card">
  <div class="card-h">
    Generate from code <span class="sub">a starter context file built only from what the project shows</span>
    <span class="spacer"></span>
    <div class="segc" role="group" aria-label="Target tool">
      {#each TOOLS as [id, label] (id)}<button class:on={tool === id} onclick={() => (tool = id)}>{label}</button>{/each}
    </div>
  </div>
  {#if gen.error}
    <Empty icon="alert" title="Could not analyse the project">{gen.error.message}</Empty>
  {:else if !g}
    <div class="card-b"><div class="skel" style="height:220px"></div></div>
  {:else}
    <div class="card-b row wrap">
      <span class="mono small">{g.path}</span>
      {#if g.exists}<span class="chip sm warn">exists</span>{/if}
      <span class="faint tiny">{g.items.length} line(s), each with a source citation</span>
      <span class="spacer"></span>
      <div class="segc" role="group" aria-label="Preview mode">
        <button class:on={view === 'cited'} onclick={() => (view = 'cited')}>Citations</button>
        <button class:on={view === 'raw'} onclick={() => (view = 'raw')}>Markdown</button>
      </div>
      {#if g.exists}<label class="faint small"><input type="checkbox" bind:checked={overwrite} /> replace existing</label>{/if}
      <button class="btn sm primary" disabled={!canEdit || busy || (g.exists && !overwrite)} title={!canEdit ? why : g.exists && !overwrite ? 'The file exists: tick "replace existing" first' : ''} onclick={write}>
        <Icon name="check" size={12} /> {g.exists ? 'Replace' : 'Create'} {g.path.split('/').pop()}
      </button>
    </div>
    {#if !canEdit}<div class="card-b faint small"><Icon name="lock" size={12} /> Preview only. Writing the file needs the <b>edit</b> level: {why}.</div>{/if}
    {#if view === 'raw'}
      <pre class="pre mono">{g.content}</pre>
    {:else if !sections.length}
      <Empty icon="info" title="Nothing detected">No manifests, scripts or known folders were found, so there is nothing to write without guessing.</Empty>
    {:else}
      <div class="card-b col">
        {#each sections as [name, items] (name)}
          <div class="sec">
            <div class="h">{name}</div>
            {#each items as it, i (i)}
              <div class="it"><span class="tx">{#each it.text.split('`') as part, j (j)}{#if j % 2}<code>{part}</code>{:else}{part}{/if}{/each}</span><span class="src mono" title="Source">{it.source}</span></div>
            {/each}
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</section>

<style>
  .wrap { flex-wrap: wrap; gap: 8px; }
  .chip.sm { height: 20px; font-size: 11px; padding: 0 7px; }
  .chip.warn { color: var(--warn); background: var(--warn-soft); }
  .small { font-size: 12.5px; }
  .tiny { font-size: 11px; }
  .pre { margin: 0 16px 16px; padding: 12px; background: var(--inset); border-radius: 8px; font-size: 12px; white-space: pre-wrap; max-height: 60vh; overflow: auto; }
  .sec { display: flex; flex-direction: column; gap: 4px; }
  .h { font-weight: 650; font-size: 13px; margin-top: 4px; }
  .it { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; padding: 4px 8px; border-radius: 6px; font-size: 12.5px; }
  .it:hover { background: var(--panel-hover); }
  .tx code { font-family: var(--mono); font-size: 0.92em; background: var(--inset); padding: 0 4px; border-radius: 4px; }
  .src { color: var(--text-3); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 280px; }
</style>
