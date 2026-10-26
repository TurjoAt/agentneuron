<script>
  // One live item in a swimlane: an agent edit (expandable masked diff) or a command.
  import { app, openFile, navigate, fileIndex } from '../../lib/store.svelte.js';
  import { timeAgo, basename, dirname, fmtTime } from '../../lib/format.js';
  import Icon from '../../lib/Icon.svelte';
  import DiffView from '../../lib/DiffView.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';

  let { item, session = null, collide = false } = $props();
  let open = $state(false);

  const OP = { edit: ['edit', 'edited'], write: ['save', 'wrote'], create: ['plus', 'created'], delete: ['minus', 'deleted'], patch: ['split', 'patched'] };
  const isCmd = $derived(item.cmd !== undefined);
  const op = $derived(OP[item.op] || OP.edit);
  const tracked = $derived(!isCmd && fileIndex().set.has(item.path));
  const who = $derived(session?.title || session?.promptTitle || (item.sessionId ? item.sessionId.slice(0, 8) : item.tool === 'human' ? 'no agent transcript' : ''));

  function openIt(e) {
    e.stopPropagation();
    if (item.op === 'delete') return;
    if (tracked) openFile(item.path, { drawer: true });
    else navigate('files', { path: item.path });
  }
</script>

{#if isCmd}
  <div class="it cmd" class:fail={item.exitCode !== undefined && item.exitCode !== 0}>
    <span class="ic"><Icon name="terminal" size={12} /></span>
    <code class="mono c ellipsis" title={item.cmd}>{item.cmd}</code>
    {#if item.exitCode !== undefined}<span class="badge {item.exitCode === 0 ? 'ok' : 'err'}" title="Exit code">{item.exitCode}</span>{:else}<span class="run" title="Running or no result yet">…</span>{/if}
    <time class="ts tnum" title={fmtTime(item.ts)}>{timeAgo(item.ts, app.now)}</time>
  </div>
{:else}
  <div class="it edit {item.status}" class:collide>
    <div class="row1">
      <span class="ic op-{item.op}" title={op[1]}><Icon name={op[0]} size={12} stroke={2.2} /></span>
      <button class="path" onclick={openIt} disabled={item.op === 'delete'} title="{item.path} — open">
        {#if dirname(item.path)}<span class="dir">{dirname(item.path)}/</span>{/if}<span class="base">{basename(item.path)}</span>
      </button>
      <span class="st add tnum">+{item.linesAdded || 0}</span><span class="st del tnum">−{item.linesRemoved || 0}</span>
    </div>
    <div class="row2">
      <span class="verb">{op[1]}</span>
      {#if item.from}<span class="faint ellipsis" title="from {item.from}">from {basename(item.from)}</span>{/if}
      <span class="who ellipsis" title={who}>{#if item.sessionId}<EntityLink kind="session" id={item.sessionId} label={who} />{:else}{who}{/if}</span>
      {#if collide}<span class="badge warn" title="Another session touched this file recently"><Icon name="alert" size={10} />collision</span>{/if}
      <span class="stat {item.status}" role="img" aria-label={item.status} title="{item.status}: {item.status === 'confirmed' ? 'seen on disk' : item.status === 'failed' ? 'the tool reported an error' : item.status === 'pending' ? 'announced in the transcript, not seen on disk yet' : 'from before AgentNeuron started'}"></span>
      <time class="ts tnum" title={fmtTime(item.ts)}>{timeAgo(item.ts, app.now)}</time>
      {#if item.hunk?.length || item.hunkHidden || item.source === 'watcher'}
        <button class="btn sm ghost icon tog" aria-expanded={open} aria-label="{open ? 'Hide' : 'Show'} diff" onclick={() => (open = !open)}>
          <Icon name="chevron" size={12} />
        </button>
      {/if}
    </div>
    {#if open}
      <div class="dv">
        {#if item.hunk?.length}
          <DiffView hunks={item.hunk} context={2} />
          {#if item.truncated}<div class="faint tiny more">diff truncated · <button class="lnk" onclick={() => navigate('diff', { path: item.path })}>full diff</button></div>{/if}
        {:else if item.hunkHidden}
          <div class="faint small pad">Diffs are hidden for your role.</div>
        {:else}
          <div class="faint small pad">Change seen by the file watcher. <button class="lnk" onclick={() => navigate('diff', { path: item.path })}>Open diff</button></div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .it { border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--panel); padding: 7px 9px; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .it.collide { border-color: color-mix(in srgb, var(--warn) 55%, var(--border)); }
  .it.failed { opacity: 0.7; }
  .cmd { flex-direction: row; align-items: center; gap: 8px; padding: 5px 9px; background: var(--inset); }
  .cmd.fail { border-color: color-mix(in srgb, var(--err) 40%, var(--border)); }
  .c { font-size: 11.5px; color: var(--text-2); flex: 1; min-width: 0; }
  .run { color: var(--text-3); }
  .row1, .row2 { display: flex; align-items: center; gap: 7px; min-width: 0; }
  .row2 { font-size: 11.5px; color: var(--text-3); }
  .ic { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 6px; background: var(--panel-active); color: var(--text-2); flex-shrink: 0; }
  .op-create { color: var(--info); background: var(--info-soft); }
  .op-delete { color: var(--err); background: var(--err-soft); }
  .op-edit, .op-patch, .op-write { color: var(--ok); background: var(--ok-soft); }
  .path { border: 0; background: none; padding: 0; font: inherit; font-size: 12.5px; color: var(--text); cursor: pointer; min-width: 0; flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .path:hover:not(:disabled) .base { color: var(--accent); text-decoration: underline; }
  .path:disabled { cursor: default; text-decoration: line-through; color: var(--text-3); }
  .dir { color: var(--text-3); }
  .base { font-weight: 600; }
  .st { font-size: 11px; font-weight: 600; font-family: var(--mono); }
  .st.add { color: var(--ok); }
  .st.del { color: var(--err); }
  .who { min-width: 0; flex: 1; }
  .stat { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--text-3); }
  .stat.confirmed { background: var(--ok); }
  .stat.pending { background: var(--warn); animation: blink 1s ease-in-out infinite; }
  .stat.failed { background: var(--err); }
  @keyframes blink { 50% { opacity: 0.35; } }
  .ts { font-size: 11px; color: var(--text-3); white-space: nowrap; }
  .tog :global(svg) { transition: transform 0.2s var(--ease); }
  .tog[aria-expanded='true'] :global(svg) { transform: rotate(90deg); }
  .dv { margin-top: 4px; max-height: 320px; overflow: auto; }
  .dv :global(.diff) { font-size: 11.5px; }
  /* snippet diffs carry no real line numbers: drop the gutters in narrow lanes */
  .dv :global(.ln) { grid-template-columns: 16px minmax(0, 1fr); }
  .dv :global(.ln .no) { display: none; }
  .more, .pad { padding: 4px 2px; }
  .lnk { border: 0; background: none; padding: 0; color: var(--accent); cursor: pointer; font: inherit; }
  @media (prefers-reduced-motion: reduce) { .tog :global(svg) { transition: none; } .stat.pending { animation: none; } }
</style>
