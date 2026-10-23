<script>
  import { api } from '../api.js';
  import { resource } from '../resource.svelte.js';
  import { canRun } from '../actions.js';
  import Icon from '../Icon.svelte';
  import Empty from '../Empty.svelte';
  import { act, gx, why } from './gx.svelte.js';
  const rm = resource(() => api('/api/git/remotes'), { key: () => gx.tick });
  const list = $derived(Array.isArray(rm.data) ? rm.data : []);
  const exec = $derived(canRun('exec'));
</script>
<div class="g-bar">
  <button class="btn sm" disabled={!exec} title={why('exec')} onclick={() => act('git.fetch', {})}><Icon name="refresh" size={13} /> Fetch all</button>
  <button class="btn sm" disabled={!exec} title={why('exec')} onclick={() => act('git.pull', {})}><Icon name="download" size={13} /> Pull</button>
  <button class="btn sm" disabled={!exec} title={why('exec')} onclick={() => act('git.push', {})}><Icon name="upload" size={13} /> Push</button>
  <button class="btn sm ghost" disabled={!exec} title={why('exec')} onclick={() => act('git.push', { setUpstream: true })}>Push &amp; set upstream</button>
</div>
<section class="card" style="padding:6px">
  {#each list as r (r.name)}
    <div class="g-row" style="cursor:default;align-items:flex-start;padding:10px 8px">
      <Icon name="globe" size={14} />
      <div class="grow col" style="gap:2px"><b class="mono small">{r.name}</b>
        <span class="faint tiny mono ellipsis">fetch {r.fetch || '—'}</span><span class="faint tiny mono ellipsis">push {r.push || '—'}</span></div>
      <button class="btn sm" disabled={!exec} title={why('exec')} onclick={() => act('git.fetch', { remote: r.name })}>Fetch</button>
    </div>
  {:else}{#if rm.data}<Empty icon="globe" title="No remotes">This repository has no remotes configured.</Empty>{/if}{/each}
</section>
