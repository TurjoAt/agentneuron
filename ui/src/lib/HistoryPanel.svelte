<script>
  // Local version timeline: scrub through snapshots, pick two to diff, restore.
  import { api, post } from './api.js';
  import { toast, app } from './store.svelte.js';
  import { timeAgo, fmtDate, fmtBytes } from './format.js';
  import Markdown from './Markdown.svelte';
  import DiffView from './DiffView.svelte';
  import Icon from './Icon.svelte';
  import Empty from './Empty.svelte';

  let { path, history = [] } = $props();

  // oldest → newest for the scrubber
  const ordered = $derived([...history].sort((a, b) => a.ts - b.ts));
  let pos = $state(-1);
  let selected = $state([]); // ids, max 2
  let preview = $state({ id: null, content: null, loading: false });
  let diff = $state({ key: null, data: null, loading: false, error: null });

  const cur = $derived(ordered[pos < 0 || pos >= ordered.length ? ordered.length - 1 : pos]);

  $effect(() => {
    // reset when file changes
    void path;
    pos = -1;
    selected = [];
  });

  $effect(() => {
    const c = cur;
    if (!c || selected.length === 2 || preview.id === c.id) return;
    preview = { id: c.id, content: preview.content, loading: true };
    api('/api/history/content', { path, id: c.id })
      .then((r) => preview.id === c.id && (preview = { id: c.id, content: r?.content ?? '', loading: false }))
      .catch((e) => (preview = { id: c.id, content: `Could not load version: ${e.message}`, loading: false }));
  });

  const diffPair = $derived.by(() => {
    if (selected.length !== 2) return null;
    const [a, b] = selected.map((id) => ordered.find((h) => h.id === id)).filter(Boolean).sort((x, y) => x.ts - y.ts);
    return a && b ? { from: a.id, to: b.id } : null;
  });

  $effect(() => {
    const p = diffPair;
    if (!p) return;
    const key = `${p.from}..${p.to}`;
    if (diff.key === key) return;
    diff = { key, data: null, loading: true, error: null };
    api('/api/diff', { path, from: p.from, to: p.to })
      .then((d) => diff.key === key && (diff = { key, data: d, loading: false, error: null }))
      .catch((e) => (diff = { key, data: null, loading: false, error: e.message }));
  });

  function toggle(id) {
    if (selected.includes(id)) selected = selected.filter((x) => x !== id);
    else selected = [...selected, id].slice(-2);
  }

  async function restore(id) {
    if (!confirm('Restore this version? The current file content will be replaced (and kept in history).')) return;
    try {
      await post('/api/restore', { path, id });
      toast('Version restored', 'ok');
    } catch (e) {
      toast(e.status === 403 ? 'Restore disabled — start mdctl with --write to allow it' : `Restore failed: ${e.message}`, 'error', 6000);
    }
  }

  function diffVsCurrent(id) {
    location.hash = `#/diff?path=${encodeURIComponent(path)}&from=${encodeURIComponent(id)}&to=current`;
  }
</script>

{#if !ordered.length}
  <Empty icon="history" title="No local history yet">mdctl snapshots every change into <code>.mdctl/history</code>.</Empty>
{:else}
  <div class="hist">
    <div class="scrub card">
      <div class="row">
        <Icon name="history" />
        <span class="eyebrow">Time travel</span>
        <span class="spacer"></span>
        <span class="muted tnum">{ordered.indexOf(cur) + 1} / {ordered.length}</span>
      </div>
      <input
        type="range"
        min="0"
        max={ordered.length - 1}
        value={pos < 0 ? ordered.length - 1 : pos}
        oninput={(e) => {
          pos = +e.currentTarget.value;
          selected = [];
        }}
        aria-label="Scrub history"
        style="--p:{((pos < 0 ? ordered.length - 1 : pos) / Math.max(1, ordered.length - 1)) * 100}%"
      />
      <div class="ticks">
        {#each ordered as h, k (h.id)}
          <button
            class="tick"
            class:sel={selected.includes(h.id)}
            class:cur={cur?.id === h.id}
            style="left:{(k / Math.max(1, ordered.length - 1)) * 100}%"
            title="{fmtDate(h.ts)} (+{h.added} −{h.removed})"
            aria-label="Version {fmtDate(h.ts)}"
            onclick={() => {
              pos = k;
              selected = [];
            }}
          ></button>
        {/each}
      </div>
      {#if cur}
        <div class="row meta">
          <span class="tnum">{fmtDate(cur.ts)}</span>
          <span class="faint">{timeAgo(cur.ts, app.now)}</span>
          <span class="add tnum">+{cur.added ?? 0}</span>
          <span class="del tnum">−{cur.removed ?? 0}</span>
          <span class="spacer"></span>
          <button class="btn sm" onclick={() => diffVsCurrent(cur.id)}><Icon name="diff" size={13} /> Diff vs current</button>
          {#if app.state?.allowWrite !== false}<button class="btn sm" onclick={() => restore(cur.id)}><Icon name="restore" size={13} /> Restore</button>{/if}
        </div>
      {/if}
    </div>

    <div class="split">
      <div class="list">
        <div class="eyebrow pad">Versions · pick two to compare</div>
        {#each [...ordered].reverse() as h (h.id)}
          <button class="list-row ver" class:active={selected.includes(h.id)} onclick={() => toggle(h.id)}>
            <span class="pick" class:on={selected.includes(h.id)}>
              {#if selected.indexOf(h.id) >= 0}{selected.length === 2 ? (h.id === diffPair?.from ? 'A' : 'B') : '•'}{/if}
            </span>
            <span class="grow col" style="gap:0">
              <span class="tnum">{timeAgo(h.ts, app.now)}</span>
              <span class="faint small">{fmtDate(h.ts)} · {fmtBytes(h.size)}</span>
            </span>
            <span class="add tnum">+{h.added ?? 0}</span>
            <span class="del tnum">−{h.removed ?? 0}</span>
          </button>
        {/each}
      </div>
      <div class="view">
        {#if diffPair}
          <div class="row pad">
            <span class="badge accent">A → B</span>
            {#if diff.data}<span class="add tnum">+{diff.data.added}</span><span class="del tnum">−{diff.data.removed}</span>{/if}
            <span class="spacer"></span>
            <button class="btn sm ghost" onclick={() => (selected = [])}>Clear</button>
          </div>
          {#if diff.error}<div class="err">{diff.error}</div>
          {:else if diff.data}<DiffView hunks={diff.data.hunks} />
          {:else}<div class="skel" style="height:160px"></div>{/if}
        {:else if preview.content != null}
          <div class="ver-preview" class:dim={preview.loading}>
            <Markdown source={preview.content} {path} />
          </div>
        {:else}
          <div class="skel" style="height:200px"></div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .hist { display: flex; flex-direction: column; gap: 14px; }
  .scrub { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
  .meta { flex-wrap: wrap; font-size: 12.5px; }
  input[type='range'] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 6px;
    border-radius: 99px;
    background: linear-gradient(90deg, var(--accent) 0 var(--p), var(--panel-active) var(--p) 100%);
    outline: none;
    margin: 6px 0 0;
  }
  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: white;
    border: 4px solid var(--accent);
    box-shadow: 0 0 0 4px var(--accent-soft), 0 2px 8px rgba(0, 0, 0, 0.4);
    cursor: grab;
  }
  input[type='range']::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: white;
    border: 4px solid var(--accent);
    cursor: grab;
  }
  .ticks { position: relative; height: 12px; margin: 0 9px; }
  .tick {
    position: absolute;
    top: 2px;
    width: 8px;
    height: 8px;
    margin-left: -4px;
    border-radius: 50%;
    border: 0;
    padding: 0;
    background: var(--border-strong);
    cursor: pointer;
    transition: transform 0.15s var(--ease-spring);
  }
  .tick:hover { transform: scale(1.5); }
  .tick.cur { background: var(--accent); }
  .tick.sel { background: var(--accent-2); }
  .split { display: grid; grid-template-columns: minmax(220px, 300px) minmax(0, 1fr); gap: 14px; align-items: start; }
  .list { display: flex; flex-direction: column; gap: 2px; max-height: 560px; overflow: auto; }
  .pad { padding: 4px 10px 8px; }
  .ver { font-size: 13px; }
  .small { font-size: 11.5px; }
  .pick {
    width: 20px;
    height: 20px;
    border-radius: 6px;
    border: 1.5px solid var(--border-strong);
    display: grid;
    place-items: center;
    font: 700 11px var(--mono);
    flex-shrink: 0;
  }
  .pick.on { background: var(--accent); border-color: var(--accent); color: white; }
  .add { color: var(--ok); font-size: 12px; font-family: var(--mono); }
  .del { color: var(--err); font-size: 12px; font-family: var(--mono); }
  .view { min-width: 0; }
  .ver-preview { transition: opacity 0.2s; }
  .ver-preview.dim { opacity: 0.5; }
  .err { color: var(--err); padding: 12px; }
  @media (max-width: 860px) {
    .split { grid-template-columns: 1fr; }
    .list { max-height: 260px; }
  }
</style>
