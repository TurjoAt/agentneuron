<script>
  import { api } from '../api.js';
  import { app, navigate } from '../store.svelte.js';
  import { resource } from '../resource.svelte.js';
  import { timeAgo, toMs } from '../format.js';
  import { canRun } from '../actions.js';
  import Icon from '../Icon.svelte';
  import Empty from '../Empty.svelte';
  import { act, gx, why } from './gx.svelte.js';
  const tags = resource(() => api('/api/git/tags'), { key: () => gx.tick });
  let name = $state('');
  let message = $state('');
  const list = $derived(Array.isArray(tags.data) ? [...tags.data].sort((a, b) => toMs(b.date) - toMs(a.date)) : []);
  const create = async () => { if (await act('git.tag.create', { name: name.trim(), message: message.trim() || undefined })) { name = ''; message = ''; } };
</script>
<div class="g-bar">
  <input class="input" style="width:160px" placeholder="v1.0.0" bind:value={name} aria-label="Tag name" />
  <input class="input" style="width:240px" placeholder="Message (annotated)" bind:value={message} aria-label="Tag message" />
  <button class="btn sm primary" disabled={!canRun('edit') || !name.trim()} title={why('edit')} onclick={create}><Icon name="tag" size={13} /> Create tag</button>
</div>
<section class="card" style="padding:6px">
  {#if tags.error}<Empty icon="alert" title="Could not load tags">{tags.error.message}</Empty>
  {:else}
    {#each list as t (t.name)}
      <button class="g-row" style="width:100%;border:0;background:none;color:inherit;text-align:left" onclick={() => navigate('git', { tab: 'history', hash: t.hash })}>
        <Icon name="tag" size={14} /><span class="mono small" style="font-weight:600">{t.name}</span>
        {#if t.annotated}<span class="pill">annotated</span>{/if}
        <span class="grow ellipsis faint small">{t.subject}</span>
        <span class="hash">{t.hash?.slice(0, 7)}</span><span class="faint tiny">{timeAgo(toMs(t.date), app.now)}</span>
      </button>
    {:else}{#if tags.data}<Empty icon="tag" title="No tags">Create the first tag above.</Empty>{/if}{/each}
  {/if}
</section>
