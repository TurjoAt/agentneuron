<script>
  // Rename / move with link-rewrite preview (POST /api/file/rename dryRun → apply).
  import { untrack } from 'svelte';
  import { post } from '../api.js';
  import { app, toast, loadFiles, fileIndex, openFile } from '../store.svelte.js';
  import { canRun, levelReason } from '../actions.svelte.js';
  import Modal from '../Modal.svelte';
  import Icon from '../Icon.svelte';

  let { path, onclose } = $props();
  // `path` seeds the editable target; comparisons below stay reactive.
  let to = $state(untrack(() => path));
  let rewrite = $state(true);
  let plan = $state(null);
  let loading = $state(false);
  let err = $state('');
  let busy = $state(false);

  const changed = $derived(to.trim() && to.trim() !== path);
  const clash = $derived(changed && fileIndex().set.has(to.trim()));
  const total = $derived((plan?.rewritten || []).reduce((a, r) => a + (r.count || 0), 0));

  let timer;
  $effect(() => {
    const target = to.trim();
    const rw = rewrite;
    clearTimeout(timer);
    plan = null;
    err = '';
    if (!target || target === path || clash) return;
    loading = true;
    timer = setTimeout(() => {
      post('/api/file/rename', { from: path, to: target, rewriteLinks: rw, dryRun: true })
        .then((r) => to.trim() === target && (plan = r))
        .catch((e) => (err = e.message))
        .finally(() => (loading = false));
    }, 300);
  });

  async function apply() {
    busy = true;
    try {
      const r = await post('/api/file/rename', { from: path, to: to.trim(), rewriteLinks: rewrite, dryRun: false });
      await loadFiles().catch(() => {});
      const n = (r?.rewritten || []).length;
      toast(`Renamed to ${to.trim()}${n ? ` · links updated in ${n} file${n === 1 ? '' : 's'}` : ''}`, 'ok');
      onclose?.();
      if (app.route.params.path === path) openFile(to.trim());
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      busy = false;
    }
  }
</script>

<Modal title="Rename or move" subtitle={path} icon="replace" tone="accent" width={560} {onclose}>
  <div class="col" style="gap:14px">
    <label class="fld">
      <span class="fl">New path</span>
      <input class="input mono" bind:value={to} spellcheck="false" data-autofocus onkeydown={(e) => e.key === 'Enter' && changed && !clash && apply()} />
      {#if clash}<span class="err small">A file already exists at that path</span>{/if}
    </label>
    <label class="row tg">
      <input type="checkbox" class="sw" bind:checked={rewrite} />
      <span class="col" style="gap:0">
        <span>Rewrite links everywhere</span>
        <span class="faint small">Markdown links, [[wiki]] links, @imports and backticked / plain path mentions in all tracked files.</span>
      </span>
    </label>
    {#if changed && !clash}
      <div class="plan">
        <div class="ph">
          <Icon name="link" size={13} />
          {#if loading}<span>Scanning references…</span>
          {:else if err}<span class="err">{err}</span>
          {:else if plan}<span><b class="tnum">{total}</b> reference{total === 1 ? '' : 's'} in <b class="tnum">{plan.rewritten?.length || 0}</b> file{plan.rewritten?.length === 1 ? '' : 's'} will be updated</span>{/if}
        </div>
        {#if plan?.rewritten?.length}
          <ul>
            {#each plan.rewritten as r (r.path)}
              <li><a class="mono" href="#/files?path={encodeURIComponent(r.path)}" data-path={r.path} onclick={onclose}>{r.path}</a><span class="faint tnum">{r.count}×</span></li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </div>
  {#snippet footer()}
    {#if !canRun('edit')}<span class="faint small grow"><Icon name="lock" size={12} /> {levelReason('edit')}</span>{:else}<span class="spacer"></span>{/if}
    <button class="btn" onclick={onclose}>Cancel</button>
    <button class="btn primary" onclick={apply} disabled={!changed || clash || busy || !canRun('edit')}><Icon name="check" size={13} /> Rename</button>
  {/snippet}
</Modal>

<style>
  .fld { display: flex; flex-direction: column; gap: 5px; }
  .fl { font-size: 12px; font-weight: 600; color: var(--text-2); }
  .tg { align-items: flex-start; gap: 12px; font-size: 13px; cursor: pointer; }
  .small { font-size: 12px; }
  .err { color: var(--err); }
  .plan { border: 1px solid var(--border); border-radius: 12px; background: var(--inset); overflow: hidden; }
  .ph { display: flex; align-items: center; gap: 8px; padding: 10px 12px; font-size: 12.5px; color: var(--text-2); }
  .plan ul { list-style: none; margin: 0; padding: 4px 6px 8px; border-top: 1px solid var(--border); max-height: 220px; overflow: auto; }
  .plan li { display: flex; justify-content: space-between; gap: 10px; padding: 4px 6px; font-size: 12.5px; }
</style>
