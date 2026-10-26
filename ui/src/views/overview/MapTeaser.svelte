<script>
  // Overview card: opens the product map (how pages and data connect).
  import { app } from '../../lib/store.svelte.js';
  import { VIEWS, GROUPS } from '../../lib/nav.js';
  import Icon from '../../lib/Icon.svelte';

  const N = [[14, 22], [40, 10], [40, 34], [66, 22], [90, 12], [90, 32]];
  const E = [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [3, 5]];
</script>

<button class="card teaser" onclick={() => (app.modal = { kind: 'map', props: {} })} aria-label="Open the product map">
  <svg class="mini" viewBox="0 0 104 44" aria-hidden="true">
    {#each E as [a, b] (a + '-' + b)}<line x1={N[a][0]} y1={N[a][1]} x2={N[b][0]} y2={N[b][1]} />{/each}
    {#each N as [x, y], i (i)}<circle cx={x} cy={y} r={i === 3 ? 5 : 3.5} class="n{i}" />{/each}
  </svg>
  <span class="col" style="gap:2px;min-width:0">
    <span class="t">Product map</span>
    <span class="small faint">{VIEWS.length} pages · how sessions, files and commits connect</span>
  </span>
  <span class="spacer"></span>
  <span class="kbd">m</span>
</button>

<style>
  .teaser { display: flex; align-items: center; gap: 12px; padding: 12px 16px; text-align: left; color: var(--text-2); cursor: pointer; width: 100%; font: inherit; }
  .teaser:hover { background: var(--panel-hover); }
  .mini { width: 64px; height: 28px; flex-shrink: 0; }
  line { stroke: var(--border-strong); stroke-width: 1.2; }
  circle { fill: var(--panel-solid); stroke: var(--accent); stroke-width: 1.4; transition: fill 0.3s; }
  .n0 { stroke: var(--tool-claude); }
  .n3 { fill: var(--accent-soft); }
  .n4 { stroke: var(--warn); }
  .n5 { stroke: var(--ok); }
  .teaser:hover circle { fill: color-mix(in srgb, var(--accent) 22%, var(--panel-solid)); }
  .t { font-weight: 600; color: var(--text); font-size: 13px; }
  .small { font-size: 12.5px; }
  .spacer { flex: 1; }
</style>
