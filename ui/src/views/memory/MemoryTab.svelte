<script>
  // Memory tab: filter by type, search, cards, and a link graph between memories.
  import { tick, untrack } from 'svelte';
  import { reduced } from '../../lib/motion.js';
  import Empty from '../../lib/Empty.svelte';
  import Icon from '../../lib/Icon.svelte';
  import MemoryCard from './MemoryCard.svelte';
  import LinkGraph from './LinkGraph.svelte';
  import { TYPES, typeOf, memId } from './types.js';

  let { memory = [], focus = '' } = $props();
  let type = $state('all');
  let q = $state('');
  let active = $state(untrack(() => focus));
  let hlTimer;

  const known = $derived(new Set(memory.map((m) => m.name).filter(Boolean)));
  const counts = $derived(memory.reduce((a, m) => ((a[m.type] = (a[m.type] || 0) + 1), a), {}));
  const types = $derived([...Object.keys(TYPES), ...Object.keys(counts).filter((t) => !TYPES[t])].filter((t) => counts[t]));
  const list = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    return memory
      .filter((m) => type === 'all' || m.type === type)
      .filter((m) => !needle || [m.name, m.description, m.file, m.body].some((s) => typeof s === 'string' && s.toLowerCase().includes(needle)))
      .slice()
      .sort((a, b) => (b.stale?.length ? 1 : 0) - (a.stale?.length ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
  });
  const staleN = $derived(memory.reduce((a, m) => a + (m.stale?.length || 0), 0));
  const linkN = $derived(memory.reduce((a, m) => a + (m.links?.length || 0), 0));

  async function jump(name) {
    if (!list.some((m) => m.name === name)) { type = 'all'; q = ''; }
    active = name;
    await tick();
    const el = document.getElementById(memId(name));
    el?.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
    el?.focus({ preventScroll: true });
    clearTimeout(hlTimer);
    hlTimer = setTimeout(() => (active = ''), 2400);
  }
  $effect(() => {
    const f = focus;
    if (f) untrack(() => jump(f));
    return () => clearTimeout(hlTimer);
  });
</script>

{#if !memory.length}
  <div class="card"><Empty icon="layers" title="No memory saved for this project">Claude Code writes memory files to <code>~/.claude/projects/…/memory/</code> when it learns something worth keeping.</Empty></div>
{:else}
  <div class="grid">
    <div class="main col">
      <div class="bar">
        <div class="chips" role="group" aria-label="Filter by type">
          <button class="chip" class:on={type === 'all'} aria-pressed={type === 'all'} onclick={() => (type = 'all')}>All <span class="n">{memory.length}</span></button>
          {#each types as t (t)}
            <button class="chip" class:on={type === t} aria-pressed={type === t} onclick={() => (type = type === t ? 'all' : t)} title={typeOf(t).hint}>
              <span class="dot {typeOf(t).tone}"></span>{typeOf(t).label} <span class="n">{counts[t]}</span>
            </button>
          {/each}
        </div>
        <label class="search">
          <Icon name="search" size={14} />
          <input class="input" type="search" placeholder="Search memory" aria-label="Search memory" bind:value={q} />
        </label>
      </div>

      {#if !list.length}
        <div class="card"><Empty icon="search" title="No memory matches" compact>Try another type or search term.</Empty></div>
      {:else}
        <div class="cards">
          {#each list as m (m.file || m.name)}
            <MemoryCard {m} {known} highlighted={active === m.name} onjump={jump} />
          {/each}
        </div>
      {/if}
    </div>

    <aside class="side col">
      <section class="card">
        <div class="card-h">Links <span class="sub">{linkN} link{linkN === 1 ? '' : 's'}</span></div>
        <div class="card-b"><LinkGraph {memory} {active} onselect={jump} /></div>
      </section>
      <section class="card">
        <div class="card-h">Health</div>
        <div class="card-b col sm">
          <div class="kv"><span class="muted">Memories</span><b class="tnum">{memory.length}</b></div>
          <div class="kv"><span class="muted">Stale claims</span><b class="tnum" class:warn={staleN}>{staleN}</b></div>
          {#if staleN}<a class="small" href="#/verify">Check against the repo in Truth &amp; safety →</a>{/if}
          <div class="legend">
            {#each Object.entries(TYPES) as [k, t] (k)}<span title={t.hint}><span class="dot {t.tone}"></span>{t.label}</span>{/each}
          </div>
        </div>
      </section>
    </aside>
  </div>
{/if}

<style>
  .grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
  .side { position: sticky; top: calc(var(--topbar-h) + 12px); gap: 16px; }
  .bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .search { position: relative; display: flex; align-items: center; margin-left: auto; color: var(--text-3); min-width: 0; }
  .search :global(.icon) { position: absolute; left: 10px; pointer-events: none; }
  .search .input { padding-left: 30px; width: 220px; max-width: 100%; }
  .cards { display: flex; flex-direction: column; gap: 12px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; background: var(--text-3); margin-right: 2px; }
  .dot.info { background: var(--info); }
  .dot.warn { background: var(--warn); }
  .dot.accent { background: var(--accent); }
  .dot.ok { background: var(--ok); }
  .sm { gap: 8px; font-size: 13px; }
  .kv { display: flex; justify-content: space-between; }
  b.warn { color: var(--warn); }
  .small { font-size: 12.5px; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 11.5px; color: var(--text-3); padding-top: 4px; border-top: 1px solid var(--border); }
  .legend span { display: inline-flex; align-items: center; gap: 4px; }
  @media (max-width: 1000px) {
    .grid { grid-template-columns: minmax(0, 1fr); }
    .side { position: static; display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
  }
  @media (max-width: 560px) {
    .search { margin-left: 0; width: 100%; }
    .search .input { width: 100%; }
  }
</style>
