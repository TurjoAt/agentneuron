<script>
  // Files touched in the last N minutes: one cell per file, width by edit count, colour by the main agent.
  import { app, openFile, fileIndex, navigate } from '../../lib/store.svelte.js';
  import { basename, plural } from '../../lib/format.js';
  import { colorTool } from '../../lib/live.svelte.js';

  let { edits = [], minutes = 15, onpick = null, active = '' } = $props();

  const cells = $derived.by(() => {
    const since = app.now - minutes * 60000;
    const m = new Map();
    for (const e of edits) {
      if (e.ts < since) continue;
      const c = m.get(e.path) || { path: e.path, n: 0, lines: 0, by: {}, last: 0 };
      c.n++;
      c.lines += (e.linesAdded || 0) + (e.linesRemoved || 0);
      const t = colorTool(e.tool);
      c.by[t] = (c.by[t] || 0) + 1;
      c.last = Math.max(c.last, e.ts);
      m.set(e.path, c);
    }
    const list = [...m.values()].sort((a, b) => b.n - a.n || b.last - a.last).slice(0, 40);
    const max = Math.max(1, ...list.map((c) => c.n));
    return list.map((c) => {
      const tool = Object.entries(c.by).sort((a, b) => b[1] - a[1])[0][0];
      return { ...c, tool, heat: 0.35 + 0.65 * (c.n / max), multi: Object.keys(c.by).length > 1 };
    });
  });

  function pick(c) {
    if (onpick) onpick(c.path);
    else if (fileIndex().set.has(c.path)) openFile(c.path, { drawer: true });
    else navigate('files', { path: c.path });
  }
</script>

<div class="strip" role="group" aria-label="Files touched in the last {minutes} minutes">
  {#each cells as c (c.path)}
    <button
      class="cell"
      class:multi={c.multi}
      class:on={active === c.path}
      style="flex-grow:{c.n};--c:var(--tool-{c.tool});--h:{c.heat}"
      title="{c.path} — {plural(c.n, 'edit')}, {c.lines} lines{c.multi ? ', several agents' : ''}"
      onclick={() => pick(c)}
    >
      <span class="nm ellipsis">{basename(c.path)}</span>
    </button>
  {:else}
    <div class="none faint small">No files touched in the last {minutes} minutes.</div>
  {/each}
</div>

<style>
  .strip { display: flex; gap: 3px; min-height: 30px; align-items: stretch; flex-wrap: wrap; }
  .cell {
    flex-basis: 56px;
    min-width: 34px;
    max-width: 220px;
    height: 30px;
    border: 0;
    border-radius: 6px;
    padding: 0 7px;
    cursor: pointer;
    background: color-mix(in srgb, var(--c) calc(var(--h) * 55%), transparent);
    box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--c) 80%, transparent);
    color: var(--text);
    font-size: 11px;
    font-weight: 550;
    text-align: left;
    overflow: hidden;
  }
  .cell.multi { box-shadow: inset 0 -2px 0 var(--warn); }
  .cell.on { outline: 2px solid var(--accent); outline-offset: 1px; }
  .cell:hover { filter: brightness(1.15); }
  .nm { display: block; }
  .none { padding: 6px 2px; }
</style>
