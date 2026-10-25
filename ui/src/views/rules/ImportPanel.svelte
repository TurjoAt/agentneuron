<script>
  import { api, post } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { navigate, toast } from '../../lib/store.svelte.js';
  import { canRun, levelReason } from '../../lib/actions.svelte.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import { TOOL_LABEL } from './shared.js';

  let { onchange } = $props();

  const plan = resource(() => api('/api/compiler/import/preview'), { live: false });
  const canEdit = $derived(canRun('edit'));
  const why = $derived(levelReason('edit'));
  let busy = $state(false);
  let skip = $state(new Set());
  let show = $state(null);

  const rules = $derived(plan.data?.rules || []);
  function toggle(s) { const n = new Set(skip); n.has(s) ? n.delete(s) : n.add(s); skip = n; }
  async function run() {
    busy = true;
    try {
      const r = await post('/api/compiler/import', { slugs: rules.filter((x) => !skip.has(x.slug)).map((x) => x.slug) });
      toast(`Created ${r.created.length} rule(s) in ${r.dir}/${r.errors.length ? `; ${r.errors.length} failed` : ''}`, r.errors.length ? 'warn' : 'ok');
      onchange?.();
      plan.reload();
      navigate('rules', { tab: 'rules' });
    } catch (e) { toast(e.message, 'error'); }
    busy = false;
  }
</script>

<section class="card">
  <div class="card-h">
    Import from existing files <span class="sub">one rule per ## section or rule file; identical rules across tools are merged</span>
    <span class="spacer"></span>
    <button class="btn sm primary" disabled={!canEdit || busy || !rules.length || skip.size === rules.length} title={canEdit ? '' : why} onclick={run}>
      <Icon name="plus" size={12} /> Import {rules.length - skip.size} rule(s)
    </button>
  </div>
  {#if !canEdit}<div class="card-b faint small"><Icon name="lock" size={12} /> Creating rule files needs the <b>edit</b> level: {why}.</div>{/if}
  {#if plan.error}
    <Empty icon="alert" title="Could not scan">{plan.error.message}</Empty>
  {:else if !plan.data}
    <div class="card-b"><div class="skel" style="height:140px"></div></div>
  {:else if !rules.length}
    <Empty icon="check" title="Nothing new to import">Every section of your context files is already a source rule (or there are no context files yet).</Empty>
  {:else}
    <ul>
      {#each rules as r (r.slug)}
        <li class:off={skip.has(r.slug)}>
          <div class="row">
            <input type="checkbox" checked={!skip.has(r.slug)} onchange={() => toggle(r.slug)} aria-label="Import {r.slug}" />
            <b>{r.title}</b><span class="mono faint tiny">{r.slug}.md</span>
            {#each r.tools as t (t)}<span class="chip sm">{TOOL_LABEL[t] || t}</span>{/each}
            {#each r.scope as g (g)}<span class="chip sm mono">{g}</span>{/each}
            <span class="spacer"></span>
            <button class="btn sm ghost" onclick={() => (show = show === r.slug ? null : r.slug)}>{show === r.slug ? 'Hide' : 'Preview'}</button>
          </div>
          <div class="faint tiny">from {r.from.map((f) => `${f.path}:${f.line}`).join(', ')}</div>
          {#if show === r.slug}<pre class="pre mono">{r.content}</pre>{/if}
        </li>
      {/each}
    </ul>
    {#if plan.data.duplicates?.length}
      <div class="card-b faint small">Merged {plan.data.duplicates.length} duplicate section(s): {plan.data.duplicates.slice(0, 6).map((d) => `${d.from.path}:${d.from.line}`).join(', ')}{plan.data.duplicates.length > 6 ? '…' : ''}</div>
    {/if}
  {/if}
</section>

<style>
  ul { list-style: none; margin: 0; padding: 0 16px 14px; display: flex; flex-direction: column; gap: 8px; }
  li { border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; }
  li.off { opacity: 0.5; }
  .row { flex-wrap: wrap; gap: 6px; }
  .chip.sm { height: 20px; font-size: 11px; padding: 0 7px; }
  .small { font-size: 12.5px; }
  .tiny { font-size: 11px; }
  .pre { margin: 4px 0 0; padding: 10px; background: var(--inset); border-radius: 8px; font-size: 12px; white-space: pre-wrap; max-height: 300px; overflow: auto; }
</style>
