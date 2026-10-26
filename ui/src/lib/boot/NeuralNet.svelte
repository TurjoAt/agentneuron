<script>
  // Animated neural network for the boot screen: one node cluster per boot step, lit as the step completes.
  // Pure SVG + CSS; pointer parallax via requestAnimationFrame. Decorative (aria-hidden): the step list is the accessible version.
  import { onMount } from 'svelte';
  import { NODE, R_INNER, R_OUTER, R_SAT, polar, ambient } from './geometry.js';

  /** steps: [{ id, status }] (display statuses), finished: all done → final pulse */
  let { steps = [], finished = false, still = false } = $props();

  const ids = Object.keys(NODE);
  const AMB = ambient(18);
  const nodes = $derived(
    ids.map((id, i) => {
      const n = NODE[id];
      const [x, y] = polar(R_OUTER, n.angle);
      const sats = [-17, 17].map((off) => polar(R_SAT, n.angle + off));
      const [cx, cy] = polar(R_INNER * 0.55, n.angle);
      const next = NODE[ids[(i + 1) % ids.length]];
      const [nx, ny] = polar(R_OUTER, next.angle);
      const status = steps.find((s) => s.id === id)?.status || 'pending';
      return { id, x, y, sats, cx, cy, nx, ny, color: n.color, status, i };
    }),
  );

  let host = $state();
  let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
  onMount(() => {
    if (still) return;
    const onmove = (e) => {
      const r = host?.getBoundingClientRect();
      if (!r) return;
      tx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2)));
      ty = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2)));
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const frame = () => {
      cx += (tx - cx) * 0.12;
      cy += (ty - cy) * 0.12;
      host?.style.setProperty('--px', cx.toFixed(3));
      host?.style.setProperty('--py', cy.toFixed(3));
      raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.002 ? requestAnimationFrame(frame) : 0;
    };
    window.addEventListener('pointermove', onmove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onmove);
      cancelAnimationFrame(raf);
    };
  });
</script>

<div class="net" class:still class:finished bind:this={host} aria-hidden="true">
  <svg viewBox="-160 -160 320 320" class="layer back">
    <circle r={R_INNER} class="ring" />
    <circle r={R_OUTER} class="ring dashed spin" />
    <circle r={R_SAT + 8} class="ring faint spin-rev" />
    {#each AMB as a (a.id)}
      <circle cx={a.x} cy={a.y} r={a.size} class="amb" style="animation-delay:{a.delay}s;animation-duration:{a.dur}s" />
    {/each}
  </svg>
  <svg viewBox="-160 -160 320 320" class="layer front">
    <defs>
      <radialGradient id="nn-glow">
        <stop offset="0" stop-color="currentColor" stop-opacity="0.55" />
        <stop offset="1" stop-color="currentColor" stop-opacity="0" />
      </radialGradient>
    </defs>
    {#each nodes as n (n.id)}
      <g class="cluster {n.status}" style="color:{n.status === 'failed' ? 'var(--warn)' : n.color}">
        <path class="arc" d="M{n.x} {n.y} A{R_OUTER} {R_OUTER} 0 0 1 {n.nx} {n.ny}" pathLength="1" />
        <path class="edge" d="M{n.cx} {n.cy} L{n.x} {n.y}" pathLength="1" />
        {#each n.sats as [sx, sy], k (k)}
          <path class="edge sat" d="M{n.x} {n.y} L{sx} {sy}" pathLength="1" />
          <circle class="satn" cx={sx} cy={sy} r="3" style="transition-delay:{0.12 + k * 0.08}s" />
        {/each}
        <circle class="glow" cx={n.x} cy={n.y} r="24" fill="url(#nn-glow)" />
        <circle class="pulse" cx={n.x} cy={n.y} r="7" />
        <circle class="node" cx={n.x} cy={n.y} r="6.5" />
      </g>
    {/each}
  </svg>
  <div class="core"></div>
</div>

<style>
  .net {
    --px: 0;
    --py: 0;
    position: absolute;
    inset: 0;
  }
  .layer {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    will-change: transform;
  }
  .back { transform: translate3d(calc(var(--px) * -7px), calc(var(--py) * -7px), 0); color: var(--text-3); }
  .front { transform: translate3d(calc(var(--px) * 12px), calc(var(--py) * 12px), 0) rotateX(calc(var(--py) * -6deg)) rotateY(calc(var(--px) * 6deg)); }
  .core {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 120px;
    height: 120px;
    margin: -60px;
    border-radius: 50%;
    background: radial-gradient(circle, color-mix(in srgb, var(--accent) 26%, transparent), transparent 68%);
    animation: core 3.2s ease-in-out infinite alternate;
    pointer-events: none;
  }
  .ring { fill: none; stroke: currentColor; stroke-opacity: 0.32; stroke-width: 0.8; }
  .ring.dashed { stroke-dasharray: 2 6; stroke-opacity: 0.5; }
  .ring.faint { stroke-opacity: 0.16; stroke-dasharray: 1 10; }
  .spin { transform-origin: 0 0; animation: spin 40s linear infinite; }
  .spin-rev { transform-origin: 0 0; animation: spin 64s linear infinite reverse; }
  .amb { fill: currentColor; opacity: 0.25; animation: twinkle 4s ease-in-out infinite alternate; }

  .edge, .arc { fill: none; stroke: currentColor; stroke-linecap: round; }
  .edge { stroke-width: 1.4; stroke-opacity: 0.18; stroke-dasharray: 1; stroke-dashoffset: 0; }
  .edge.sat { stroke-width: 1; }
  .arc { stroke-width: 1; stroke-opacity: 0; stroke-dasharray: 1; stroke-dashoffset: 1; transition: stroke-dashoffset 0.7s var(--ease), stroke-opacity 0.4s; }
  .node { fill: var(--bg); stroke: currentColor; stroke-width: 1.6; stroke-opacity: 0.45; transition: fill 0.35s, stroke-opacity 0.35s, r 0.35s var(--ease-spring); }
  .satn { fill: currentColor; opacity: 0.18; transition: opacity 0.4s, r 0.4s var(--ease-spring); }
  .glow { opacity: 0; transition: opacity 0.5s; }
  .pulse { fill: none; stroke: currentColor; stroke-width: 1.4; opacity: 0; transform-box: fill-box; transform-origin: center; }

  /* running: flowing signal + pulse ring */
  .running .edge { stroke-opacity: 0.85; stroke-dasharray: 0.16 0.12; animation: flow 0.9s linear infinite; }
  .running .node { stroke-opacity: 1; }
  .running .pulse { animation: ping 1.2s var(--ease) infinite; }
  .running .glow { opacity: 0.6; }

  /* done: lit */
  .done .edge { stroke-opacity: 0.75; }
  .done .arc { stroke-opacity: 0.45; stroke-dashoffset: 0; }
  .done .node { fill: currentColor; stroke-opacity: 1; r: 7.5; }
  .done .satn { opacity: 0.9; r: 3.4; }
  .done .glow { opacity: 1; }
  .done .pulse { animation: ping 0.7s var(--ease) 1; }

  .failed .node { fill: color-mix(in srgb, currentColor 30%, var(--bg)); stroke-opacity: 1; stroke-dasharray: 3 2; }
  .failed .edge { stroke-opacity: 0.5; stroke-dasharray: 0.04 0.05; }

  .finished .core { animation: core-burst 0.6s var(--ease) forwards; }

  .still .layer, .still .core, .still .spin, .still .spin-rev, .still .amb { animation: none !important; transform: none; }
  .still .running .edge { animation: none; stroke-dasharray: 1; }
  .still .pulse { display: none; }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes flow { to { stroke-dashoffset: -0.28; } }
  @keyframes ping { from { opacity: 0.9; transform: scale(1); } to { opacity: 0; transform: scale(3.2); } }
  @keyframes twinkle { from { opacity: 0.08; } to { opacity: 0.5; } }
  @keyframes core { from { transform: scale(0.9); opacity: 0.7; } to { transform: scale(1.08); opacity: 1; } }
  @keyframes core-burst { to { transform: scale(2.2); opacity: 0.9; } }
</style>
