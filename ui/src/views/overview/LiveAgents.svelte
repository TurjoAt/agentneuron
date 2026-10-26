<script>
  // Overview widget: active agent sessions and their latest edits (full view: #/live).
  import { app, openFile, fileIndex, navigate } from '../../lib/store.svelte.js';
  import { live, colorTool, skey } from '../../lib/live.svelte.js';
  import { timeAgo, basename } from '../../lib/format.js';
  import Icon from '../../lib/Icon.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';

  const sessions = $derived(live.sessions.filter((s) => s.state === 'active' || s.state === 'start' || s.state === 'idle').slice(0, 5));
  const recent = $derived(live.edits.slice(-6).reverse());
  const editingOf = (s) => {
    let best = null;
    for (const [path, e] of Object.entries(live.editors)) if (e.sessionId === s.sessionId && e.tool === s.tool && (!best || e.ts > best.ts)) best = { path, ...e };
    return best;
  };
  const open = (p) => (fileIndex().set.has(p) ? openFile(p, { drawer: true }) : navigate('files', { path: p }));
</script>

<section class="card la">
  <div class="card-h"><Icon name="radar" size={14} /> Live agents <span class="sub">{sessions.filter((s) => s.state !== 'idle').length} active</span><span class="spacer"></span><a class="btn sm ghost" href="#/live">Open</a></div>
  <div class="card-b col">
    {#each sessions as s (skey(s))}
      {@const e = editingOf(s)}
      <div class="srow">
        <span class="sd" class:idle={s.state === 'idle'} style="--c:var(--tool-{colorTool(s.tool)})"></span>
        <span class="ellipsis grow small"><EntityLink kind="session" id={s.sessionId} label={s.title || s.promptTitle || s.sessionId.slice(0, 8)} title={s.title || s.promptTitle || s.sessionId} /></span>
        {#if e && app.now - e.ts < 120000}<button class="lnk mono tiny ellipsis" onclick={() => open(e.path)} title={e.path}>{basename(e.path)}</button>{:else}<span class="faint tiny">{s.state}</span>{/if}
      </div>
    {:else}
      <div class="faint small">No agent session is running in this project.</div>
    {/each}
    {#if recent.length}
      <div class="sep"></div>
      {#each recent as e (e.id)}
        <div class="erow">
          <span class="tool-dot" style="background:var(--tool-{colorTool(e.tool)})"></span>
          <button class="lnk ellipsis grow small" onclick={() => open(e.path)} title={e.path}>{e.path}</button>
          <span class="add tiny tnum">+{e.linesAdded || 0}</span><span class="del tiny tnum">−{e.linesRemoved || 0}</span>
          <span class="faint tiny tnum">{timeAgo(e.ts, app.now)}</span>
        </div>
      {/each}
    {/if}
  </div>
</section>

<style>
  .col { display: flex; flex-direction: column; gap: 6px; }
  .srow, .erow { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .sd { width: 7px; height: 7px; border-radius: 50%; background: var(--c); flex-shrink: 0; box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 22%, transparent); }
  .sd.idle { opacity: 0.4; box-shadow: none; }
  .sep { height: 1px; background: var(--border); margin: 4px 0; }
  .lnk { border: 0; background: none; padding: 0; color: var(--text); cursor: pointer; font: inherit; text-align: left; min-width: 0; max-width: 45%; }
  .erow .lnk { max-width: none; color: var(--text-2); }
  .lnk:hover { color: var(--accent); }
  .add { color: var(--ok); font-family: var(--mono); }
  .del { color: var(--err); font-family: var(--mono); }
</style>
