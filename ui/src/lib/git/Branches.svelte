<script>
  import { app } from '../store.svelte.js';
  import { timeAgo, toMs } from '../format.js';
  import { canRun } from '../actions.js';
  import Icon from '../Icon.svelte';
  import Empty from '../Empty.svelte';
  import { act, why } from './gx.svelte.js';
  let { branches } = $props();
  let name = $state('');
  let from = $state('');
  const local = $derived(branches?.local || []);
  const create = async () => { if (await act('git.branch.create', { name: name.trim(), from: from || undefined })) name = ''; };
</script>

<div class="g-bar">
  <input class="input" style="width:200px" placeholder="new-branch-name" bind:value={name} aria-label="New branch name" />
  <select class="input" style="width:170px" bind:value={from} aria-label="Branch from">
    <option value="">from current</option>
    {#each local as b}<option value={b.name}>{b.name}</option>{/each}
  </select>
  <button class="btn sm primary" disabled={!canRun('edit') || !name.trim()} title={why('edit')} onclick={create}><Icon name="plus" size={13} /> Create</button>
</div>

<div class="g-grid">
  <section class="card" style="padding:6px">
    <div class="g-sec">Local · {local.length}</div>
    {#each local as b (b.name)}
      <div class="g-row" style="cursor:default">
        <Icon name="branch" size={14} />
        <div class="grow col" style="gap:0">
          <div class="row" style="gap:6px"><span class="mono small ellipsis" style="font-weight:{b.current ? 650 : 500}">{b.name}</span>{#if b.current}<span class="pill hot">current</span>{/if}</div>
          {#if b.last}<span class="faint tiny ellipsis">{b.last.subject} · {timeAgo(toMs(b.last.date), app.now)}</span>{/if}
        </div>
        {#if b.upstream}<span class="pill" class:hot={b.ahead} title={b.upstream}>↑{b.ahead}</span><span class="pill" class:warn={b.behind}>↓{b.behind}</span>{/if}
        {#if b.gone}<span class="pill warn">gone</span>{/if}
        {#if !b.current}
          <span class="acts" style="opacity:1">
            <button class="btn sm" disabled={!canRun('edit')} title={why('edit')} onclick={() => act('git.branch.switch', { name: b.name })}>Switch</button>
            <button class="btn sm ghost icon" aria-label="Delete {b.name}" disabled={!canRun('danger')} title={why('danger') || 'Delete branch'} onclick={() => act('git.branch.delete', { name: b.name })}><Icon name="trash" size={13} /></button>
          </span>
        {/if}
      </div>
    {:else}<Empty icon="branch" title="No branches" />{/each}
  </section>
  <section class="card" style="padding:6px;align-self:start">
    <div class="g-sec">Remote · {branches?.remote?.length || 0}</div>
    {#each branches?.remote || [] as b (b.name)}
      <div class="g-row" style="cursor:default"><Icon name="globe" size={14} /><div class="grow col" style="gap:0"><span class="mono small ellipsis">{b.name}</span>
        {#if b.last}<span class="faint tiny ellipsis">{b.last.subject} · {timeAgo(toMs(b.last.date), app.now)}</span>{/if}</div></div>
    {:else}<div class="faint small" style="padding:10px">No remote branches.</div>{/each}
  </section>
</div>
