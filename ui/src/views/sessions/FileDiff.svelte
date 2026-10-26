<script>
  // Before/after diff of one file version from Claude Code's file history.
  // 403 means the viewer role: diffs are admin-only.
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { lineDiff } from '../../lib/diff.js';
  import DiffView from '../../lib/DiffView.svelte';
  import Icon from '../../lib/Icon.svelte';
  import Skeleton from '../../lib/viz/Skeleton.svelte';

  let { session, path, backup } = $props();
  const res = resource(() => api('/api/usage/file-version', { session, backup, path }), { key: () => [session, backup, path], live: false });
  const d = $derived(res.data);
  const diff = $derived(d ? lineDiff(d.before ?? '', d.after ?? '') : null);
  const denied = $derived(res.error?.status === 403);
</script>

<div class="fd">
  {#if denied}
    <div class="msg"><Icon name="lock" size={13} /> Diffs are admin-only. Sign in with the admin token to see file contents.</div>
  {:else if res.error && !d}
    <div class="msg err"><Icon name="alert" size={13} /> {res.error.status === 404 ? 'This file version is no longer in the file history.' : res.error.message}</div>
  {:else if !d}
    <Skeleton kind="bars" count={5} label="Loading diff" />
  {:else}
    <div class="meta">
      {#if d.before == null && d.after != null}<span class="badge ok">new file</span>
      {:else if d.after == null}<span class="badge err">deleted</span>{/if}
      <span class="add tnum">+{diff.added}</span><span class="del tnum">−{diff.removed}</span>
      {#if d.truncated}<span class="badge warn" title="Large file: only part of it is shown">truncated</span>{/if}
    </div>
    {#if diff.added || diff.removed}<div class="dv"><DiffView hunks={diff.hunks} context={3} /></div>
    {:else}<div class="msg faint">No textual change in this version.</div>{/if}
  {/if}
</div>

<style>
  .fd { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .msg { display: flex; gap: 8px; align-items: center; font-size: 12.5px; color: var(--text-2); padding: 8px 10px; border-radius: 8px; background: var(--inset); }
  .msg.err { color: var(--err); background: var(--err-soft); }
  .meta { display: flex; gap: 8px; align-items: center; font-size: 12px; font-weight: 600; }
  .add { color: var(--ok); }
  .del { color: var(--err); }
  .dv { max-height: 420px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; }
</style>
