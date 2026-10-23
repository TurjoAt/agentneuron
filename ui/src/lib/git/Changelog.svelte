<script>
  import { api } from '../api.js';
  import { resource } from '../resource.svelte.js';
  import { canRun } from '../actions.js';
  import Markdown from '../Markdown.svelte';
  import Empty from '../Empty.svelte';
  import Icon from '../Icon.svelte';
  import { act, gx, why } from './gx.svelte.js';
  let from = $state('');
  const cl = resource((k) => api('/api/changelog', k?.from ? { from: k.from } : {}), { key: () => ({ from: from.trim(), t: gx.tick }) });
</script>
<div class="g-bar">
  <input class="input" style="width:200px" placeholder="From ref (tag / hash)" bind:value={from} aria-label="From ref" />
  <span class="hint">to HEAD</span>
  <button class="btn sm primary" style="margin-left:auto" disabled={!canRun('edit')} title={why('edit')} onclick={() => act('git.changelog.write', { from: from.trim() || undefined })}><Icon name="save" size={13} /> Write to CHANGELOG.md</button>
</div>
{#if cl.error}<div class="card"><Empty icon="alert" title="Could not build changelog">{cl.error.message}</Empty></div>
{:else if !cl.data}<div class="skel" style="height:200px"></div>
{:else if cl.data.available === false}<div class="card"><Empty icon="git" title="Unavailable">{cl.data.reason}</Empty></div>
{:else if !cl.data.markdown?.trim()}<div class="card"><Empty icon="list" title="Nothing to list">No commits in this range.</Empty></div>
{:else}<section class="card" style="padding:16px 20px"><div class="prose"><Markdown source={cl.data.markdown} /></div></section>{/if}
