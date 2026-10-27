<script>
  // Checkpoints: timeline of working-tree snapshots, per-file comparison with now, and a selective restore
  // flow (pick files -> preview -> confirm). Restore is level danger and goes through the action dialog.
  import { api, post } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { app, toast, navigate } from '../../lib/store.svelte.js';
  import { runAction, actionEnabled } from '../../lib/actions.js';
  import { timeAgo, fmtDate, basename, dirname } from '../../lib/format.js';
  import { lineDiff } from '../../lib/diff.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';
  import DiffView from '../../lib/DiffView.svelte';
  import Skeleton from '../../lib/viz/Skeleton.svelte';
  import { CP_STATUS, RESTORE_LABEL, actionFor, plural } from './shared.js';

  let { params = {}, go } = $props();
  const list = resource(() => api('/api/changes/checkpoints'));
  const cps = $derived(Array.isArray(list.data?.checkpoints) ? list.data.checkpoints : []);
  const sel = $derived(params.id || '');
  const detail = resource((id) => (id ? api('/api/changes/checkpoint', { id }) : Promise.resolve(null)), { key: () => sel });
  const files = $derived(Array.isArray(detail.data?.files) ? detail.data.files : []);
  const diffable = $derived(files.filter((f) => f.status !== 'same'));

  const canCreate = $derived(actionEnabled('changes.checkpoint.create'));
  const canRestore = $derived(actionEnabled('changes.checkpoint.restore'));
  const canDelete = $derived(actionEnabled('changes.checkpoint.delete'));

  let picked = $state(new Set());
  let step = $state('pick'); // pick | preview
  let plan = $state(null);
  let planning = $state(false);
  let viewing = $state('');
  $effect(() => { void sel; picked = new Set(); step = 'pick'; plan = null; viewing = ''; });

  const diff = resource((k) => (k.id && k.path ? api('/api/changes/checkpoint/diff', k) : Promise.resolve(null)), { key: () => ({ id: sel, path: viewing }), live: false });
  const hunks = $derived(diff.data ? lineDiff(diff.data.before ?? '', diff.data.after ?? '').hunks : []);

  const togglePick = (p) => { const s = new Set(picked); s.has(p) ? s.delete(p) : s.add(p); picked = s; };
  const allPicked = $derived(diffable.length > 0 && diffable.every((f) => picked.has(f.path)));
  const pickAll = () => { picked = allPicked ? new Set() : new Set(diffable.map((f) => f.path)); };

  async function create() {
    const job = await runAction('changes.checkpoint.create', {}, { title: 'Create checkpoint' });
    if (job?.status === 'ok') { toast(`Checkpoint ${job.result?.id || ''} created`, 'ok'); list.reload(); if (job.result?.id) go({ id: job.result.id }); }
  }
  async function preview() {
    const paths = [...picked];
    planning = true;
    try {
      const r = await post('/api/actions/preview', { id: 'changes.checkpoint.restore', params: { id: sel, paths } });
      plan = Array.isArray(r?.files) ? r.files : null;
    } catch { plan = null; }
    if (!plan) plan = paths.map((p) => ({ path: p, action: actionFor(files.find((f) => f.path === p)?.status) }));
    planning = false;
    step = 'preview';
  }
  async function restore() {
    const paths = plan.filter((f) => f.action !== 'skip').map((f) => f.path);
    if (!paths.length) return;
    const job = await runAction('changes.checkpoint.restore', { id: sel, paths }, { title: `Restore ${plural(paths.length, 'file')}`, description: 'Only these files are overwritten, re-created or deleted. HEAD, the index, branches and every other file stay as they are. The current state is saved as an automatic checkpoint first.' });
    if (job?.status === 'ok') {
      toast(`Restored ${plural(job.result?.restored?.length ?? paths.length, 'file')}${job.result?.undo ? `; undo point ${job.result.undo.id}` : ''}`, 'ok', 6000);
      picked = new Set(); step = 'pick'; plan = null;
      detail.reload(); list.reload();
    }
  }
  async function remove(c) {
    const job = await runAction('changes.checkpoint.delete', { id: c.id }, { title: 'Delete checkpoint' });
    if (job?.status === 'ok') { if (sel === c.id) go({ id: undefined }); list.reload(); }
  }
  const SRC_TONE = { manual: 'accent', auto: 'info', task: 'ok' };
  const n = (a) => plan?.filter((f) => f.action === a).length || 0;
</script>

<div class="head">
  <p class="faint small intro">Snapshots of the working tree (tracked and untracked files) saved as git refs. Restoring is selective: pick files, preview, confirm.</p>
  <span class="grow"></span>
  <button class="btn primary sm" onclick={create} disabled={!canCreate.enabled} title={canCreate.enabled ? 'Snapshot the working tree now' : canCreate.reason}><Icon name="plus" size={13} /> Create checkpoint</button>
</div>
{#if !canCreate.enabled}
  <p class="hint small"><Icon name="lock" size={12} /> Creating checkpoints is off: {canCreate.reason}. <button class="linkish" onclick={() => navigate('settings', { tab: 'permissions' })}>Permissions</button></p>
{/if}

{#if list.error && !list.data}
  <div class="card"><Empty icon="alert" title="Could not load checkpoints">{list.error.message}</Empty></div>
{:else if !list.data}
  <section class="card"><div class="card-b pad"><Skeleton kind="table" /></div></section>
{:else if !cps.length}
  <div class="card"><Empty icon="history" title="No checkpoints yet">Create one before letting an agent loose on a big change: <code>agentneuron checkpoint create --label "before refactor"</code> or the button above.</Empty></div>
{:else}
  <div class="layout">
    <section class="card tl">
      <div class="card-h">Timeline <span class="sub">{cps.length}</span></div>
      <ol class="timeline">
        {#each cps as c (c.id)}
          <li class:on={sel === c.id}>
            <span class="pin {SRC_TONE[c.source]}"></span>
            <button class="cp" onclick={() => go({ id: sel === c.id ? undefined : c.id })} aria-pressed={sel === c.id}>
              <span class="lbl">{c.label || 'Untitled checkpoint'}</span>
              <span class="faint tiny" title={fmtDate(c.createdAt)}>{timeAgo(c.createdAt, app.now)} · {plural(c.files.length, 'file')}{c.filesTruncated ? '+' : ''}</span>
            </button>
            <div class="meta">
              <span class="badge {SRC_TONE[c.source]} xs">{c.source}</span>
              {#if c.task}<EntityLink kind="task" id={c.task} class="tiny" />{/if}
              {#if c.base}<EntityLink kind="commit" id={c.base} label={c.base.slice(0, 7)} mono class="tiny" />{/if}
              {#if c.branch}<span class="faint tiny mono">{c.branch}</span>{/if}
              <span class="grow"></span>
              <button class="btn ghost sm icon" onclick={() => remove(c)} disabled={!canDelete.enabled} title={canDelete.enabled ? 'Delete checkpoint' : canDelete.reason} aria-label="Delete checkpoint {c.label || c.id}"><Icon name="trash" size={13} /></button>
            </div>
          </li>
        {/each}
      </ol>
    </section>

    <section class="card det">
      {#if !sel}
        <Empty compact icon="history" title="Pick a checkpoint">Compare it with the working tree and restore single files.</Empty>
      {:else if detail.error && !detail.data}
        <Empty compact icon="alert" title="Could not compare">{detail.error.message}</Empty>
      {:else if !detail.data}
        <div class="card-b pad"><Skeleton kind="table" /></div>
      {:else}
        {@const cp = detail.data.checkpoint}
        <div class="card-h">
          <span class="ellipsis">{cp.label || 'Untitled checkpoint'}</span>
          <span class="sub mono">{cp.id}</span>
        </div>
        {#if step === 'preview'}
          <div class="card-b">
            <p class="small">Restoring from <b>{cp.label || cp.id}</b> will:</p>
            <ul class="plan">
              {#each plan as f (f.path)}
                <li class:skip={f.action === 'skip'}>
                  <span class="badge xs {f.action === 'delete' ? 'err' : f.action === 'skip' ? '' : 'warn'}">{RESTORE_LABEL[f.action] || f.action}</span>
                  <span class="mono grow pp">{f.path}</span>
                  {#if f.reason}<span class="faint tiny">{f.reason}</span>{/if}
                </li>
              {/each}
            </ul>
            <p class="faint tiny">{n('overwrite')} overwritten, {n('create')} re-created, {n('delete')} deleted. Nothing else changes; an undo checkpoint is taken first.</p>
            <div class="row actions">
              <button class="btn sm" onclick={() => (step = 'pick')}>Back</button>
              <button class="btn danger sm" onclick={restore} disabled={!canRestore.enabled || !plan.some((f) => f.action !== 'skip')} title={canRestore.enabled ? '' : canRestore.reason}><Icon name="restore" size={13} /> Restore {plural(plan.filter((f) => f.action !== 'skip').length, 'file')}</button>
            </div>
            {#if !canRestore.enabled}<p class="hint small"><Icon name="lock" size={12} /> Restore is level danger: {canRestore.reason}.</p>{/if}
          </div>
        {:else}
          {#if !diffable.length}
            <div class="card-b"><p class="faint small"><Icon name="check" size={12} /> The working tree matches this checkpoint{files.length ? ` for its ${plural(files.length, 'file')}` : ''}.</p></div>
          {:else}
            <div class="selbar">
              <label class="row small"><input type="checkbox" checked={allPicked} onchange={pickAll} /> All {diffable.length} changed</label>
              <span class="grow"></span>
              <button class="btn sm" onclick={preview} disabled={!picked.size || planning}><Icon name="eye" size={13} /> Preview restore{picked.size ? ` (${picked.size})` : ''}</button>
            </div>
          {/if}
          <ul class="cfiles">
            {#each files as f (f.path)}
              <li class:same={f.status === 'same'} class:viewing={viewing === f.path}>
                <input type="checkbox" aria-label="Restore {f.path}" disabled={f.status === 'same'} checked={picked.has(f.path)} onchange={() => togglePick(f.path)} />
                <span class="badge {CP_STATUS[f.status]} xs st">{f.status}</span>
                <button class="fname" onclick={() => (viewing = viewing === f.path ? '' : f.path)} disabled={f.status === 'same'} title={f.status === 'same' ? 'Unchanged since the checkpoint' : 'Show the difference'}>
                  <span class="bn">{basename(f.path)}</span>{#if dirname(f.path)}<span class="dn faint"> {dirname(f.path)}/</span>{/if}
                </button>
                {#if f.added || f.removed}<span class="tnum tiny"><span class="add">+{f.added}</span> <span class="del">−{f.removed}</span></span>{/if}
              </li>
              {#if viewing === f.path}
                <li class="dv">
                  {#if diff.error}
                    <p class="small faint"><Icon name="lock" size={12} /> {diff.error.status === 403 ? 'File content is admin-only. Sign in as admin (or set live.viewerDiffs) to see it.' : diff.error.message}</p>
                  {:else if !diff.data}
                    <Skeleton kind="table" />
                  {:else if diff.data.binary}
                    <p class="small faint">Binary file: no text diff.</p>
                  {:else}
                    <div class="dlabels faint tiny"><span>checkpoint</span><Icon name="chevron" size={10} /><span>now</span>{#if diff.data.truncated}<span class="badge warn xs">truncated</span>{/if}</div>
                    <DiffView {hunks} />
                  {/if}
                </li>
              {/if}
            {/each}
          </ul>
          {#if detail.data.truncated}<p class="faint tiny pad2">Only the first 2000 files are listed.</p>{/if}
        {/if}
      {/if}
    </section>
  </div>
{/if}

<style>
  .head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
  .intro { margin: 0; max-width: 620px; }
  .hint { display: flex; align-items: center; gap: 6px; color: var(--text-3); margin: -4px 0 12px; flex-wrap: wrap; }
  .linkish { background: none; border: 0; padding: 0; color: var(--accent); cursor: pointer; font: inherit; }
  .linkish:hover { text-decoration: underline; }
  .pad { padding-top: 14px; }
  .pad2 { padding: 0 14px 12px; margin: 0; }
  .tiny { font-size: 11px; }
  .layout { display: grid; grid-template-columns: minmax(240px, 340px) minmax(0, 1fr); gap: 14px; align-items: start; }
  .timeline { list-style: none; margin: 0; padding: 4px 12px 12px 28px; position: relative; }
  .timeline::before { content: ''; position: absolute; left: 17px; top: 8px; bottom: 16px; width: 2px; background: var(--border-strong); border-radius: 2px; }
  .timeline li { position: relative; padding: 8px 8px 8px 6px; border-radius: 10px; margin-bottom: 4px; }
  .timeline li.on { background: var(--panel-active); }
  .pin { position: absolute; left: -16px; top: 13px; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 3px var(--panel-solid); }
  .pin.info { background: var(--info); } .pin.ok { background: var(--ok); }
  .cp { display: flex; flex-direction: column; gap: 2px; background: none; border: 0; padding: 0; text-align: left; color: inherit; cursor: pointer; width: 100%; font: inherit; }
  .cp:hover .lbl { color: var(--accent); }
  .lbl { font-weight: 600; font-size: 13px; overflow-wrap: anywhere; }
  .meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
  .det { min-height: 160px; }
  .selbar { display: flex; align-items: center; gap: 8px; padding: 0 14px 10px; flex-wrap: wrap; }
  .cfiles { list-style: none; margin: 0; padding: 0 0 8px; }
  .cfiles li { display: flex; align-items: center; gap: 8px; padding: 6px 14px; border-top: 1px solid var(--border); min-width: 0; }
  .cfiles li.same { opacity: 0.6; }
  .cfiles li.viewing { background: var(--panel-hover); }
  .cfiles li.dv { display: block; padding: 8px 14px 12px; background: var(--panel-hover); }
  .st { min-width: 58px; justify-content: center; }
  .fname { background: none; border: 0; padding: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 12.5px; }
  .fname:disabled { cursor: default; }
  .fname:not(:disabled):hover .bn { color: var(--accent); }
  .bn { font-weight: 600; }
  .dn { font-size: 11.5px; margin-left: 4px; }
  .add { color: var(--ok); } .del { color: var(--err); }
  .dlabels { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  .plan { list-style: none; margin: 8px 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
  .plan li { display: flex; align-items: center; gap: 8px; font-size: 12.5px; min-width: 0; }
  .plan li.skip { opacity: 0.6; }
  .pp { overflow-wrap: anywhere; }
  .actions { margin-top: 10px; gap: 8px; flex-wrap: wrap; }
  @media (max-width: 860px) { .layout { grid-template-columns: minmax(0, 1fr); } }
  @media (max-width: 480px) { .st { min-width: 0; } }
</style>
