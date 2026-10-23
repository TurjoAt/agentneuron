<script>
  // Find & replace across tracked files: live preview (GET /api/replace/preview),
  // per-file include/exclude, apply (POST /api/replace/apply).
  import { api, post } from '../api.js';
  import { app, toast, openFile } from '../store.svelte.js';
  import { canRun, levelReason } from '../actions.svelte.js';
  import { escapeHtml } from '../format.js';
  import Modal from '../Modal.svelte';
  import Icon from '../Icon.svelte';

  let { q: q0 = '', paths: paths0 = null, onclose } = $props();

  let q = $state(q0 || '');
  let rep = $state('');
  let regex = $state(false);
  let cs = $state(false);
  let word = $state(false);
  let scope = $state(paths0?.length ? paths0.join(',') : '');
  let rows = $state([]);
  let loading = $state(false);
  let err = $state('');
  let excluded = $state(new Set());
  let busy = $state(false);
  let timer;

  $effect(() => {
    const params = { q, replace: rep, regex: regex ? 1 : 0, case: cs ? 1 : 0, word: word ? 1 : 0, paths: scope.trim() || undefined };
    clearTimeout(timer);
    err = '';
    if (!q) {
      rows = [];
      loading = false;
      return;
    }
    loading = true;
    timer = setTimeout(() => {
      api('/api/replace/preview', params)
        .then((r) => {
          if (params.q !== q) return;
          rows = Array.isArray(r) ? r : [];
          excluded = new Set();
        })
        .catch((e) => {
          rows = [];
          err = e.message;
        })
        .finally(() => (loading = false));
    }, 260);
  });

  const byFile = $derived.by(() => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.path)) m.set(r.path, []);
      m.get(r.path).push(r);
    }
    return [...m.entries()];
  });
  const included = $derived(byFile.filter(([p]) => !excluded.has(p)).map(([p]) => p));
  const nInc = $derived(rows.filter((r) => !excluded.has(r.path)).length);

  function toggle(p) {
    const s = new Set(excluded);
    s.has(p) ? s.delete(p) : s.add(p);
    excluded = s;
  }

  /** Highlight the changed span between before/after. */
  function mark(before, after) {
    let i = 0;
    while (i < before.length && i < after.length && before[i] === after[i]) i++;
    let j = 0;
    while (j < before.length - i && j < after.length - i && before[before.length - 1 - j] === after[after.length - 1 - j]) j++;
    const pre = escapeHtml(before.slice(Math.max(0, i - 40), i));
    const del = escapeHtml(before.slice(i, before.length - j));
    const ins = escapeHtml(after.slice(i, after.length - j));
    const post = escapeHtml(before.slice(before.length - j, before.length - j + 60));
    return `${i > 40 ? '…' : ''}${pre}<del>${del}</del><ins>${ins}</ins>${post}`;
  }

  async function apply() {
    if (!included.length || busy) return;
    busy = true;
    try {
      const r = await post('/api/replace/apply', { q, replace: rep, regex: regex ? 1 : 0, case: cs ? 1 : 0, word: word ? 1 : 0, paths: included });
      const n = (r?.changed || []).reduce((a, c) => a + c.count, 0);
      toast(`Replaced ${n} occurrence${n === 1 ? '' : 's'} in ${r?.changed?.length || 0} file${r?.changed?.length === 1 ? '' : 's'}`, 'ok');
      onclose?.();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      busy = false;
    }
  }
</script>

<Modal title="Find & replace" subtitle="Across all tracked files · every write is snapshotted to history" icon="search" tone="accent" width={760} {onclose}>
  <div class="fr">
    <div class="inputs">
      <div class="ir">
        <Icon name="search" size={14} />
        <input class="input mono" placeholder="Find" bind:value={q} data-autofocus spellcheck="false" aria-label="Find" />
        <button class="opt" class:on={cs} title="Match case" onclick={() => (cs = !cs)}>Aa</button>
        <button class="opt" class:on={word} title="Whole word" onclick={() => (word = !word)}><u>ab</u></button>
        <button class="opt" class:on={regex} title="Regular expression ($1 in replacement)" onclick={() => (regex = !regex)}>.*</button>
      </div>
      <div class="ir">
        <Icon name="replace" size={14} />
        <input class="input mono" placeholder="Replace with" bind:value={rep} spellcheck="false" aria-label="Replace" />
      </div>
      <div class="ir">
        <Icon name="folder" size={14} />
        <input class="input mono sm" placeholder="Limit to paths (comma separated) — empty = all files" bind:value={scope} spellcheck="false" aria-label="Paths" />
      </div>
    </div>

    <div class="sum">
      {#if loading}<span class="spin"></span> Searching…
      {:else if err}<span class="err">{err}</span>
      {:else if q}<b class="tnum">{rows.length}{rows.length >= 2000 ? '+' : ''}</b> match{rows.length === 1 ? '' : 'es'} in <b class="tnum">{byFile.length}</b> file{byFile.length === 1 ? '' : 's'}
      {:else}<span class="faint">Type to search. Matches preview the exact line before and after.</span>{/if}
    </div>

    <div class="res">
      {#each byFile as [p, list] (p)}
        <section class="fg" class:off={excluded.has(p)}>
          <header>
            <input type="checkbox" checked={!excluded.has(p)} onchange={() => toggle(p)} aria-label="Include {p}" />
            <a class="mono ellipsis grow" href="#/files?path={encodeURIComponent(p)}" data-path={p} onclick={onclose}>{p}</a>
            <span class="badge tnum">{list.length}</span>
          </header>
          {#each list.slice(0, 50) as r (r.line)}
            <button class="ln" onclick={() => { onclose?.(); openFile(r.path, { line: r.line, tab: 'raw' }); }}>
              <span class="no tnum">{r.line}</span>
              <span class="tx mono">{@html mark(r.before, r.after)}</span>
            </button>
          {/each}
          {#if list.length > 50}<div class="faint more">+{list.length - 50} more</div>{/if}
        </section>
      {/each}
    </div>
  </div>
  {#snippet footer()}
    {#if !canRun('edit')}<span class="faint small grow"><Icon name="lock" size={12} /> {levelReason('edit')}</span>{:else}<span class="faint small grow">{nInc} replacement{nInc === 1 ? '' : 's'} in {included.length} file{included.length === 1 ? '' : 's'}</span>{/if}
    <button class="btn" onclick={onclose}>Close</button>
    <button class="btn primary" onclick={apply} disabled={!nInc || busy || !canRun('edit')}><Icon name="replace" size={13} /> Replace all</button>
  {/snippet}
</Modal>

<style>
  .fr { display: flex; flex-direction: column; gap: 12px; min-height: 360px; }
  .inputs { display: flex; flex-direction: column; gap: 8px; }
  .ir { position: relative; display: flex; align-items: center; gap: 6px; color: var(--text-3); }
  .ir > :global(.icon) { position: absolute; left: 11px; pointer-events: none; }
  .ir .input { flex: 1; padding-left: 32px; }
  .ir .input.sm { height: 30px; font-size: 12px; }
  .opt { width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--border); background: transparent; color: var(--text-3); font: 600 12px var(--mono); cursor: pointer; }
  .opt.on { background: var(--accent-soft); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
  .sum { font-size: 12.5px; color: var(--text-2); display: flex; align-items: center; gap: 8px; min-height: 18px; }
  .err { color: var(--err); }
  .res { display: flex; flex-direction: column; gap: 10px; max-height: 46dvh; overflow: auto; }
  .fg { border: 1px solid var(--border); border-radius: 12px; overflow: hidden; background: var(--inset); }
  .fg.off { opacity: 0.45; }
  .fg header { display: flex; align-items: center; gap: 9px; padding: 8px 12px; font-size: 12.5px; border-bottom: 1px solid var(--border); background: var(--panel-hover); }
  .ln { display: flex; gap: 12px; width: 100%; border: 0; background: transparent; padding: 5px 12px; text-align: left; cursor: pointer; font-size: 12px; }
  .ln:hover { background: var(--panel-hover); }
  .no { color: var(--text-3); min-width: 30px; text-align: right; font: 11px var(--mono); padding-top: 1px; }
  .tx { white-space: pre-wrap; word-break: break-all; color: var(--text-2); }
  .tx :global(del) { background: var(--err-soft); color: var(--err); text-decoration: line-through; border-radius: 3px; }
  .tx :global(ins) { background: var(--ok-soft); color: var(--ok); text-decoration: none; border-radius: 3px; }
  .more { font-size: 11.5px; padding: 4px 12px 8px 54px; }
  .small { font-size: 12px; }
  .spin { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--border-strong); border-top-color: var(--accent); animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
