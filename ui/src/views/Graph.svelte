<script>
  // Link graph: d3-force simulation rendered on <canvas> with custom zoom/pan/drag,
  // neighbour highlighting, per-link-type edge styles and change flashes.
  import { onMount, untrack } from 'svelte';
  import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from 'd3-force';
  import { api } from '../lib/api.js';
  import { app, openFile } from '../lib/store.svelte.js';
  import { resource } from '../lib/resource.svelte.js';
  import { TOOLS, TOOL_ORDER, LINK_TYPES, KINDS, toolColor, toolOf } from '../lib/tools.js';
  import { basename, fmtNum, clamp } from '../lib/format.js';
  import { reduced } from '../lib/motion.js';
  import Icon from '../lib/Icon.svelte';
  import ToolBadge from '../lib/ToolBadge.svelte';

  let { params = {} } = $props();

  const graph = resource(() => api('/api/graph'), { live: 'graph' });

  let wrap = $state();
  let canvas = $state();
  let hidden = $state(new Set()); // hidden tools
  let hiddenLinks = $state(new Set());
  let showLabels = $state(true);
  let query = $state('');
  let hover = $state(null); // node
  let selected = $state(untrack(() => params.focus) || null);
  let tip = $state({ x: 0, y: 0 });
  let size = $state.raw({ w: 800, h: 600, dpr: 1 });
  let view = { x: 0, y: 0, k: 1 };
  let nodes = [];
  let links = [];
  let adj = new Map();
  let sim = null;
  let dirty = true;
  let raf = 0;
  let didFit = false;

  const R = (n) => (n.ghost ? 6 : clamp(4 + Math.sqrt(n.tokens || 0) * 0.55, 6, 28));

  const stats = $derived.by(() => {
    const d = graph.data;
    if (!d) return null;
    return { nodes: d.nodes?.length || 0, edges: d.edges?.length || 0, broken: (d.edges || []).filter((e) => e.broken).length };
  });

  const linkTypes = $derived([...new Set((graph.data?.edges || []).map((e) => e.type))]);
  const tools = $derived(TOOL_ORDER.filter((t) => (graph.data?.nodes || []).some((n) => toolOf(n.tool) === t)));

  // ---------------------------------------------------------------- build
  function build(data) {
    const prev = new Map(nodes.map((n) => [n.id, n]));
    const ns = (data.nodes || []).map((n) => {
      const p = prev.get(n.id);
      return { ...n, tool: toolOf(n.tool), x: p?.x, y: p?.y, vx: p?.vx, vy: p?.vy };
    });
    const ids = new Set(ns.map((n) => n.id));
    for (const e of data.edges || []) {
      for (const id of [e.from, e.to]) {
        if (!ids.has(id)) {
          ids.add(id);
          const p = prev.get(id);
          ns.push({ id, tool: 'generic', kind: 'other', tokens: 0, ghost: true, x: p?.x, y: p?.y });
        }
      }
    }
    // seed new nodes near a neighbour or randomly in a ring
    const byId = new Map(ns.map((n) => [n.id, n]));
    const ls = (data.edges || []).map((e) => ({ ...e, source: e.from, target: e.to }));
    for (const n of ns) {
      if (n.x != null) continue;
      const nb = ls.find((l) => l.source === n.id || l.target === n.id);
      const other = nb && byId.get(nb.source === n.id ? nb.target : nb.source);
      const a = Math.random() * Math.PI * 2;
      const r = other?.x != null ? 30 : 120 + Math.random() * 160;
      n.x = (other?.x ?? 0) + Math.cos(a) * r;
      n.y = (other?.y ?? 0) + Math.sin(a) * r;
    }
    adj = new Map(ns.map((n) => [n.id, new Set()]));
    for (const l of ls) {
      adj.get(l.source)?.add(l.target);
      adj.get(l.target)?.add(l.source);
    }
    nodes = ns;
    links = ls;

    sim?.stop();
    sim = forceSimulation(nodes)
      .force('link', forceLink(links).id((d) => d.id).distance((l) => (l.type === 'hierarchy' ? 55 : l.type === 'mention' ? 110 : 80)).strength((l) => (l.type === 'mention' ? 0.15 : 0.5)))
      .force('charge', forceManyBody().strength((n) => -140 - R(n) * 9).distanceMax(600))
      .force('collide', forceCollide().radius((n) => R(n) + 6).iterations(2))
      .force('x', forceX(0).strength((n) => (adj.get(n.id)?.size ? 0.045 : 0.12)))
      .force('y', forceY(0).strength((n) => (adj.get(n.id)?.size ? 0.055 : 0.14)))
      .alpha(prev.size ? 0.5 : 1)
      .alphaDecay(0.025)
      .on('tick', () => (dirty = true));
    if (reduced()) {
      sim.stop();
      for (let i = 0; i < 300; i++) sim.tick();
    }
    dirty = true;
    if (!didFit) {
      didFit = true;
      setTimeout(() => (selected ? focusNode(selected) : fit()), reduced() ? 0 : 700);
    }
  }

  $effect(() => {
    const d = graph.data;
    if (d) untrack(() => build(d));
  });

  // ---------------------------------------------------------------- theme palette
  let pal = {};
  $effect(() => {
    const theme = app.theme;
    requestAnimationFrame(() => {
      const cs = getComputedStyle(document.documentElement);
      const v = (n) => cs.getPropertyValue(n).trim();
      pal = { theme, text: v('--text'), text2: v('--text-2'), text3: v('--text-3'), err: v('--err'), accent: v('--accent'), bg: v('--bg'), panel: v('--panel-solid'), edge: theme === 'light' ? 'rgba(20,24,40,' : 'rgba(200,210,235,' };
      dirty = true;
    });
  });

  // redraw when filters/hover/selection/pulses change
  $effect(() => {
    void hidden;
    void hiddenLinks;
    void showLabels;
    void hover;
    void selected;
    void app.pulses;
    dirty = true;
  });

  const visible = (n) => !hidden.has(n.tool) || n.id === selected;
  const matches = (n) => !query || n.id.toLowerCase().includes(query.toLowerCase());

  // ---------------------------------------------------------------- draw
  function draw() {
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const { w, h, dpr } = size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2 + view.x, h / 2 + view.y);
    ctx.scale(view.k, view.k);

    const focus = hover?.id || selected;
    const nb = focus ? adj.get(focus) : null;
    const lit = (id) => !focus || id === focus || nb?.has(id);
    const now = performance.now();
    const wallNow = Date.now();

    // edges
    for (const l of links) {
      const s = l.source, t = l.target;
      if (!s || !t || s.x == null || !visible(s) || !visible(t) || hiddenLinks.has(l.type)) continue;
      const on = !focus || s.id === focus || t.id === focus;
      const st = LINK_TYPES[l.type] || LINK_TYPES.ref;
      ctx.beginPath();
      ctx.setLineDash(l.broken ? [4, 4] : st.dash);
      ctx.lineWidth = ((on && focus ? st.width + 0.8 : st.width) * 1) / Math.sqrt(view.k);
      ctx.strokeStyle = l.broken ? pal.err : on && focus ? pal.accent : pal.edge + (focus ? 0.06 : l.type === 'mention' ? 0.18 : 0.32) + ')';
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
      // arrowhead
      if (l.type !== 'hierarchy' && view.k > 0.55 && (on || !focus)) {
        const dx = t.x - s.x, dy = t.y - s.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const tr = R(t) + 3;
        const ax = t.x - ux * tr, ay = t.y - uy * tr;
        const a = 5 / Math.sqrt(view.k);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - ux * a * 1.6 - uy * a, ay - uy * a * 1.6 + ux * a);
        ctx.lineTo(ax - ux * a * 1.6 + uy * a, ay - uy * a * 1.6 - ux * a);
        ctx.closePath();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
      }
    }
    ctx.setLineDash([]);

    // nodes
    let anim = false;
    for (const n of nodes) {
      if (n.x == null || !visible(n)) continue;
      const r = R(n);
      const c = n.ghost ? pal.err : toolColor(n.tool, pal.theme);
      const isLit = lit(n.id) && matches(n);
      ctx.globalAlpha = isLit ? 1 : 0.14;

      // change flash
      const pt = app.pulses[n.id];
      const age = pt ? wallNow - pt : Infinity;
      if (age < 2600) {
        const p = reduced() ? 0.3 : age / 2600;
        anim = !reduced();
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 4 + p * 28, 0, Math.PI * 2);
        ctx.strokeStyle = c;
        ctx.lineWidth = 2.5 * (1 - p) + 0.5;
        ctx.globalAlpha = (1 - p) * 0.9;
        ctx.stroke();
        ctx.globalAlpha = isLit ? 1 : 0.14;
      }

      if (n.ghost) {
        ctx.beginPath();
        ctx.setLineDash([3, 3]);
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = c;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        // glow
        if (isLit && (n.id === focus || age < 2600)) {
          ctx.shadowColor = c;
          ctx.shadowBlur = 18;
        }
        const g = ctx.createRadialGradient(n.x - r * 0.35, n.y - r * 0.35, r * 0.1, n.x, n.y, r);
        g.addColorStop(0, mix(c, '#ffffff', 0.35));
        g.addColorStop(1, c);
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = n.id === selected ? 2.5 : 1;
        ctx.strokeStyle = n.id === selected ? pal.text : pal.theme === 'light' ? 'rgba(255,255,255,.9)' : 'rgba(0,0,0,.45)';
        ctx.stroke();
        if (n.kind === 'context' || n.kind === 'rules') {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r * 0.32, 0, Math.PI * 2);
          ctx.fillStyle = pal.theme === 'light' ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.35)';
          ctx.fill();
        }
      }

      // labels
      const showL = showLabels && (n.id === focus || nb?.has(n.id) || r * view.k > 12 || (adj.get(n.id)?.size || 0) >= 4 || view.k > 1.5 || (query && matches(n)));
      if (showL && isLit) {
        const fs = 11 / view.k;
        ctx.font = `${n.id === focus ? 600 : 500} ${fs}px ${getFont()}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const label = basename(n.id);
        ctx.lineWidth = 3 / view.k;
        ctx.strokeStyle = pal.bg;
        ctx.strokeText(label, n.x, n.y + r + 4 / view.k);
        ctx.fillStyle = n.ghost ? pal.err : n.id === focus ? pal.text : pal.text2;
        ctx.fillText(label, n.x, n.y + r + 4 / view.k);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    return anim;
  }

  let fontCache = '';
  const getFont = () => fontCache || (fontCache = getComputedStyle(document.body).fontFamily);

  function mix(a, b, t) {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    if (!/^#[0-9a-f]{6}$/i.test(a)) return a;
    const [x, y] = [p(a), p(b)];
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    if (!dirty) return;
    dirty = false;
    if (draw()) dirty = true;
  }

  // ---------------------------------------------------------------- view helpers
  const toGraph = (sx, sy) => ({ x: (sx - size.w / 2 - view.x) / view.k, y: (sy - size.h / 2 - view.y) / view.k });

  function hit(sx, sy) {
    const p = toGraph(sx, sy);
    let best = null;
    let bd = Infinity;
    for (const n of nodes) {
      if (!visible(n) || n.x == null) continue;
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < R(n) + 5 / view.k && d < bd) {
        best = n;
        bd = d;
      }
    }
    return best;
  }

  function animateView(target, ms = 600) {
    if (reduced()) {
      view = target;
      dirty = true;
      return;
    }
    const from = { ...view };
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      view = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, k: from.k + (target.k - from.k) * e };
      dirty = true;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function fit() {
    const vs = nodes.filter((n) => visible(n) && n.x != null);
    if (!vs.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of vs) {
      x0 = Math.min(x0, n.x - R(n));
      y0 = Math.min(y0, n.y - R(n));
      x1 = Math.max(x1, n.x + R(n));
      y1 = Math.max(y1, n.y + R(n) + 14);
    }
    // leave room for the legend (bottom) and controls (right)
    const k = clamp(Math.min((size.w - 120) / (x1 - x0 || 1), (size.h - 160) / (y1 - y0 || 1)), 0.2, 2.2);
    animateView({ k, x: -((x0 + x1) / 2) * k - 10, y: -((y0 + y1) / 2) * k - 30 });
  }

  function focusNode(id) {
    const n = nodes.find((x) => x.id === id);
    if (!n) return;
    selected = id;
    const k = Math.max(view.k, 1.4);
    animateView({ k, x: -n.x * k, y: -n.y * k });
  }

  function zoomBy(f, sx = size.w / 2, sy = size.h / 2) {
    const p = toGraph(sx, sy);
    const k = clamp(view.k * f, 0.12, 6);
    view = { k, x: sx - size.w / 2 - p.x * k, y: sy - size.h / 2 - p.y * k };
    dirty = true;
  }

  // ---------------------------------------------------------------- pointer input
  const pointers = new Map();
  let drag = null; // { node?, startX, startY, vx, vy, moved }
  let pinch = null;

  function local(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onpointerdown(e) {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
      drag = null;
      return;
    }
    const n = hit(p.x, p.y);
    drag = { node: n, sx: p.x, sy: p.y, vx: view.x, vy: view.y, moved: false };
    if (n) {
      n.fx = n.x;
      n.fy = n.y;
      if (!reduced()) sim?.alphaTarget(0.25).restart();
    }
  }

  function onpointermove(e) {
    const p = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const target = clamp((pinch.k * d) / (pinch.d || 1), 0.12, 6);
      zoomBy(target / view.k, (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (drag) {
      const dx = p.x - drag.sx, dy = p.y - drag.sy;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (drag.node) {
        const g = toGraph(p.x, p.y);
        drag.node.fx = g.x;
        drag.node.fy = g.y;
        if (reduced()) {
          drag.node.x = g.x;
          drag.node.y = g.y;
        }
      } else {
        view = { ...view, x: drag.vx + dx, y: drag.vy + dy };
      }
      dirty = true;
      return;
    }
    const n = hit(p.x, p.y);
    if (n?.id !== hover?.id) hover = n;
    tip = { x: p.x, y: p.y };
    canvas.style.cursor = n ? 'pointer' : 'grab';
  }

  function onpointerup(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.node) {
      d.node.fx = null;
      d.node.fy = null;
      sim?.alphaTarget(0);
      if (!d.moved) {
        selected = d.node.id;
        if (!d.node.ghost) openFile(d.node.id, { drawer: true });
      }
    } else if (!d.moved) {
      selected = null;
    }
  }

  function onwheel(e) {
    e.preventDefault();
    const p = local(e);
    zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), p.x, p.y);
  }

  function onkeydown(e) {
    if (e.key === '+' || e.key === '=') zoomBy(1.25);
    else if (e.key === '-') zoomBy(0.8);
    else if (e.key === '0') fit();
  }

  function onsearch(e) {
    if (e.key === 'Enter') {
      const n = nodes.find((x) => matches(x));
      if (n) focusNode(n.id);
    }
  }

  onMount(() => {
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      size = { w: r.width, h: r.height, dpr: Math.min(2.5, window.devicePixelRatio || 1) };
      canvas.width = Math.round(size.w * size.dpr);
      canvas.height = Math.round(size.h * size.dpr);
      canvas.style.width = size.w + 'px';
      canvas.style.height = size.h + 'px';
      dirty = true;
    });
    ro.observe(wrap);
    canvas.addEventListener('wheel', onwheel, { passive: false });
    raf = requestAnimationFrame(loop);
    return () => {
      ro.disconnect();
      canvas.removeEventListener('wheel', onwheel);
      cancelAnimationFrame(raf);
      sim?.stop();
    };
  });

  function toggle(set, v) {
    const s = new Set(set);
    s.has(v) ? s.delete(v) : s.add(v);
    return s;
  }

  const hoverDeg = $derived(hover ? adj.get(hover.id)?.size || 0 : 0);
</script>

<div class="page graph-page">
  <div class="page-h">
    <div>
      <h1>Link graph</h1>
      <p>
        {#if stats}{stats.nodes} files · {stats.edges} links{#if stats.broken} · <span class="err">{stats.broken} broken</span>{/if}{:else}Loading…{/if}
      </p>
    </div>
    <span class="spacer"></span>
    <div class="searchbox">
      <Icon name="search" size={14} />
      <input class="input" placeholder="Find node… (Enter to focus)" bind:value={query} onkeydown={onsearch} aria-label="Find node" />
    </div>
  </div>

  <div class="gwrap card" bind:this={wrap}>
    <canvas
      bind:this={canvas}
      tabindex="0"
      aria-label="Link graph of {stats?.nodes ?? 0} files. Use + and - to zoom, 0 to fit."
      {onpointerdown}
      {onpointermove}
      {onpointerup}
      onpointercancel={onpointerup}
      onpointerleave={() => (hover = null)}
      ondblclick={fit}
      {onkeydown}
    ></canvas>

    {#if graph.error}
      <div class="overlay-msg">Could not load graph: {graph.error.message}</div>
    {:else if !graph.data}
      <div class="overlay-msg"><span class="spin"></span></div>
    {/if}

    <div class="ctrl">
      <button class="btn icon sm" onclick={() => zoomBy(1.25)} aria-label="Zoom in"><Icon name="plus" size={14} /></button>
      <button class="btn icon sm" onclick={() => zoomBy(0.8)} aria-label="Zoom out"><Icon name="minus" size={14} /></button>
      <button class="btn icon sm" onclick={fit} aria-label="Fit to screen"><Icon name="maximize" size={14} /></button>
      <button class="btn icon sm" class:on={showLabels} onclick={() => (showLabels = !showLabels)} aria-label="Toggle labels" title="Labels">Aa</button>
      <button class="btn icon sm" onclick={() => sim?.alpha(0.9).restart()} aria-label="Re-run layout" title="Re-run layout"><Icon name="refresh" size={14} /></button>
    </div>

    <div class="legend">
      <div class="lg-row">
        {#each tools as t (t)}
          <button class="lg chip" class:off={hidden.has(t)} onclick={() => (hidden = toggle(hidden, t))} style="--c:var(--tool-{t})">
            <span class="tool-dot"></span>{TOOLS[t].label}
          </button>
        {/each}
      </div>
      <div class="lg-row">
        {#each linkTypes as lt (lt)}
          <button class="lg chip" class:off={hiddenLinks.has(lt)} onclick={() => (hiddenLinks = toggle(hiddenLinks, lt))}>
            <svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" stroke-width={Math.min(2.4, LINK_TYPES[lt]?.width || 1) + 0.4} stroke-dasharray={(LINK_TYPES[lt]?.dash || []).join(' ')} /></svg>
            {LINK_TYPES[lt]?.label || lt}
          </button>
        {/each}
        {#if stats?.broken}
          <span class="lg chip broken"><svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" stroke-width="1.6" stroke-dasharray="4 4" /></svg>broken</span>
        {/if}
      </div>
    </div>

    {#if hover}
      <div class="tip card" style="left:{Math.min(tip.x + 14, size.w - 250)}px;top:{Math.min(tip.y + 14, size.h - 120)}px">
        <div class="mono tp">{hover.id}</div>
        {#if hover.ghost}
          <div class="err small">Missing file — referenced by {hoverDeg} file{hoverDeg === 1 ? '' : 's'}</div>
        {:else}
          <div class="row small" style="flex-wrap:wrap">
            <ToolBadge tool={hover.tool} />
            <span class="badge">{KINDS[hover.kind] || hover.kind}</span>
          </div>
          <div class="row small muted"><b class="tnum">{fmtNum(hover.tokens)}</b> tokens · {hoverDeg} links</div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .graph-page { display: flex; flex-direction: column; height: calc(100dvh - var(--topbar-h)); padding-bottom: 20px; }
  .page-h { flex-shrink: 0; }
  .err { color: var(--err); }
  .searchbox { position: relative; display: flex; align-items: center; color: var(--text-3); }
  .searchbox :global(.icon) { position: absolute; left: 10px; pointer-events: none; }
  .searchbox .input { padding-left: 30px; width: 260px; }
  .gwrap { flex: 1; min-height: 380px; overflow: hidden; padding: 0; }
  canvas { display: block; touch-action: none; cursor: grab; outline: none; position: absolute; inset: 0; }
  canvas:active { cursor: grabbing; }
  .overlay-msg { position: absolute; inset: 0; display: grid; place-items: center; color: var(--text-3); pointer-events: none; }
  .ctrl { position: absolute; top: 12px; right: 12px; display: flex; flex-direction: column; gap: 6px; }
  .ctrl .btn { background: var(--panel-solid); font-size: 11px; font-weight: 700; }
  .ctrl .btn.on { color: var(--accent); }
  .legend { position: absolute; left: 12px; bottom: 12px; right: 60px; display: flex; flex-direction: column; gap: 6px; pointer-events: none; }
  .lg-row { display: flex; gap: 6px; flex-wrap: wrap; }
  .lg { pointer-events: auto; background: color-mix(in srgb, var(--panel-solid) 85%, transparent); backdrop-filter: blur(8px); height: 24px; font-size: 11.5px; }
  .lg.off { opacity: 0.4; text-decoration: line-through; }
  .lg.broken { color: var(--err); cursor: default; }
  .tip { position: absolute; pointer-events: none; padding: 10px 12px; width: 240px; display: flex; flex-direction: column; gap: 6px; background: var(--panel-solid); box-shadow: var(--shadow-lg); z-index: 3; }
  .tp { font-size: 12px; font-weight: 600; word-break: break-all; }
  .small { font-size: 12px; }
  .spin { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--border-strong); border-top-color: var(--accent); animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 760px) {
    .graph-page { height: calc(100dvh - var(--topbar-h) - 64px); }
    .searchbox, .searchbox .input { width: 100%; }
    .legend { right: 12px; }
    .lg-row:last-child { display: none; }
  }
</style>
