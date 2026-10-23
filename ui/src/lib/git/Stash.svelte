<script>
  import { api } from '../api.js';
  import { app } from '../store.svelte.js';
  import { resource } from '../resource.svelte.js';
  import { timeAgo, toMs } from '../format.js';
  import { canRun } from '../actions.js';
  import Icon from '../Icon.svelte';
  import Empty from '../Empty.svelte';
  import { act, gx, why } from './gx.svelte.js';
  const st = resource(() => api('/api/git/stash'), { key: () => gx.tick });
  let message = $state('');
  const list = $derived(Array.isArray(st.data) ? st.data : []);
  const push = async () => { if (await act('git.stash.push', { message: message.trim() || undefined })) message = ''; };
</script>
<div class="g-bar">
  <input class="input" style="width:280px" placeholder="Stash message (optional)" bind:value={message} aria-label="Stash message" />
  <button class="btn sm primary" disabled={!canRun('edit')} title={why('edit')} onclick={push}><Icon name="archive" size={13} /> Stash changes</button>
</div>
<section class="card" style="padding:6px">
  {#each list as s (s.ref)}
    <div class="g-row" style="cursor:default">
      <Icon name="archive" size={14} /><span class="pill mono">{s.ref}</span>
      <span class="grow ellipsis small">{s.message}</span><span class="faint tiny">{timeAgo(toMs(s.date), app.now)}</span>
      <span class="acts" style="opacity:1">
        <button class="btn sm" disabled={!canRun('edit')} title={why('edit')} onclick={() => act('git.stash.pop', { index: s.index })}>Pop</button>
        <button class="btn sm ghost icon" aria-label="Drop {s.ref}" disabled={!canRun('danger')} title={why('danger') || 'Drop'} onclick={() => act('git.stash.drop', { index: s.index })}><Icon name="trash" size={13} /></button>
      </span>
    </div>
  {:else}{#if st.data}<Empty icon="archive" title="No stashes">Stash parks uncommitted changes for later.</Empty>{/if}{/each}
</section>
