<script>
  // Renders a unified git patch (multi-file) using diff.js parsePatch.
  import { parsePatch } from '../diff.js';
  let { patch = '', empty = 'No changes.', truncated = false } = $props();
  const files = $derived(parsePatch(patch));
</script>

{#if !files.length}
  <div class="faint small" style="padding:12px">{empty}</div>
{:else}
  {#each files as f}
    <div class="pf">
      <div class="ph mono"><span class="grow ellipsis">{f.path}</span><span class="add">+{f.added}</span><span class="del">−{f.removed}</span></div>
      {#if f.binary}<div class="faint small" style="padding:8px 12px">Binary file</div>{/if}
      {#each f.hunks as h}
        <div class="hh mono">{h.header}</div>
        <div class="code mono">
          {#each h.lines as l}
            <div class="ln {l.t}"><span class="n">{l.o ?? ''}</span><span class="n">{l.n ?? ''}</span><span class="s">{l.t === 'add' ? '+' : l.t === 'del' ? '-' : ' '}</span><span class="t">{l.text}</span></div>
          {/each}
        </div>
      {/each}
    </div>
  {/each}
  {#if truncated}<div class="faint small" style="padding:8px 12px">Patch truncated.</div>{/if}
{/if}

<style>
  .pf { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; margin-bottom: 12px; background: var(--inset); }
  .ph { display: flex; gap: 10px; padding: 7px 12px; background: var(--panel-hover); font-size: 12px; align-items: center; }
  .add { color: var(--ok); } .del { color: var(--err); }
  .hh { padding: 3px 12px; font-size: 11px; color: var(--text-3); background: var(--accent-soft); }
  .code { overflow-x: auto; font-size: 12px; line-height: 1.55; }
  .ln { display: flex; min-width: max-content; }
  .n { width: 38px; text-align: right; padding-right: 6px; color: var(--text-3); user-select: none; flex-shrink: 0; font-size: 11px; }
  .s { width: 14px; flex-shrink: 0; user-select: none; text-align: center; }
  .t { white-space: pre; padding-right: 12px; }
  .ln.add { background: var(--ok-soft); } .ln.add .s { color: var(--ok); }
  .ln.del { background: var(--err-soft); } .ln.del .s { color: var(--err); }
  .ln.note { color: var(--text-3); }
</style>
