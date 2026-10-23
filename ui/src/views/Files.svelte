<script>
  import { app, navigate, isPulsing } from '../lib/store.svelte.js';
  import { TOOLS, TOOL_ORDER, KINDS, KIND_SHORT, toolOf } from '../lib/tools.js';
  import { fmtNum } from '../lib/format.js';
  import FileViewer from '../lib/FileViewer.svelte';
  import ToolBadge from '../lib/ToolBadge.svelte';
  import GitStatus from '../lib/GitStatus.svelte';
  import Icon from '../lib/Icon.svelte';
  import Empty from '../lib/Empty.svelte';

  let { params = {} } = $props();

  let q = $state('');
  let tool = $state('');
  let kind = $state('');
  let changedOnly = $state(false);
  let collapsed = $state(new Set());
  let tab = $state('preview');

  const path = $derived(params.path || '');
  $effect(() => {
    tool = params.tool || '';
    kind = params.kind || '';
  });
  $effect(() => {
    void path;
    tab = params.tab || 'preview';
  });

  const filtered = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    return app.files.filter(
      (f) =>
        (!needle || f.path.toLowerCase().includes(needle) || (f.title || '').toLowerCase().includes(needle)) &&
        (!tool || toolOf(f.tool) === tool) &&
        (!kind || f.kind === kind) &&
        (!changedOnly || f.gitStatus)
    );
  });

  const toolCounts = $derived.by(() => {
    const m = {};
    for (const f of app.files) m[toolOf(f.tool)] = (m[toolOf(f.tool)] || 0) + 1;
    return m;
  });
  const kinds = $derived([...new Set(app.files.map((f) => f.kind))].sort());

  /** Flatten into visible rows: folders (collapsible) then files, sorted. */
  const rows = $derived.by(() => {
    const root = { dirs: new Map(), files: [] };
    for (const f of filtered) {
      const parts = f.path.split('/');
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const key = parts.slice(0, i + 1).join('/');
        if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { name: parts[i], key, dirs: new Map(), files: [], count: 0, tokens: 0 });
        node = node.dirs.get(parts[i]);
        node.count++;
        node.tokens += f.tokens || 0;
      }
      node.files.push(f);
    }
    const out = [];
    const walk = (node, depth) => {
      // compress single-child chains (a/b/c) for readability
      const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
      for (let d of dirs) {
        let name = d.name;
        while (d.files.length === 0 && d.dirs.size === 1) {
          const only = [...d.dirs.values()][0];
          name += '/' + only.name;
          d = { ...only, count: d.count, tokens: d.tokens };
        }
        const open = q.trim() || !collapsed.has(d.key);
        out.push({ type: 'dir', key: d.key, name, depth, count: d.count, tokens: d.tokens, open });
        if (open) walk(d, depth + 1);
      }
      for (const f of [...node.files].sort((a, b) => a.name.localeCompare(b.name))) out.push({ type: 'file', key: f.path, f, depth });
    };
    walk(root, 0);
    return out;
  });

  function toggleDir(key) {
    const s = new Set(collapsed);
    s.has(key) ? s.delete(key) : s.add(key);
    collapsed = s;
  }

  function select(p) {
    navigate('files', { path: p, tool: tool || undefined, kind: kind || undefined });
  }

  let listEl = $state();
  function onListKey(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const files = rows.filter((r) => r.type === 'file');
    const i = files.findIndex((r) => r.key === path);
    const next = files[e.key === 'ArrowDown' ? Math.min(files.length - 1, i + 1) : Math.max(0, i - 1)];
    if (next) {
      e.preventDefault();
      select(next.key);
      requestAnimationFrame(() => listEl?.querySelector('.file.active')?.scrollIntoView({ block: 'nearest' }));
    }
  }
</script>

<div class="files-page" class:has-sel={!!path}>
  <aside class="tree card">
    <div class="tree-h">
      <div class="searchbox">
        <Icon name="search" size={14} />
        <input class="input" placeholder="Filter files…" bind:value={q} aria-label="Filter files" />
      </div>
      <div class="chips">
        <button class="chip" class:on={!tool} onclick={() => (tool = '')}>All <span class="n">{app.files.length}</span></button>
        {#each TOOL_ORDER.filter((t) => toolCounts[t]) as t (t)}
          <button class="chip" class:on={tool === t} onclick={() => (tool = tool === t ? '' : t)} style="--c:var(--tool-{t})">
            <span class="tool-dot"></span>{TOOLS[t].label} <span class="n">{toolCounts[t]}</span>
          </button>
        {/each}
      </div>
      <div class="row">
        <select class="input sm" bind:value={kind} aria-label="Filter by kind">
          <option value="">All kinds</option>
          {#each kinds as k (k)}<option value={k}>{KINDS[k] || k}</option>{/each}
        </select>
        <button class="chip" class:on={changedOnly} onclick={() => (changedOnly = !changedOnly)} title="Only files with uncommitted git changes">
          <Icon name="git" size={12} /> Changed
        </button>
      </div>
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="tree-b" bind:this={listEl} tabindex="0" role="tree" aria-label="Files" onkeydown={onListKey}>
      {#each rows as r (r.type + r.key)}
        {#if r.type === 'dir'}
          <button class="node dir" style="--d:{r.depth}" onclick={() => toggleDir(r.key)} aria-expanded={r.open}>
            <span class="chev" class:open={r.open}><Icon name="chevron" size={12} /></span>
            <Icon name="folder" size={14} />
            <span class="nm ellipsis">{r.name}</span>
            <span class="faint tnum sm">{r.count}</span>
          </button>
        {:else}
          <button
            class="node file"
            class:active={r.key === path}
            class:pulse-row={isPulsing(r.key)}
            style="--d:{r.depth}"
            onclick={() => select(r.key)}
            title={r.f.path}
            role="treeitem"
            aria-selected={r.key === path}
          >
            <ToolBadge tool={r.f.tool} compact />
            <span class="nm ellipsis">{r.f.name}</span>
            <span class="kind" title={KINDS[r.f.kind] || r.f.kind}>{KIND_SHORT[r.f.kind] ?? r.f.kind}</span>
            <GitStatus status={r.f.gitStatus} />
            <span class="tok tnum">{fmtNum(r.f.tokens)}</span>
          </button>
        {/if}
      {:else}
        <Empty icon="search" title="No matching files" />
      {/each}
    </div>
  </aside>

  <section class="viewer card">
    {#if path}
      <button class="btn sm ghost back" onclick={() => navigate('files', {})}><Icon name="chevron" size={13} class="flip" /> Files</button>
      {#key path}
        <FileViewer {path} line={params.line} anchor={params.anchor} bind:tab />
      {/key}
    {:else}
      <Empty icon="files" title="Select a file">
        Pick a file from the tree, or press <span class="kbd">⌘K</span> to search. Use <span class="kbd">↑</span><span class="kbd">↓</span> in the tree to move between files.
      </Empty>
    {/if}
  </section>
</div>

<style>
  .files-page {
    display: grid;
    grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
    gap: 16px;
    padding: 16px clamp(12px, 2vw, 24px) 24px;
    height: calc(100dvh - var(--topbar-h));
    animation: fade-up 0.35s var(--ease) both;
  }
  .tree { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  .tree-h { display: flex; flex-direction: column; gap: 10px; padding: 12px; border-bottom: 1px solid var(--border); }
  .searchbox { position: relative; display: flex; align-items: center; color: var(--text-3); }
  .searchbox :global(.icon) { position: absolute; left: 10px; pointer-events: none; }
  .searchbox .input { padding-left: 30px; width: 100%; }
  .chips { display: flex; gap: 5px; flex-wrap: wrap; }
  .chips .chip { height: 24px; padding: 0 8px; font-size: 11.5px; }
  .chips .tool-dot { width: 6px; height: 6px; box-shadow: none; }
  .input.sm { height: 26px; font-size: 12px; flex: 1; }
  .tree-b { flex: 1; overflow: auto; padding: 6px; outline: none; }
  .node {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    height: 30px;
    padding: 0 8px 0 calc(8px + var(--d) * 14px);
    border: 0;
    background: transparent;
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    font-size: 13px;
    color: var(--text-2);
    transition: background 0.12s;
  }
  .node:hover { background: var(--panel-hover); color: var(--text); }
  .dir { color: var(--text-3); font-weight: 550; }
  .dir :global(.icon) { flex-shrink: 0; }
  .chev { display: inline-grid; transition: transform 0.18s var(--ease); }
  .chev.open { transform: rotate(90deg); }
  .file.active { background: var(--accent-soft); color: var(--text); box-shadow: inset 2px 0 0 var(--accent); }
  .nm { flex: 1; }
  .file .nm { font-family: var(--mono); font-size: 12.5px; }
  .kind { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); font-weight: 600; }
  .tok { font-size: 11px; color: var(--text-3); min-width: 30px; text-align: right; }
  .sm { font-size: 11px; }
  .viewer { overflow: auto; min-height: 0; }
  .back { display: none; margin: 10px 10px 0; }
  .back :global(.flip) { transform: rotate(180deg); }

  @media (max-width: 860px) {
    .files-page { grid-template-columns: 1fr; height: auto; min-height: calc(100dvh - var(--topbar-h) - 64px); }
    .tree { max-height: none; }
    .tree-b { max-height: 60vh; }
    .has-sel .tree { display: none; }
    .files-page:not(.has-sel) .viewer { display: none; }
    .back { display: inline-flex; }
  }
</style>
