<script>
  import { api, post } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { toast } from '../../lib/store.svelte.js';
  import { restoreTrash } from '../../lib/fileActions.js';
  import { canRun, levelReason } from '../../lib/actions.js';
  import { fmtBytes, timeAgo } from '../../lib/format.js';
  import Empty from '../../lib/Empty.svelte';
  import Icon from '../../lib/Icon.svelte';

  const trash = resource(() => api('/api/trash'), { live: false });
  const list = $derived(Array.isArray(trash.data) ? trash.data : []);
  const canRestore = $derived(canRun('edit'));
  const canPurge = $derived(canRun('danger'));
  let confirming = $state(null);
  let typed = $state('');

  async function restore(t) {
    const r = await restoreTrash(t.id);
    if (r) trash.reload();
  }
  async function purge(t) {
    try {
      await post('/api/trash/purge', { id: t.id });
      toast(`Permanently deleted ${t.path}`, 'ok');
      confirming = null; typed = '';
      trash.reload();
    } catch (e) { toast(e.message, 'error'); }
  }
</script>

<section class="card">
  <div class="card-h">Trash <span class="sub">{list.length} item{list.length === 1 ? '' : 's'}</span></div>
  {#if trash.error}
    <Empty icon="alert" title="Trash unavailable">{trash.error.message}</Empty>
  {:else if !trash.data}
    <div class="card-b"><div class="skel" style="height:100px"></div></div>
  {:else if !list.length}
    <Empty icon="trash" title="Trash is empty">Deleted files are kept here and can be restored.</Empty>
  {:else}
    <div class="card-b col" style="gap:8px">
      {#each list as t (t.id)}
        <div class="it">
          <Icon name={t.type === 'dir' ? 'folder' : 'file'} size={15} />
          <div class="grow col" style="gap:2px;min-width:0">
            <span class="mono small ellipsis">{t.path}</span>
            <span class="faint tiny">deleted {timeAgo(t.ts)}{#if t.size} · {fmtBytes(t.size)}{/if}</span>
          </div>
          {#if confirming === t.id}
            <input class="input mono" style="width:140px" placeholder="type purge" bind:value={typed} aria-label="Type purge to confirm" />
            <button class="btn sm danger" disabled={typed !== 'purge'} onclick={() => purge(t)}>Delete forever</button>
            <button class="btn sm ghost" onclick={() => ((confirming = null), (typed = ''))}>Cancel</button>
          {:else}
            <button class="btn sm" disabled={!canRestore} title={canRestore ? '' : levelReason('edit')} onclick={() => restore(t)}><Icon name="restore" size={13} /> Restore</button>
            <button class="btn sm danger" disabled={!canPurge} title={canPurge ? '' : levelReason('danger')} onclick={() => (confirming = t.id)}><Icon name="trash" size={13} /> Purge</button>
          {/if}
        </div>
      {/each}
      {#if !canPurge}<div class="faint small">Purging is a <b>danger</b>-level action. {levelReason('danger')}</div>{/if}
    </div>
  {/if}
</section>

<style>
  .it { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; flex-wrap: wrap; }
  .small { font-size: 12.5px; }
  .tiny { font-size: 11px; }
</style>
