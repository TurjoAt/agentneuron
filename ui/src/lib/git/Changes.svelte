<script>
  import { api } from '../api.js';
  import { resource } from '../resource.svelte.js';
  import { canRun } from '../actions.js';
  import Icon from '../Icon.svelte';
  import Empty from '../Empty.svelte';
  import FileRow from './FileRow.svelte';
  import PatchView from './PatchView.svelte';
  import { act, gx, why, bump } from './gx.svelte.js';

  let { changes, params = {} } = $props();
  const ch = $derived(changes || { staged: [], unstaged: [], untracked: [], conflicted: [] });
  let sel = $state(null); // { path, staged }
  let msg = $state('');
  let amend = $state(false);
  let picked = $state(new Set());
  const key = (path, s) => (s ? 's:' : 'u:') + path;

  const diff = resource(() => (sel ? api('/api/git/diff', { path: sel.path, staged: sel.staged ? 1 : 0 }) : Promise.resolve(null)), { key: () => [sel?.path, sel?.staged, gx.tick] });
  const P = (f) => (typeof f === 'string' ? f : f.path);
  const total = $derived(ch.staged.length + ch.unstaged.length + ch.untracked.length + ch.conflicted.length);
  const stageable = $derived([...ch.unstaged, ...ch.untracked, ...ch.conflicted].map(P));
  const editOk = $derived(canRun('edit'));
  const dangerOk = $derived(canRun('danger'));
  const pick = (path, s) => { sel = { path, staged: s }; };
  const toggle = (k) => { const n = new Set(picked); n.has(k) ? n.delete(k) : n.add(k); picked = n; };
  const pickedPaths = (staged) => [...picked].filter((k) => k.startsWith(staged ? 's:' : 'u:')).map((k) => k.slice(2));
  async function stage(paths) { if (paths.length && (await act('git.stage', { paths }))) picked = new Set(); }
  async function unstage(paths) { if (paths.length && (await act('git.unstage', { paths }))) picked = new Set(); }
  async function discard(paths) { if (paths.length && (await act('git.discard', { paths }))) picked = new Set(); }
  async function commit() {
    const j = await act('git.commit', { message: msg.trim(), amend });
    if (j && j.status !== 'error') { msg = ''; amend = false; }
  }
  const canCommit = $derived(editOk && (amend || (msg.trim() && ch.staged.length)));
  const commitWhy = $derived(!editOk ? why('edit') : !ch.staged.length && !amend ? 'Nothing staged' : !msg.trim() && !amend ? 'Write a commit message' : '');
  $effect(() => { if (sel && !([...ch.staged, ...ch.unstaged, ...ch.untracked, ...ch.conflicted].some((f) => P(f) === sel.path))) sel = null; });
  $effect(() => { if (!sel && params?.path) sel = { path: params.path, staged: false }; });
</script>

{#if !total}
  <div class="card"><Empty icon="check" title="Working tree clean">Nothing to commit.</Empty></div>
{:else}
  <div class="g-split">
    <div class="col" style="gap:12px">
      <section class="card" style="padding:6px">
        {#snippet group(title, list, staged, kind)}
          {#if list.length}
            <div class="g-sec"><input type="checkbox" aria-label="Select all {title}" checked={list.every((f) => picked.has(key(P(f), staged)))}
              onchange={(e) => { const n = new Set(picked); list.forEach((f) => (e.currentTarget.checked ? n.add(key(P(f), staged)) : n.delete(key(P(f), staged)))); picked = n; }} />
              <span class="grow">{title} · {list.length}</span>
              {#if staged}
                <button class="btn sm ghost" disabled={!editOk} title={why('edit')} onclick={() => unstage(pickedPaths(true).length ? pickedPaths(true) : list.map(P))}>{pickedPaths(true).length ? 'Unstage selected' : 'Unstage all'}</button>
              {:else}
                <button class="btn sm ghost" disabled={!editOk} title={why('edit')} onclick={() => stage(pickedPaths(false).length ? pickedPaths(false) : list.map(P))}>{pickedPaths(false).length ? 'Stage selected' : 'Stage all'}</button>
              {/if}
            </div>
            {#each list as f (P(f))}
              <div class="row" style="gap:0"><input type="checkbox" style="margin-left:8px" aria-label="Select {P(f)}" checked={picked.has(key(P(f), staged))} onchange={() => toggle(key(P(f), staged))} />
              <div class="grow"><FileRow {f} on={sel?.path === P(f) && sel?.staged === staged} onclick={() => pick(P(f), staged)}>
                {#if staged}
                  <button class="btn sm ghost icon" aria-label="Unstage" title={editOk ? 'Unstage' : why('edit')} disabled={!editOk} onclick={() => unstage([P(f)])}><Icon name="minus" size={13} /></button>
                {:else}
                  <button class="btn sm ghost icon" aria-label="Stage" title={editOk ? 'Stage' : why('edit')} disabled={!editOk} onclick={() => stage([P(f)])}><Icon name="plus" size={13} /></button>
                  {#if kind !== 'conflict'}<button class="btn sm ghost icon" aria-label="Discard" title={dangerOk ? 'Discard changes' : why('danger')} disabled={!dangerOk} onclick={() => discard([P(f)])}><Icon name="trash" size={13} /></button>{/if}
                {/if}
              </FileRow></div></div>
            {/each}
          {/if}
        {/snippet}
        {@render group('Conflicted', ch.conflicted, false, 'conflict')}
        {@render group('Staged', ch.staged, true)}
        {@render group('Unstaged', ch.unstaged, false)}
        {@render group('Untracked', ch.untracked, false)}
        {#if stageable.length && pickedPaths(false).length}
          <div class="row" style="padding:6px 8px"><button class="btn sm" disabled={!dangerOk} title={why('danger')} onclick={() => discard(pickedPaths(false))}><Icon name="trash" size={13} /> Discard selected</button></div>
        {/if}
      </section>

      <section class="card" style="padding:12px 14px">
        <textarea class="input" placeholder={amend ? 'New message (empty keeps the previous)' : 'Commit message'} bind:value={msg} disabled={!editOk}
          onkeydown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canCommit) commit(); }}></textarea>
        <div class="row" style="margin-top:8px;flex-wrap:wrap">
          <label class="row small" style="gap:6px"><input type="checkbox" bind:checked={amend} disabled={!editOk} /> Amend last commit</label>
          <span class="grow"></span>
          <button class="btn primary sm" disabled={!canCommit} title={commitWhy} onclick={commit}><Icon name="commit" size={13} /> {amend ? 'Amend' : 'Commit'}{ch.staged.length ? ` (${ch.staged.length})` : ''}</button>
        </div>
        {#if commitWhy}<div class="hint" style="margin-top:6px">{commitWhy}</div>{/if}
      </section>
    </div>

    <section class="scroll">
      {#if !sel}
        <div class="card"><Empty icon="diff" title="Select a file">Pick a file to see its diff.</Empty></div>
      {:else}
        <div class="g-bar"><span class="mono small ellipsis grow">{sel.path}</span><span class="pill">{sel.staged ? 'staged' : 'working tree'}</span></div>
        {#if diff.error}<div class="card"><Empty icon="alert" title="Could not load diff">{diff.error.message}</Empty></div>
        {:else if diff.data === undefined}<div class="skel" style="height:140px"></div>
        {:else}<PatchView patch={diff.data?.patch || ''} empty="No textual diff (untracked or binary file)." />{/if}
      {/if}
    </section>
  </div>
{/if}
