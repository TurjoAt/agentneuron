<script>
  // Node-link graph of one run: main session on the left, subagents/advisor on the
  // right, curved edges (dashed for advice). Falls back to an indented list when narrow.
  import { fmtNum } from '../../lib/format.js';
  import EntityLink from '../../lib/EntityLink.svelte';
  import { money, modelLabel, fmtMs } from './shared.js';

  let { run } = $props();
  let width = $state(640);
  const NW = $derived(Math.min(220, Math.max(150, width * 0.36)));
  const NH = 58;
  const GAP = 10;
  const nodes = $derived(run?.nodes || []);
  const main = $derived(nodes.find((n) => n.kind === 'main' || n.id === 'main') || nodes[0]);
  // Big runs keep the graph readable: the MAX costliest subagents are drawn, the rest are counted.
  const MAX = 12;
  const allKids = $derived(nodes.filter((n) => n !== main));
  const kids = $derived(allKids.length > MAX ? [...allKids].sort((a, b) => (b.usd || 0) - (a.usd || 0)).slice(0, MAX) : allKids);
  const more = $derived(allKids.length - kids.length);
  const nameOf = (n) => n.title || n.name || n.id;
  const H = $derived(Math.max(NH + 16, kids.length * (NH + GAP) - GAP + 16));
  const pos = $derived.by(() => {
    const p = new Map();
    if (main) p.set(main.id, { x: 4, y: H / 2 - NH / 2 });
    kids.forEach((k, i) => p.set(k.id, { x: width - NW - 4, y: 8 + i * (NH + GAP) }));
    return p;
  });
  const edges = $derived((run?.edges || []).map((e) => {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) return null;
    const x1 = a.x + NW;
    const y1 = a.y + NH / 2;
    const x2 = b.x;
    const y2 = b.y + NH / 2;
    const mx = (x1 + x2) / 2;
    return { ...e, d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}` };
  }).filter(Boolean));
  const maxUsd = $derived(Math.max(0.01, ...nodes.map((n) => n.usd || 0)));
  const narrow = $derived(width < 520);
  const dur = (n) => (n.startedAt && n.endedAt ? fmtMs(n.endedAt - n.startedAt) : null);
  const summary = $derived(`Run graph: main session ${main ? modelLabel(main.model) : ''} spawned ${allKids.filter((k) => k.kind === 'subagent').length} subagents${allKids.some((k) => k.kind === 'advisor') ? ' and consulted an advisor' : ''}.`);
</script>

<div class="fg" bind:clientWidth={width}>
  {#if narrow}
    <ul class="tree" aria-label={summary}>
      {#each [main, ...kids].filter(Boolean) as n (n.id)}
        <li class="tn k-{n.kind}" class:child={n !== main}>
          <span class="dot"></span>
          <div class="grow">
            <div class="nm"><b title={n.name || ''}>{nameOf(n)}</b>{#if n.kind === 'advisor'}<span class="badge info">advisor</span>{/if}</div>
            <div class="faint tiny"><EntityLink kind="model" id={n.model} label={modelLabel(n.model)} /> · {fmtNum(n.turns)} turns · {fmtNum(n.tokens)} tok</div>
          </div>
          <b class="tnum">{money(n.usd)}</b>
        </li>
      {/each}
    </ul>
  {:else}
    <div class="wrap" style="height:{H}px">
      <svg {width} height={H} role="img" aria-label={summary}>
        {#each edges as e, i (i)}
          <path d={e.d} class="edge {e.kind}" />
        {/each}
      </svg>
      {#each [main, ...kids].filter(Boolean) as n (n.id)}
        {@const p = pos.get(n.id)}
        <div class="node k-{n.kind}" style="left:{p.x}px;top:{p.y}px;width:{NW}px;height:{NH}px">
          <div class="nh"><span class="dot"></span><b class="ellipsis" title={n.name ? `${n.name}: ${nameOf(n)}` : nameOf(n)}>{nameOf(n)}</b><span class="spacer"></span><b class="tnum usd">{money(n.usd)}</b></div>
          <div class="faint tiny ellipsis"><EntityLink kind="model" id={n.model} label={modelLabel(n.model)} /> · {fmtNum(n.turns)} turns{#if dur(n)} · {dur(n)}{/if}</div>
          <div class="cost" aria-hidden="true"><span style="width:{((n.usd || 0) / maxUsd) * 100}%"></span></div>
        </div>
      {/each}
    </div>
  {/if}
  {#if more}<p class="faint tiny more">Showing the {MAX} costliest of {allKids.length} subagents; the session replay lists all of them.</p>{/if}
</div>

<style>
  .more { margin: 8px 0 0; }
  .fg { width: 100%; min-width: 0; }
  .wrap { position: relative; }
  svg { position: absolute; inset: 0; overflow: visible; }
  .edge { fill: none; stroke: var(--border-strong); stroke-width: 1.6; }
  .edge.spawn { stroke: color-mix(in srgb, var(--accent) 55%, transparent); }
  .edge.advice { stroke: var(--info); stroke-dasharray: 4 4; }
  .edge.message { stroke: var(--text-3); stroke-dasharray: 2 3; }
  .node { position: absolute; box-sizing: border-box; padding: 8px 10px 6px; border-radius: 10px; background: var(--panel-solid); border: 1px solid var(--border-strong); display: flex; flex-direction: column; gap: 2px; box-shadow: var(--shadow); animation: fade-up 0.4s var(--ease) backwards; }
  .node.k-main { border-color: color-mix(in srgb, var(--accent) 50%, transparent); }
  .node.k-advisor { border-style: dashed; border-color: var(--info); }
  .nh { display: flex; align-items: center; gap: 6px; font-size: 12.5px; min-width: 0; }
  .usd { font-size: 12px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex: none; }
  .k-subagent .dot { background: var(--ok); }
  .k-advisor .dot { background: var(--info); }
  .cost { height: 3px; border-radius: 99px; background: var(--panel-active); margin-top: auto; overflow: hidden; }
  .cost span { display: block; height: 100%; background: var(--accent-2); }
  .tiny { font-size: 11px; }
  .tree { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .tn { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 9px; background: var(--inset); font-size: 12.5px; }
  .tn.child { margin-left: 18px; position: relative; }
  .tn.child::before { content: ''; position: absolute; left: -11px; top: -6px; bottom: 50%; width: 9px; border-left: 1px solid var(--border-strong); border-bottom: 1px solid var(--border-strong); border-bottom-left-radius: 6px; }
  .nm { display: flex; gap: 6px; align-items: center; }
</style>
