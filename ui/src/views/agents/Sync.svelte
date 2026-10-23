<script>
  import { api, post } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { openFile, navigate } from '../../lib/store.svelte.js';
  import DiffView from '../../lib/DiffView.svelte';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import ActionBtn from '../overview/ActionBtn.svelte';
  import { toolKey, pct, hunksOf } from './shared.js';

  const status = resource(() => api('/api/agents/sync/status'));
  let sel = $state(null); // { source, target }
  let mode = $state('copy');
  let plan = $state(null);
  let perr = $state('');
  let busy = $state(false);

  const files = $derived(status.data?.files || []);
  const pairs = $derived(status.data?.pairs || []);
  const missing = $derived(status.data?.missing || []);
  const pairMap = $derived.by(() => {
    const m = new Map();
    for (const p of pairs) { m.set(p.a + '|' + p.b, p); m.set(p.b + '|' + p.a, p); }
    return m;
  });
  const toolOf = (path) => files.find((f) => f.path === path)?.tool;
  const hue = (s) => (s >= 80 ? 'ok' : s >= 30 ? 'warn' : 'err');

  async function choose(source, target) {
    sel = { source, target };
    await load();
  }
  async function load() {
    if (!sel) return;
    busy = true; perr = ''; plan = null;
    try {
      const r = await post('/api/agents/sync/plan', { source: sel.source, targets: [sel.target], mode });
      plan = Array.isArray(r) ? r[0] : r;
    } catch (e) { perr = e.message; }
    busy = false;
  }
  const swap = () => { sel = { source: sel.target, target: sel.source }; load(); };
  const setMode = (m) => { mode = m; load(); };
</script>

<div class="stack">
  <section class="card">
    <div class="card-h">Cross-tool sync <span class="sub">how closely each instruction file matches the others</span></div>
    {#if status.error}
      <Empty icon="alert" title="Could not load sync status">{status.error.message}</Empty>
    {:else if !status.data}
      <div class="card-b"><div class="skel" style="height:160px"></div></div>
    {:else if files.length < 2}
      <Empty icon="merge" title="Nothing to compare yet">Sync needs at least two instruction files (for example CLAUDE.md and AGENTS.md).</Empty>
    {:else}
      <div class="scroll">
        <table class="mx">
          <thead><tr><th></th>{#each files as f (f.path)}<th title={f.path}><span class="hd" style="--c:var(--tool-{toolKey(f.tool)})"><i></i>{f.path.split('/').pop()}</span></th>{/each}</tr></thead>
          <tbody>
            {#each files as r (r.path)}
              <tr>
                <th class="rh"><button class="fl" style="--c:var(--tool-{toolKey(r.tool)})" onclick={() => openFile(r.path, { drawer: true })}><i></i>{r.path}</button><span class="faint tiny tnum">{r.tokens ?? ''} tok</span></th>
                {#each files as c (c.path)}
                  {@const p = pairMap.get(r.path + '|' + c.path)}
                  <td>
                    {#if r.path === c.path}<span class="faint">·</span>
                    {:else if p}
                      {@const s = pct(p.similarity)}
                      <button class="cell {hue(s)}" class:on={sel && sel.source === r.path && sel.target === c.path} title="{p.status || ''} · {p.onlyA} only in {p.a}, {p.onlyB} only in {p.b}" onclick={() => choose(r.path, c.path)}>{s}%</button>
                    {/if}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="card-b faint small">Click a cell to preview syncing the <b>row</b> file into the <b>column</b> file.</div>
    {/if}
    {#if missing.length}
      <div class="card-b miss">
        <span class="faint small">Missing:</span>
        {#each missing as m (m.path)}
          <button class="chip" onclick={() => navigate('agents', { tab: 'templates', tool: m.tool })}><Icon name="plus" size={11} /> {m.path}</button>
        {/each}
      </div>
    {/if}
  </section>

  {#if sel}
    <section class="card">
      <div class="card-h">
        <span class="mono small">{sel.source}</span><Icon name="chevron" size={13} /><span class="mono small">{sel.target}</span>
        <span class="spacer"></span>
        <button class="btn sm ghost" onclick={swap}>Swap direction</button>
        <div class="segc" role="group" aria-label="Sync mode">
          <button class:on={mode === 'copy'} onclick={() => setMode('copy')}>Copy</button>
          <button class:on={mode === 'import'} onclick={() => setMode('import')} title="Write an @import stub instead of a copy">@import</button>
        </div>
      </div>
      <div class="card-b col" style="gap:12px">
        {#if busy}<div class="skel" style="height:120px"></div>
        {:else if perr}<div class="faint small">{perr}</div>
        {:else if plan}
          {#if hunksOf(plan.diff).some((h) => h.type !== 'ctx')}<div class="dv"><DiffView hunks={hunksOf(plan.diff)} /></div>{:else}<div class="faint small">No differences — files already match.</div>{/if}
          <div class="row" style="gap:10px;flex-wrap:wrap">
            <ActionBtn id="agents.sync.apply" params={{ source: sel.source, targets: [sel.target], mode }} label="Apply sync" icon="check" cls="primary" hint onrun={() => status.reload()} />
            <span class="faint small">{plan.exists ? 'Overwrites the target.' : 'Creates the target file.'}</span>
          </div>
        {/if}
      </div>
    </section>
  {/if}
</div>

<style>
  .stack { display: flex; flex-direction: column; gap: 14px; }
  .scroll { overflow-x: auto; padding: 0 12px 6px; }
  .mx { border-collapse: separate; border-spacing: 4px; font-size: 12px; min-width: 100%; }
  .mx th { font-weight: 600; color: var(--text-3); font-size: 11px; padding: 2px 4px; white-space: nowrap; }
  .hd { display: inline-flex; align-items: center; gap: 5px; max-width: 110px; overflow: hidden; text-overflow: ellipsis; }
  .hd i, .fl i { width: 7px; height: 7px; border-radius: 50%; background: var(--c); flex-shrink: 0; }
  .rh { text-align: left; }
  .fl { display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; color: var(--text); font-family: var(--mono); font-size: 12px; cursor: pointer; padding: 0; margin-right: 8px; }
  .fl:hover { color: var(--accent); }
  .mx td { text-align: center; }
  .cell { min-width: 52px; height: 32px; border-radius: 8px; border: 1px solid var(--border); font-size: 12px; font-weight: 650; cursor: pointer; font-variant-numeric: tabular-nums; background: transparent; }
  .cell.ok { background: var(--ok-soft); color: var(--ok); }
  .cell.warn { background: var(--warn-soft); color: var(--warn); }
  .cell.err { background: var(--err-soft); color: var(--err); }
  .cell.on, .cell:hover { border-color: var(--text-2); }
  .miss { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; border-top: 1px solid var(--border); padding-top: 12px; }
  .small { font-size: 12.5px; }
  .tiny { font-size: 11px; }
  .dv { max-height: 420px; overflow: auto; border: 1px solid var(--border); border-radius: 10px; }
</style>
