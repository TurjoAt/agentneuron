<script>
  // "Neuron brain" — a compact, orbit-style glimpse of the context graph.
  // A glowing core (the project) with files orbiting on elliptical rings by
  // kind tier (context/rules → agents/skills → docs → tasks), coloured by tool.
  // Rings drift slowly; a file that changes on disk fires a signal from the
  // core and pulses. Hover for details, click to open the file.
  // Keyboard: a visually hidden list of node buttons (same order as the rings)
  // mirrors the canvas — Tab in, arrows move, Enter opens; the focused node is
  // highlighted with a ring drawn on the canvas.
  //
  // Performance: one canvas, one rAF loop capped at ~30fps that only runs while
  // the card is on screen, the tab is visible and reduced motion is off. With
  // prefers-reduced-motion it renders statically and redraws on data changes.
  import { onMount, untrack } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import { api } from '../../lib/api.js';
  import { app, openFile } from '../../lib/store.svelte.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { page } from '../../lib/visibility.svelte.js';
  import { toolColor, TOOLS, TOOL_ORDER, KINDS } from '../../lib/tools.js';
  import { fmtNum, dirname } from '../../lib/format.js';
  import Icon from '../../lib/Icon.svelte';
  import { buildModel, TIERS } from '../graph/model.js';

  let { height = 300 } = $props();

  const MAX_NODES = 60;
  const PULSE_MS = 2600;
  const FRAME_MS = 33; // ~30fps cap
  const SPEEDS = [0.05, -0.034, 0.026, -0.02]; // rad/s per ring, alternating

  const graph = resource(() => api('/api/graph'), { live: 'graph' });

  const model = $derived(graph.data ? buildModel(graph.data, { files: untrack(() => app.files) }) : null);

  // Deterministic pick: mostly-static criteria so live churn never reshuffles.
  const picked = $derived.by(() => {
    if (!model) return null;
    const score = (n) => (n.tier === 0 ? 40 : 0) + n.degree * 4 + Math.sqrt(n.tokens || 0) / 4;
    const nodes = model.nodes
      .filter((n) => !n.missing)
      .sort((a, b) => score(b) - score(a) || (a.id < b.id ? -1 : 1))
      .slice(0, MAX_NODES);
    const set = new Set(nodes.map((n) => n.id));
    const edges = model.edges.filter((e) => set.has(e.source.id) && set.has(e.target.id) && !e.broken);
    const tiers = [...new Set(nodes.map((n) => n.tier))].sort();
    const rings = tiers.map((t) => {
      const list = nodes
        .filter((n) => n.tier === t)
        .sort((a, b) => TOOL_ORDER.indexOf(a.tool) - TOOL_ORDER.indexOf(b.tool) || (a.id < b.id ? -1 : 1));
      return { tier: t, label: TIERS[t]?.label || '', nodes: list };
    });
    return { nodes, edges, rings, total: model.nodes.filter((n) => !n.missing).length, links: model.edges.length };
  });

  const order = $derived(picked ? picked.rings.flatMap((r) => r.nodes) : []);

  const toolsPresent = $derived.by(() => {
    const m = new Map();
    for (const n of picked?.nodes || []) m.set(n.tool, (m.get(n.tool) || 0) + 1);
    return TOOL_ORDER.filter((t) => m.has(t)).map((t) => [t, m.get(t)]);
  });

  // ------------------------------------------------------------ canvas state (plain, not reactive)
  let wrap = $state();
  let canvas = $state();
  let ctx = null;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let inView = true;
  let raf = 0;
  let lastFrame = 0;
  let phase = 0; // accumulated rotation time (s)
  let speed = 1; // eases to 0.25 while hovering
  let lastT = 0;
  let pts = []; // screen positions [{ n, x, y, r, depth }]
  let colors = {};
  let pulses = {};
  let coreFlash = 0;
  let hovered = null;
  let kbd = null; // keyboard-focused node id
  let pendingStatic = 0;

  let tip = $state(null); // { n, x, y }
  let list = $state();
  let focusIdx = $state(0); // roving tabindex: the list is one tab stop
  const hot = () => hovered || kbd;
  const tipAt = (p) => ({ n: p.n, x: Math.min(W - 230, Math.max(8, p.x + 12)), y: p.y > H - 90 ? p.y - 80 : p.y + 12 });

  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const v = (k) => cs.getPropertyValue(k).trim();
    colors = {
      dark: app.theme !== 'light',
      text: v('--text'),
      text2: v('--text-2'),
      text3: v('--text-3'),
      accent: v('--accent'),
      accent2: v('--accent-2'),
      border: v('--border-strong'),
      panel: v('--panel-solid'),
      tool: Object.fromEntries(Object.keys(TOOLS).map((t) => [t, toolColor(t, app.theme)])),
    };
  }

  function resize() {
    if (!canvas || !wrap) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = wrap.clientWidth;
    H = height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx = canvas.getContext('2d');
    draw();
  }

  const alpha = (hex, a) => {
    if (!hex) return `rgba(128,128,128,${a})`;
    if (hex.startsWith('#') && (hex.length === 7 || hex.length === 4)) {
      const h = hex.length === 4 ? hex.replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3') : hex;
      const n = parseInt(h.slice(1), 16);
      return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
    }
    return hex;
  };

  function layout() {
    const p = picked;
    pts = [];
    if (!p || !W) return;
    const cx = W / 2;
    const cy = H / 2 + 4;
    const ry = H / 2 - 22;
    const rx = Math.min(W / 2 - 22, ry * 1.9);
    const k = p.rings.length;
    p.rings.forEach((ring, i) => {
      const f = k === 1 ? 0.7 : 0.36 + (0.64 * i) / (k - 1);
      const n = ring.nodes.length;
      const dir = SPEEDS[ring.tier % SPEEDS.length];
      const off = ring.tier * 0.9;
      ring.nodes.forEach((node, j) => {
        const a = off + (j / n) * Math.PI * 2 + phase * dir;
        const depth = (Math.sin(a) + 1) / 2; // 0 back … 1 front
        const r = Math.max(2.4, Math.min(6.5, 2.2 + Math.sqrt(node.tokens || 0) / 18)) * (0.82 + depth * 0.3);
        pts.push({ n: node, x: cx + Math.cos(a) * rx * f, y: cy + Math.sin(a) * ry * f, r, depth, ring: i });
      });
    });
    pts.sort((a, b) => a.depth - b.depth);
  }

  function draw(now = performance.now()) {
    if (!ctx || !W) return;
    layout();
    const c = colors;
    const g = ctx;
    const wall = Date.now();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H / 2 + 4;
    const ry = H / 2 - 22;
    const rx = Math.min(W / 2 - 22, ry * 1.9);
    const k = picked?.rings.length || 0;

    // orbits
    g.lineWidth = 1;
    for (let i = 0; i < k; i++) {
      const f = k === 1 ? 0.7 : 0.36 + (0.64 * i) / (k - 1);
      g.strokeStyle = alpha(c.text3, c.dark ? 0.16 : 0.2);
      g.setLineDash(i % 2 ? [2, 5] : []);
      g.beginPath();
      g.ellipse(cx, cy, rx * f, ry * f, 0, 0, Math.PI * 2);
      g.stroke();
      const lbl = picked.rings[i].label;
      if (lbl && W > 420) {
        g.setLineDash([]);
        g.font = '500 9.5px ' + getFont();
        g.fillStyle = alpha(c.text3, 0.85);
        g.textAlign = 'center';
        g.fillText(lbl.toUpperCase(), cx, cy - ry * f - 4);
      }
    }
    g.setLineDash([]);

    const byId = new Map(pts.map((p) => [p.n.id, p]));
    const hov = hot();
    const hovNbrs = hov ? new Set((picked?.edges || []).filter((e) => e.source.id === hov || e.target.id === hov).flatMap((e) => [e.source.id, e.target.id])) : null;

    // links (curved through the core's pull)
    if (c.dark) g.globalCompositeOperation = 'lighter';
    for (const e of picked?.edges || []) {
      const a = byId.get(e.source.id);
      const b = byId.get(e.target.id);
      if (!a || !b) continue;
      const on = hov && (e.source.id === hov || e.target.id === hov);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      g.strokeStyle = on ? alpha(c.tool[a.n.tool], 0.85) : alpha(c.text3, hov ? 0.08 : c.dark ? 0.2 : 0.22);
      g.lineWidth = on ? 1.4 : 0.8;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.quadraticCurveTo(mx + (cx - mx) * 0.45, my + (cy - my) * 0.45, b.x, b.y);
      g.stroke();
    }

    // signals from the core to freshly changed files
    for (const p of pts) {
      const t = pulses[p.n.id];
      if (!t) continue;
      const age = wall - t;
      if (age < 0 || age > 700) continue;
      const u = age / 700;
      const x = cx + (p.x - cx) * u;
      const y = cy + (p.y - cy) * u;
      const col = c.tool[p.n.tool];
      g.strokeStyle = alpha(col, 0.5 * (1 - u * 0.5));
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(x, y);
      g.stroke();
      g.fillStyle = col;
      g.beginPath();
      g.arc(x, y, 2.4, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';

    // core
    const breathe = reduced() ? 0 : Math.sin(now / 1400) * 0.5 + 0.5;
    const flash = Math.max(0, 1 - (wall - coreFlash) / 1200);
    const coreR = 15 + breathe * 1.5 + flash * 3;
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3.2);
    glow.addColorStop(0, alpha(c.accent, (c.dark ? 0.38 : 0.22) + flash * 0.25));
    glow.addColorStop(1, alpha(c.accent, 0));
    g.fillStyle = glow;
    g.beginPath();
    g.arc(cx, cy, coreR * 3.2, 0, Math.PI * 2);
    g.fill();
    const body = g.createRadialGradient(cx - coreR * 0.35, cy - coreR * 0.4, 1, cx, cy, coreR);
    body.addColorStop(0, alpha(c.accent, 0.95));
    body.addColorStop(1, alpha(c.accent2 || c.accent, 0.85));
    g.fillStyle = body;
    g.beginPath();
    g.arc(cx, cy, coreR, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = '700 10px ' + getFont();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(initials(app.state?.project?.name || 'AN'), cx, cy + 0.5);
    g.textBaseline = 'alphabetic';

    // nodes (back to front)
    for (const p of pts) {
      const col = c.tool[p.n.tool] || c.text2;
      const t = pulses[p.n.id];
      const age = t ? wall - t : Infinity;
      const pulsing = age >= 0 && age < PULSE_MS;
      const dim = hov && hov !== p.n.id && !hovNbrs?.has(p.n.id);
      const a = dim ? 0.25 : 0.55 + p.depth * 0.45;
      if (pulsing) {
        const u = age / PULSE_MS;
        g.strokeStyle = alpha(col, (1 - u) * 0.9);
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(p.x, p.y, p.r + 2 + u * 14, 0, Math.PI * 2);
        g.stroke();
        const halo = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        halo.addColorStop(0, alpha(col, 0.5 * (1 - u)));
        halo.addColorStop(1, alpha(col, 0));
        g.fillStyle = halo;
        g.beginPath();
        g.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = alpha(col, pulsing ? 1 : a);
      g.beginPath();
      g.arc(p.x, p.y, p.r * (hov === p.n.id ? 1.45 : 1), 0, Math.PI * 2);
      g.fill();
      if (hov === p.n.id) {
        g.strokeStyle = c.text;
        g.lineWidth = 1.5;
        g.stroke();
      } else if (!c.dark) {
        g.strokeStyle = alpha('#ffffff', 0.9);
        g.lineWidth = 1;
        g.stroke();
      }
      if (kbd === p.n.id) {
        // keyboard focus ring
        g.strokeStyle = c.accent;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(p.x, p.y, p.r * 1.45 + 4, 0, Math.PI * 2);
        g.stroke();
        const t = hovered ? null : tipAt(p);
        if (t && (!tip || tip.n.id !== t.n.id || Math.abs(tip.x - t.x) + Math.abs(tip.y - t.y) > 1)) tip = t;
      }
    }
  }

  let fontCache = '';
  function getFont() {
    if (!fontCache) fontCache = getComputedStyle(document.documentElement).getPropertyValue('--font').trim() || 'system-ui, sans-serif';
    return fontCache;
  }
  const initials = (s) => s.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || 'AN';
  const reduced = () => prefersReducedMotion.current;

  // ------------------------------------------------------------ loop
  function frame(t) {
    raf = 0;
    if (!shouldRun()) return;
    raf = requestAnimationFrame(frame);
    // ~30fps while something is happening (hover, fresh pulse), ~15fps for the idle drift
    const busy = hot() || Date.now() - coreFlash < PULSE_MS;
    if (t - lastFrame < (busy ? FRAME_MS : FRAME_MS * 2)) return;
    const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0;
    lastT = t;
    lastFrame = t;
    speed += ((kbd ? 0 : hovered ? 0.2 : 1) - speed) * 0.08; // a keyboard-focused node holds still
    phase += dt * speed;
    draw(t);
  }
  const shouldRun = () => !!ctx && inView && page.visible && !reduced() && !!picked?.nodes.length;
  function kick() {
    if (shouldRun()) {
      if (!raf) {
        lastT = 0;
        raf = requestAnimationFrame(frame);
      }
    } else {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      draw(); // static render (reduced motion / paused)
    }
  }

  // react to data, theme, visibility, motion preference
  $effect(() => {
    void picked;
    void page.visible;
    void prefersReducedMotion.current;
    void app.theme;
    untrack(() => {
      readTheme();
      kick();
    });
  });
  $effect(() => {
    const p = app.pulses;
    untrack(() => {
      const prev = pulses;
      pulses = p;
      for (const [k, t] of Object.entries(p)) if (prev[k] !== t) coreFlash = Date.now();
      if (!raf) {
        // static mode: show the pulse, then clear it
        draw();
        clearTimeout(pendingStatic);
        pendingStatic = setTimeout(() => draw(), PULSE_MS + 50);
      }
    });
  });

  function hit(x, y) {
    let best = null;
    let bd = Infinity;
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      const rr = (p.r + 6) ** 2;
      if (d <= rr && d < bd) {
        best = p;
        bd = d;
      }
    }
    return best;
  }

  onMount(() => {
    readTheme();
    const ro = new ResizeObserver(() => resize());
    ro.observe(wrap);
    const io = new IntersectionObserver((es) => {
      inView = es.some((e) => e.isIntersecting);
      kick();
    });
    io.observe(wrap);
    const move = (e) => {
      const p = hit(e.offsetX, e.offsetY);
      const id = p?.n.id || null;
      if (id !== hovered) {
        hovered = id;
        canvas.style.cursor = id ? 'pointer' : 'default';
        if (!raf) draw();
      }
      if (p) tip = tipAt(p);
      else if (!kbd) tip = null;
    };
    const leave = () => {
      hovered = null;
      tip = null;
      draw(); // re-shows the keyboard tip, if any
    };
    const click = (e) => {
      const p = hit(e.offsetX, e.offsetY);
      if (p) openFile(p.n.id, { drawer: true });
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('click', click);
    resize();
    return () => {
      ro.disconnect();
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(pendingStatic);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('click', click);
    };
  });

  function focusNode(i) {
    focusIdx = i;
    kbd = order[i]?.id || null;
    tip = null;
    draw();
  }
  function blurNode() {
    kbd = null;
    if (!hovered) tip = null;
    if (!raf) draw();
  }
  function onKey(e, i) {
    const last = order.length - 1;
    const j = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: last }[e.key];
    if (e.key === 'Escape') e.currentTarget.blur();
    else if (j !== undefined) list?.querySelectorAll('button')[j > last ? 0 : j < 0 ? last : j]?.focus();
    else return;
    e.preventDefault();
  }

  const summary = $derived(
    picked ? `Context graph glimpse: ${picked.nodes.length} of ${picked.total} files on ${picked.rings.length} orbits, ${picked.edges.length} links. Open the graph view for the full map.` : 'Context graph loading'
  );
</script>

<section class="card brain">
  <div class="card-h">
    <Icon name="graph" size={14} /> Neuron brain
    <span class="sub">
      {#if picked}{picked.nodes.length < picked.total ? `${picked.nodes.length} of ${fmtNum(picked.total)}` : fmtNum(picked.total)} files · {fmtNum(picked.links)} links{/if}
    </span>
    <span class="spacer"></span>
    <a class="btn sm ghost" href="#/graph">Open graph <Icon name="chevron" size={13} /></a>
  </div>
  <div class="stage" bind:this={wrap} style="height:{height}px">
    <canvas bind:this={canvas} aria-label={summary}></canvas>
    {#if order.length}
      <ul class="sr-only" bind:this={list} aria-label="Neuron brain files (arrow keys to move, Enter to open)">
        {#each order as n, i (n.id)}
          <li>
            <button
              type="button"
              tabindex={i === Math.min(focusIdx, order.length - 1) ? 0 : -1}
              onfocus={() => focusNode(i)}
              onblur={blurNode}
              onkeydown={(e) => onKey(e, i)}
              onclick={() => openFile(n.id, { drawer: true })}
            >{n.id} — {TOOLS[n.tool]?.label || n.tool}, {KINDS[n.kind] || n.kind}, {n.degree} links</button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if graph.error && !graph.data}
      <div class="over faint small"><Icon name="alert" size={15} /> Could not load the graph: {graph.error.message}</div>
    {:else if !graph.data}
      <div class="over"><span class="skel orb"></span></div>
    {:else if !picked?.nodes.length}
      <div class="over faint small">No linked context files yet — add a CLAUDE.md or AGENTS.md to grow the brain.</div>
    {/if}
    {#if tip}
      <div class="tip" style="left:{tip.x}px;top:{tip.y}px">
        <div class="tt"><span class="sw" style="background:{toolColor(tip.n.tool, app.theme)}"></span><b class="mono">{tip.n.label}</b></div>
        {#if dirname(tip.n.id)}<div class="faint mono tiny ellipsis">{dirname(tip.n.id)}/</div>{/if}
        <div class="faint tiny">{TOOLS[tip.n.tool]?.label} · {KINDS[tip.n.kind] || tip.n.kind} · {fmtNum(tip.n.tokens)} tok · {tip.n.degree} links</div>
      </div>
    {/if}
  </div>
  {#if toolsPresent.length}
    <div class="legend">
      {#each toolsPresent as [t, n] (t)}
        <span class="lg"><span class="sw" style="background:{toolColor(t, app.theme)}"></span>{TOOLS[t].label} <span class="faint tnum">{n}</span></span>
      {/each}
      <span class="spacer"></span>
      <span class="faint tiny">hover or tab to a neuron · click or Enter to open</span>
    </div>
  {/if}
</section>

<style>
  .brain { overflow: hidden; }
  .stage { position: relative; margin: 0 6px; }
  canvas { display: block; width: 100%; touch-action: manipulation; }
  .over { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; padding: 20px; gap: 8px; }
  .orb { width: 180px; height: 180px; border-radius: 50%; }
  .tip {
    position: absolute;
    z-index: 2;
    max-width: 230px;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--panel-solid);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-lg);
    pointer-events: none;
    display: flex;
    flex-direction: column;
    gap: 3px;
    animation: tip-in 0.14s var(--ease) both;
  }
  .tt { display: flex; align-items: center; gap: 7px; font-size: 12.5px; min-width: 0; }
  .tt b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sw { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .tiny { font-size: 11px; }
  .small { font-size: 12px; }
  .legend { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; padding: 4px 16px 14px; font-size: 12px; color: var(--text-2); }
  .lg { display: inline-flex; align-items: center; gap: 6px; }
  @keyframes tip-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
</style>
