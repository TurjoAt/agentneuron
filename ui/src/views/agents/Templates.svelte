<script>
  import { untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { runAction, actionEnabled } from '../../lib/actions.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import { toolKey } from './shared.js';

  let { initialTool = '' } = $props();
  const tpl = resource(() => api('/api/agents/templates'), { live: false });
  let cat = $state('all');
  // Seeded from the URL (?tool=), user-editable, re-synced when the URL changes.
  let toolFilter = $state(untrack(() => initialTool || ''));
  $effect(() => { const t = initialTool; untrack(() => (toolFilter = t || '')); });
  let sel = $state(null);
  let vars = $state({});
  let pathOverride = $state('');
  let preview = $state(null);
  let pErr = $state('');

  const list = $derived(Array.isArray(tpl.data) ? tpl.data : []);
  const cats = $derived(['all', ...new Set(list.map((t) => t.category))]);
  const shown = $derived(list.filter((t) => (cat === 'all' || t.category === cat) && (!toolFilter || t.tool === toolFilter)));
  const st = $derived(actionEnabled('agents.create'));

  function pick(t) {
    sel = t;
    vars = Object.fromEntries((t.vars || []).map((v) => [v.name, v.default ?? '']));
    pathOverride = '';
  }
  let seq = 0;
  $effect(() => {
    if (!sel) { preview = null; return; }
    const id = sel.id;
    const v = JSON.stringify(vars);
    const my = ++seq;
    const timer = setTimeout(async () => {
      try {
        const r = await api('/api/agents/template/render', { id, vars: v });
        if (my === seq) { preview = r; pErr = ''; }
      } catch (e) {
        if (my === seq) { preview = null; pErr = e.message; }
      }
    }, 150);
    return () => clearTimeout(timer);
  });
  async function create() {
    const params = { template: sel.id, vars: JSON.stringify(vars) };
    if (pathOverride.trim()) params.path = pathOverride.trim();
    await runAction('agents.create', params);
  }
</script>

<div class="wrap" class:two={sel}>
  <section class="card">
    <div class="card-h">Templates <span class="sub">{shown.length} of {list.length}</span></div>
    <div class="card-b filters">
      {#each cats as c (c)}<button class="chip" class:on={cat === c} onclick={() => (cat = c)}>{c}</button>{/each}
      {#if toolFilter}<button class="chip on" onclick={() => (toolFilter = '')}>tool: {toolFilter} <Icon name="x" size={11} /></button>{/if}
    </div>
    {#if tpl.error}
      <Empty icon="alert" title="Templates unavailable">{tpl.error.message}</Empty>
    {:else if !tpl.data}
      <div class="card-b"><div class="skel" style="height:140px"></div></div>
    {:else}
      <div class="gal">
        {#each shown as t (t.id)}
          <button class="tc" class:on={sel?.id === t.id} style="--c:var(--tool-{toolKey(t.tool)})" onclick={() => pick(t)}>
            <div class="row" style="gap:7px"><span class="d"></span><b>{t.name}</b><span class="spacer"></span><span class="badge">{t.category}</span></div>
            <div class="muted small">{t.description}</div>
            <code class="mono tiny faint ellipsis">{t.defaultPath}</code>
          </button>
        {:else}
          <div class="faint small" style="padding:10px">No templates match.</div>
        {/each}
      </div>
    {/if}
  </section>

  {#if sel}
    <section class="card form">
      <div class="card-h">{sel.name}<span class="spacer"></span><button class="btn sm ghost icon" aria-label="Close" onclick={() => (sel = null)}><Icon name="x" size={14} /></button></div>
      <div class="card-b col" style="gap:10px">
        {#each sel.vars || [] as v (v.name)}
          <label class="fld"><span class="eyebrow">{v.label || v.name}</span><input class="input" bind:value={vars[v.name]} placeholder={v.default ?? ''} /></label>
        {/each}
        <label class="fld"><span class="eyebrow">Path</span><input class="input mono" bind:value={pathOverride} placeholder={preview?.path || sel.defaultPath} /></label>
        <div class="eyebrow">Preview <span class="faint mono">{preview?.path || ''}</span></div>
        {#if pErr}<div class="faint small">{pErr}</div>{:else}<pre class="pv">{preview?.content ?? '…'}</pre>{/if}
        <div class="row" style="gap:10px;flex-wrap:wrap">
          <button class="btn primary" disabled={!st.enabled} title={st.enabled ? '' : st.reason} onclick={create}><Icon name="plus" size={14} /> Create file</button>
          {#if !st.enabled}<span class="faint small">{st.reason}</span>{/if}
        </div>
      </div>
    </section>
  {/if}
</div>

<style>
  .wrap { display: grid; grid-template-columns: 1fr; gap: 14px; align-items: start; }
  .wrap.two { grid-template-columns: minmax(0, 1.2fr) minmax(320px, 1fr); }
  .filters { display: flex; gap: 6px; flex-wrap: wrap; padding-top: 0; }
  .chip { text-transform: capitalize; }
  .gal { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; padding: 0 16px 16px; }
  .tc { text-align: left; border: 1px solid var(--border); border-radius: 12px; padding: 12px 13px; background: var(--panel-hover); color: inherit; display: flex; flex-direction: column; gap: 6px; cursor: pointer; min-width: 0; transition: border-color 0.2s, transform 0.2s var(--ease); }
  .tc:hover { border-color: color-mix(in srgb, var(--c) 50%, var(--border)); transform: translateY(-1px); }
  .tc.on { border-color: var(--c); box-shadow: 0 0 0 1px var(--c) inset; }
  .d { width: 8px; height: 8px; border-radius: 50%; background: var(--c); flex-shrink: 0; }
  .small { font-size: 12.5px; }
  .tiny { font-size: 11px; }
  .fld { display: flex; flex-direction: column; gap: 4px; }
  .pv { margin: 0; max-height: 300px; overflow: auto; padding: 10px 12px; border-radius: 10px; background: var(--inset); border: 1px solid var(--border); font-family: var(--mono); font-size: 12px; white-space: pre-wrap; word-break: break-word; }
  @media (max-width: 900px) { .wrap.two { grid-template-columns: 1fr; } }
</style>
