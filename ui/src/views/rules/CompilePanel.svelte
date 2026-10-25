<script>
  import { post } from '../../lib/api.js';
  import { openFile, toast } from '../../lib/store.svelte.js';
  import { canRun, levelReason } from '../../lib/actions.svelte.js';
  import DiffView from '../../lib/DiffView.svelte';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import { hunksOf, ACTION_LABEL, TOOL_LABEL, TOOL_IDS } from './shared.js';

  let { preview, onchange } = $props();

  const p = $derived(preview.data);
  const canEdit = $derived(canRun('edit'));
  const why = $derived(levelReason('edit'));
  let only = $state(new Set()); // tool filter (empty = all)
  let open = $state(null); // output path showing its diff
  let pick = $state({}); // slug -> chosen copy for conflicting merge-backs
  let busy = $state('');

  const outputs = $derived((p?.outputs || []).filter((o) => !only.size || only.has(o.tool)));
  const changed = $derived(outputs.filter((o) => o.action !== 'none' || o.conflicts?.length || o.error || o.regions?.some((r) => /edited/.test(r.status))));
  const tools = $derived([...only]);
  const edited = $derived(p?.edited || []);

  function toggle(t) { const s = new Set(only); s.has(t) ? s.delete(t) : s.add(t); only = s; }
  async function compile(force = false) {
    busy = 'compile';
    try {
      const r = await post('/api/compiler/compile', { tools: tools.length ? tools : undefined, force });
      toast(`Wrote ${r.written.length} file(s)${r.deleted.length ? `, trashed ${r.deleted.length}` : ''}${r.errors.length ? `, ${r.errors.length} error(s)` : ''}`, r.errors.length ? 'warn' : 'ok');
      onchange?.();
    } catch (e) { toast(e.message, 'error'); }
    busy = '';
  }
  async function mergeBack() {
    busy = 'merge';
    try {
      const r = await post('/api/compiler/merge-back', { pick, tools: tools.length ? tools : undefined });
      toast(`Merged ${r.merged.length} rule(s) back${r.skipped.length ? `; skipped ${r.skipped.map((s) => s.slug).join(', ')}` : ''}`, r.skipped.length ? 'warn' : 'ok');
      onchange?.();
    } catch (e) { toast(e.message, 'error'); }
    busy = '';
  }
</script>

<div class="stack">
  <section class="card">
    <div class="card-h">
      Compile preview
      {#if p}<span class="sub">{p.ok ? 'every output is in sync' : `${p.stale} file(s) to write${edited.length ? ` · ${edited.length} region(s) edited by hand` : ''}`}</span>{/if}
      <span class="spacer"></span>
      <button class="btn sm ghost" onclick={() => preview.reload()} aria-label="Refresh preview"><Icon name="restore" size={12} /></button>
    </div>
    <div class="card-b row wrap">
      <span class="faint small">Tools:</span>
      {#each TOOL_IDS as t (t)}<button class="chip" class:on={only.has(t)} onclick={() => toggle(t)}>{TOOL_LABEL[t]}</button>{/each}
      <span class="spacer"></span>
      <button class="btn sm primary" disabled={!canEdit || !!busy || !p || p.stale === 0} title={canEdit ? '' : why} onclick={() => compile(false)}>
        <Icon name="zap" size={12} /> {busy === 'compile' ? 'Compiling…' : 'Compile'}
      </button>
    </div>
    {#if !canEdit}<div class="card-b faint small"><Icon name="lock" size={12} /> Compiling writes project files, so it needs the <b>edit</b> level: {why}.</div>{/if}
    {#if preview.error}
      <Empty icon="alert" title="Could not plan the compile">{preview.error.message}</Empty>
    {:else if !p}
      <div class="card-b"><div class="skel" style="height:160px"></div></div>
    {:else if !p.rules.length}
      <Empty icon="file" title="No source rules">Add rules in the Source rules tab or import them from your existing context files.</Empty>
    {:else}
      {#each p.invalid as i (i.file)}<div class="card-b bad small"><Icon name="alert" size={12} /> <span class="mono">{i.file}</span>: {i.errors.join('; ')}</div>{/each}
      {#if !changed.length}<div class="card-b faint small">Nothing to do: every compiled file matches its source rules.</div>{/if}
      <ul class="outs">
        {#each changed as o (o.path)}
          <li>
            <div class="row o">
              <span class="act {o.action}">{ACTION_LABEL[o.action] || o.action}</span>
              <button class="lnk mono" onclick={() => (open = open === o.path ? null : o.path)}>{o.path}</button>
              <span class="faint tiny">{TOOL_LABEL[o.tool] || o.tool}</span>
              {#if o.added || o.removed}<span class="tiny tnum"><span class="add">+{o.added || 0}</span> <span class="del">−{o.removed || 0}</span></span>{/if}
              <span class="spacer"></span>
              {#each o.regions.filter((r) => r.status !== 'ok') as r (r.source)}<span class="rg {r.status}" title={r.source}>{r.slug || r.source}: {r.status}</span>{/each}
              {#if o.action !== 'create' && o.action !== 'delete'}<button class="btn sm ghost" onclick={() => openFile(o.path, { drawer: true })} aria-label="Open file"><Icon name="external" size={12} /></button>{/if}
            </div>
            {#each [...(o.conflicts || []), ...(o.error ? [o.error] : [])] as c (c)}<div class="bad small">{c}</div>{/each}
            {#if open === o.path && o.diff}<div class="dv"><DiffView hunks={hunksOf(o.diff)} /></div>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if p?.mergeBack?.length || edited.length}
    <section class="card">
      <div class="card-h">
        Merge back <span class="sub">edits made inside generated regions</span>
        <span class="spacer"></span>
        <button class="btn sm primary" disabled={!canEdit || !!busy || !p.mergeBack.length} title={canEdit ? '' : why} onclick={mergeBack}>
          <Icon name="merge" size={12} /> {busy === 'merge' ? 'Merging…' : 'Merge back'}
        </button>
        <button class="btn sm danger" disabled={!canEdit || !!busy} title={canEdit ? 'Regenerate and discard the hand edits' : why} onclick={() => compile(true)}>Discard edits</button>
      </div>
      <div class="card-b col">
        <div class="faint small">Merge back copies the edited text into the source rule, then recompiles every tool from it. Text outside the markers is never touched.</div>
        {#each p.mergeBack as m (m.slug)}
          <div class="mb">
            <div class="row">
              <b class="mono small">{m.file}</b><span class="faint tiny">from {m.paths.join(', ')}</span>
              {#if m.conflict}
                <span class="rg edited">copies differ</span>
                <select bind:value={pick[m.slug]} aria-label="Copy to keep">
                  <option value={undefined}>choose a copy…</option>
                  {#each m.paths as path (path)}<option value={path}>{path}</option>{/each}
                </select>
              {/if}
            </div>
            {#if m.diff}<div class="dv"><DiffView hunks={hunksOf(m.diff)} /></div>{/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .stack { display: flex; flex-direction: column; gap: 14px; }
  .wrap { flex-wrap: wrap; gap: 6px; }
  .outs { list-style: none; margin: 0; padding: 0 16px 14px; display: flex; flex-direction: column; gap: 8px; }
  .outs li { border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
  .o { flex-wrap: wrap; gap: 8px; }
  .act { font-size: 11px; font-weight: 650; padding: 1px 7px; border-radius: 99px; background: var(--panel-hover); color: var(--text-3); }
  .act.create { color: var(--ok); background: var(--ok-soft); }
  .act.update { color: var(--accent); background: var(--accent-soft); }
  .act.delete, .act.skip { color: var(--err); background: var(--err-soft); }
  .rg { font-size: 11px; padding: 1px 6px; border-radius: 6px; background: var(--panel-hover); color: var(--text-3); }
  .rg.stale, .rg.new, .rg.rehash { color: var(--warn); background: var(--warn-soft); }
  .rg.edited, .rg.orphan-edited { color: var(--err); background: var(--err-soft); }
  .lnk { border: 0; background: none; padding: 0; color: var(--text); cursor: pointer; font-size: 12.5px; }
  .lnk:hover { color: var(--accent); }
  .add { color: var(--ok); }
  .del { color: var(--err); }
  .bad { color: var(--err); }
  .small { font-size: 12.5px; }
  .tiny { font-size: 11px; }
  .dv { max-height: 380px; overflow: auto; border-radius: 8px; }
  .mb { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--border); padding-top: 10px; }
  select { height: 26px; border-radius: 7px; border: 1px solid var(--border); background: var(--inset); color: var(--text); font-size: 12px; }
</style>
