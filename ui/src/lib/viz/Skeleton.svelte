<script>
  // Loading placeholders shaped like the content they stand in for. The shimmer
  // comes from the global `.skel` class, which prefers-reduced-motion stops.
  // kind: kpis | chart | bars | table | timeline | graph | cards
  let { kind = 'chart', count = 0, height = 200, label = 'Loading' } = $props();
  const n = $derived(count || { kpis: 6, bars: 6, table: 8, timeline: 9, cards: 3, chart: 1, graph: 1 }[kind] || 4);
  const W = [92, 74, 86, 61, 79, 68, 88, 55, 72, 83];
</script>

<div class="sk {kind}" role="status" aria-live="polite" aria-busy="true">
  <span class="sr-only">{label}…</span>
  {#if kind === 'kpis'}
    <div class="kpis">
      {#each Array(n) as _, i (i)}
        <div class="card tile" style="--d:{i * 60}ms">
          <div class="skel l" style="width:{W[i % W.length] - 30}%"></div>
          <div class="skel v"></div>
          <div class="skel s"></div>
        </div>
      {/each}
    </div>
  {:else if kind === 'chart'}
    <div class="chart" style="height:{height}px">
      <div class="axis">{#each Array(4) as _, i (i)}<div class="skel tick"></div>{/each}</div>
      <div class="cols">
        {#each Array(18) as _, i (i)}<div class="skel col" style="height:{25 + ((i * 37) % 60)}%;--d:{i * 25}ms"></div>{/each}
      </div>
    </div>
  {:else if kind === 'bars'}
    <div class="bars">
      {#each Array(n) as _, i (i)}
        <div class="bar"><div class="skel bl"></div><div class="skel bv" style="width:{W[i % W.length]}%;--d:{i * 50}ms"></div></div>
      {/each}
    </div>
  {:else if kind === 'table'}
    <div class="table">
      <div class="skel th"></div>
      {#each Array(n) as _, i (i)}
        <div class="tr" style="--d:{i * 40}ms"><div class="skel c1"></div><div class="skel c2" style="width:{W[i % W.length] / 2}%"></div><div class="skel c3"></div><div class="skel c3"></div></div>
      {/each}
    </div>
  {:else if kind === 'timeline'}
    <div class="tl">
      {#each Array(n) as _, i (i)}
        <div class="ev" style="--d:{i * 45}ms"><div class="skel dot"></div><div class="body"><div class="skel t1" style="width:{W[i % W.length] / 3}%"></div><div class="skel t2" style="width:{W[(i + 3) % W.length]}%"></div></div></div>
      {/each}
    </div>
  {:else if kind === 'graph'}
    <div class="graph" style="height:{height}px">
      <div class="skel node main"></div>
      {#each Array(3) as _, i (i)}<div class="skel node sub" style="top:{18 + i * 30}%;--d:{i * 80}ms"></div>{/each}
    </div>
  {:else}
    <div class="cards">
      {#each Array(n) as _, i (i)}<div class="card cardsk" style="--d:{i * 60}ms"><div class="skel t1" style="width:40%"></div><div class="skel t2"></div><div class="skel t2" style="width:70%"></div></div>{/each}
    </div>
  {/if}
</div>

<style>
  .sk { min-width: 0; }
  .sk :global(.skel) { animation-delay: var(--d, 0ms); }
  .kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
  .tile { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; height: 108px; box-sizing: border-box; }
  .l { height: 10px; }
  .v { height: 24px; width: 55%; }
  .s { height: 22px; width: 100%; opacity: 0.6; }
  .chart { display: grid; grid-template-columns: 30px 1fr; gap: 8px; padding: 4px 0 18px; box-sizing: border-box; }
  .axis { display: flex; flex-direction: column; justify-content: space-between; }
  .tick { height: 8px; width: 24px; }
  .cols { display: flex; align-items: flex-end; gap: 5px; border-bottom: 1px solid var(--border); }
  .col { flex: 1; border-radius: 4px 4px 0 0; }
  .bars { display: flex; flex-direction: column; gap: 12px; padding: 4px 0; }
  .bar { display: grid; grid-template-columns: 110px 1fr; gap: 10px; align-items: center; }
  .bl { height: 10px; }
  .bv { height: 12px; }
  .table { display: flex; flex-direction: column; gap: 0; }
  .th { height: 28px; border-radius: 6px; margin-bottom: 6px; opacity: 0.6; }
  .tr { display: grid; grid-template-columns: 2fr 1fr 0.6fr 0.6fr; gap: 14px; padding: 11px 4px; border-bottom: 1px solid var(--border); }
  .tr .skel { height: 11px; }
  .c1 { width: 80%; }
  .tl { display: flex; flex-direction: column; gap: 14px; padding: 6px 0; }
  .ev { display: flex; gap: 12px; align-items: flex-start; }
  .dot { width: 22px; height: 22px; border-radius: 50%; flex: none; }
  .body { flex: 1; display: flex; flex-direction: column; gap: 7px; }
  .t1 { height: 9px; }
  .t2 { height: 12px; }
  .graph { position: relative; }
  .node { position: absolute; border-radius: 12px; }
  .node.main { left: 6%; top: 38%; width: 26%; height: 24%; }
  .node.sub { left: 62%; width: 30%; height: 18%; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
  .cardsk { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
</style>
