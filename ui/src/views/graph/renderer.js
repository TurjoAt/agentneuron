// Canvas renderer for Graph 2.0 (owner: UI-B).
// - devicePixelRatio-aware, batched edge strokes, sprite glows → 1k+ nodes at 60fps
// - animated layout transitions (staggered), projection blend for the 3D orbit
// - LOD labels with screen-space collision, hover/focus/path emphasis
// - signal particles along edges, pulse rings, minimap
// Renders only while something moves (idle = zero CPU).

import { zoom as d3zoom, zoomIdentity } from 'd3-zoom';
import { select } from 'd3-selection';
import { groupKey } from './layouts.js';

const TAU = Math.PI * 2;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const lerp = (a, b, t) => a + (b - a) * t;

function hexToRgb(h) {
  const s = h.replace('#', '');
  const v = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
function rampColor(stops, t) {
  t = clamp01(t);
  const f = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(f));
  const a = hexToRgb(stops[i]), b = hexToRgb(stops[i + 1]);
  const u = f - i;
  return `rgb(${Math.round(lerp(a[0], b[0], u))},${Math.round(lerp(a[1], b[1], u))},${Math.round(lerp(a[2], b[2], u))})`;
}
const HEAT = {
  dark: ['#2a3243', '#5a4234', '#a5552c', '#ff8a4c', '#ffd0a6'],
  light: ['#dfe3ea', '#f2c6a9', '#e8905c', '#d9622b', '#8a3410'],
};
const AGE = {
  dark: ['#a99fff', '#7d70e6', '#544b9a', '#363552', '#272a36'],
  light: ['#4535c9', '#6a5ce0', '#9c93e8', '#c9c5ea', '#e3e3ea'],
};

export class GraphRenderer {
  constructor({ canvas, mini, onHover, onClick, onDblClick, onContext, onCamera, onMini, reduced }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mini = mini;
    this.mctx = mini?.getContext('2d');
    this.cb = { onHover, onClick, onDblClick, onContext, onCamera, onMini };
    this.reduced = reduced || (() => false);
    this.W = 300;
    this.H = 200;
    this.dpr = 1;
    this.nodes = [];
    this.edges = [];
    this.ns = new Map(); // id -> runtime node state
    this.exiting = [];
    this.layout = { pos: new Map(), deco: {}, projection: 0, curve: 'line' };
    this.prevLayout = null;
    this.tween = null; // { t0, dur }
    this.proj = { from: 0, to: 0 };
    this.yaw = 0.6;
    this.pitch = -0.25;
    this.cam = zoomIdentity;
    this.camAnim = null;
    this.state = { hover: null, selected: null, focus: null, path: null, colorMode: 'tool', labels: 'auto', matches: null, groupBy: 'folder' };
    this.particles = [];
    this.pulses = new Map(); // id -> t0
    this.theme = { dark: true, text: '#e8eaf1', text2: '#a4aabb', text3: '#6a7183', bg: '#07080d', panel: '#12151e', err: '#fb7185', warn: '#fbbf24', ok: '#34d399', accent: '#8b7dff', border: 'rgba(255,255,255,.08)', tool: {}, kind: () => '#888' };
    this.sprites = new Map();
    this.raf = 0;
    this.lastT = 0;
    this.drag = null;
    this.hoverCell = null;
    this.fitPending = true;
    this._bind();
  }

  // ------------------------------------------------------------- setup
  _bind() {
    const c = this.canvas;
    this.zoom = d3zoom()
      .scaleExtent([0.04, 10])
      .filter((ev) => {
        if (ev.type === 'wheel') return !ev.ctrlKey || true;
        if (ev.button && ev.type === 'mousedown') return false;
        if (this.layout.projection > 0.5) {
          if (ev.type === 'mousedown' && !ev.shiftKey) return false;
          if (ev.type === 'touchstart' && ev.touches?.length === 1) return false;
        }
        return true;
      })
      .on('zoom', (ev) => {
        this.cam = ev.transform;
        this.cb.onCamera?.(this.cam);
        this.request();
      });
    this.sel = select(c).call(this.zoom).on('dblclick.zoom', null);

    this._pd = (e) => {
      this.drag = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false, yaw: this.yaw, pitch: this.pitch, id: e.pointerId };
      this.interacting = true;
    };
    this._pm = (e) => {
      const r = c.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      if (this.drag && this.drag.id === e.pointerId) {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
        if (this.layout.projection > 0.5 && !e.shiftKey && (e.pointerType !== 'touch' || e.isPrimary)) {
          this.yaw = this.drag.yaw + dx * 0.006;
          this.pitch = Math.max(-1.35, Math.min(1.35, this.drag.pitch + dy * 0.006));
          this.request();
        }
        if (this.drag.moved) return;
      }
      this._hoverAt(mx, my, e);
    };
    this._pu = (e) => {
      const d = this.drag;
      this.drag = null;
      this.interacting = false;
      if (!d || d.moved || e.button > 0) return;
      const r = c.getBoundingClientRect();
      const hit = this.hit(e.clientX - r.left, e.clientY - r.top);
      this.cb.onClick?.(hit, e);
    };
    this._pl = () => {
      if (this.state.hover || this.hoverCell) {
        this.hoverCell = null;
        this.cb.onHover?.(null);
      }
    };
    this._dbl = (e) => {
      const r = c.getBoundingClientRect();
      const hit = this.hit(e.clientX - r.left, e.clientY - r.top);
      this.cb.onDblClick?.(hit, e);
    };
    this._ctx = (e) => {
      const r = c.getBoundingClientRect();
      const hit = this.hit(e.clientX - r.left, e.clientY - r.top);
      e.preventDefault();
      this.cb.onContext?.(hit, e);
    };
    c.addEventListener('pointerdown', this._pd);
    window.addEventListener('pointermove', this._pm);
    window.addEventListener('pointerup', this._pu);
    c.addEventListener('pointerleave', this._pl);
    c.addEventListener('dblclick', this._dbl);
    c.addEventListener('contextmenu', this._ctx);

    if (this.mini) {
      const go = (e) => {
        const r = this.mini.getBoundingClientRect();
        const w = this.miniMap;
        if (!w) return;
        const wx = (e.clientX - r.left - w.ox) / w.s;
        const wy = (e.clientY - r.top - w.oy) / w.s;
        this.centerOn(wx, wy, this.cam.k, false);
      };
      this._mpd = (e) => {
        this._mdrag = true;
        this.mini.setPointerCapture?.(e.pointerId);
        go(e);
      };
      this._mpm = (e) => this._mdrag && go(e);
      this._mpu = () => (this._mdrag = false);
      this.mini.addEventListener('pointerdown', this._mpd);
      this.mini.addEventListener('pointermove', this._mpm);
      this.mini.addEventListener('pointerup', this._mpu);
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.sel?.on('.zoom', null);
    const c = this.canvas;
    c.removeEventListener('pointerdown', this._pd);
    window.removeEventListener('pointermove', this._pm);
    window.removeEventListener('pointerup', this._pu);
    c.removeEventListener('pointerleave', this._pl);
    c.removeEventListener('dblclick', this._dbl);
    c.removeEventListener('contextmenu', this._ctx);
    if (this.mini) {
      this.mini.removeEventListener('pointerdown', this._mpd);
      this.mini.removeEventListener('pointermove', this._mpm);
      this.mini.removeEventListener('pointerup', this._mpu);
    }
  }

  resize(w, h) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const first = this.W === 300 && this.H === 200;
    if (w === this.W && h === this.H && dpr === this.dpr) return;
    const old = { W: this.W, H: this.H };
    this.W = Math.max(50, w);
    this.H = Math.max(50, h);
    this.dpr = dpr;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.canvas.style.width = this.W + 'px';
    this.canvas.style.height = this.H + 'px';
    if (this.mini) {
      const mw = this.mini.clientWidth || 180, mh = this.mini.clientHeight || 120;
      this.mini.width = Math.round(mw * dpr);
      this.mini.height = Math.round(mh * dpr);
    }
    if (first || this.fitPending) this.fit(null, false);
    else {
      // keep the same world point centred
      const t = this.cam;
      this.setCamera(zoomIdentity.translate(t.x + (this.W - old.W) / 2, t.y + (this.H - old.H) / 2).scale(t.k));
    }
    this.request();
  }

  setTheme(theme) {
    this.theme = { ...this.theme, ...theme };
    this.sprites.clear();
    this.request();
  }

  setState(patch) {
    Object.assign(this.state, patch);
    this.request();
  }

  // ------------------------------------------------------------- data + layout
  /** Replace the visible node/edge set (filters) — new nodes fade in, removed fade out. */
  setData(nodes, edges) {
    const keep = new Set(nodes.map((n) => n.id));
    const now = performance.now();
    for (const [id, s] of this.ns) {
      if (!keep.has(id)) {
        this.exiting.push({ ...s, t0: now });
        this.ns.delete(id);
      }
    }
    for (const n of nodes) {
      let s = this.ns.get(n.id);
      if (!s) {
        s = { id: n.id, n, x: NaN, y: NaN, z: 0, fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, a: 0, em: 1, enter: now, sx: 0, sy: 0, sr: 0, depth: 0 };
        this.ns.set(n.id, s);
      } else s.n = n;
    }
    this.nodes = nodes;
    this.edges = edges;
    this.request();
  }

  setLayout(layout, { animate = true, fit = true } = {}) {
    const reduced = this.reduced();
    const now = performance.now();
    this.prevLayout = this.layout;
    this.layout = layout;
    const curProj = this._projNow(now);
    this.proj = { from: curProj, to: layout.projection || 0 };
    const order = this.nodes;
    const N = order.length;
    // neighbor positions for entering nodes
    order.forEach((n, i) => {
      const s = this.ns.get(n.id);
      const t = layout.pos.get(n.id) || { x: 0, y: 0, z: 0 };
      if (!Number.isFinite(s.x)) {
        // enter from a neighbor that already has a position, else from the target
        s.x = t.x * 0.85;
        s.y = t.y * 0.85;
        s.z = t.z || 0;
      }
      s.fx = s.x;
      s.fy = s.y;
      s.fz = s.z;
      s.tx = t.x;
      s.ty = t.y;
      s.tz = t.z || 0;
      s.delay = N > 1 ? (i / N) * 0.22 : 0;
    });
    if (reduced || !animate) {
      for (const s of this.ns.values()) {
        s.x = s.tx;
        s.y = s.ty;
        s.z = s.tz;
      }
      this.tween = null;
      this.proj.from = this.proj.to;
    } else {
      this.tween = { t0: now, dur: Math.min(1400, 800 + N * 0.4) };
    }
    if (fit) this.fit(null, animate && !reduced);
    this.request();
  }

  /** Positions as they are right now (used for force warm start). */
  currentPositions() {
    const m = new Map();
    for (const [id, s] of this.ns) if (Number.isFinite(s.x)) m.set(id, { x: s.x, y: s.y });
    return m;
  }

  _projNow(now) {
    if (!this.tween) return this.proj.to;
    const p = easeInOut(clamp01((now - this.tween.t0) / this.tween.dur));
    return lerp(this.proj.from, this.proj.to, p);
  }

  // ------------------------------------------------------------- camera
  setCamera(t) {
    this.sel.call(this.zoom.transform, t);
  }

  centerOn(wx, wy, k = this.cam.k, animate = true) {
    const t = zoomIdentity.translate(this.W / 2 - wx * k, this.H / 2 - wy * k).scale(k);
    if (animate && !this.reduced()) this._animateCam(t);
    else this.setCamera(t);
  }

  /** Fit all (or the given ids) into view, using target positions. */
  fit(ids = null, animate = true) {
    this.fitPending = false;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const P = this.layout.projection;
    const R = this.layout.deco?.sphere;
    if (P > 0.5 && R && !ids) {
      x0 = -R * 1.25; x1 = R * 1.25; y0 = -R * 1.25; y1 = R * 1.25;
    } else {
      for (const s of this.ns.values()) {
        if (ids && !ids.has(s.id)) continue;
        const x = s.tx, y = s.ty;
        if (!Number.isFinite(x)) continue;
        x0 = Math.min(x0, x - s.n.r); x1 = Math.max(x1, x + s.n.r);
        y0 = Math.min(y0, y - s.n.r); y1 = Math.max(y1, y + s.n.r);
      }
      const d = this.layout.deco || {};
      if (!ids) {
        for (const c of d.columns || []) { y0 = Math.min(y0, c.top - 10); y1 = Math.max(y1, c.bottom); }
        for (const r of d.rings || []) { x0 = Math.min(x0, -r.r); x1 = Math.max(x1, r.r); y0 = Math.min(y0, -r.r); y1 = Math.max(y1, r.r); }
        for (const h of d.hulls || []) { x0 = Math.min(x0, h.x - h.r); x1 = Math.max(x1, h.x + h.r); y0 = Math.min(y0, h.y - h.r - 16); y1 = Math.max(y1, h.y + h.r); }
        if (d.lanes) { x0 = Math.min(x0, d.x0 - 120); x1 = Math.max(x1, d.x1); y0 -= 30; y1 += 30; }
        if (d.matrix) { x0 -= 120; y0 -= 90; }
      }
    }
    if (!Number.isFinite(x0)) {
      x0 = -100; x1 = 100; y0 = -100; y1 = 100;
    }
    const pad = Math.min(60, this.W * 0.06);
    const w = Math.max(40, x1 - x0), h = Math.max(40, y1 - y0);
    let k = Math.min((this.W - pad * 2) / w, (this.H - pad * 2) / h);
    k = Math.max(0.05, Math.min(ids ? 2.2 : 1.6, k));
    this.centerOn((x0 + x1) / 2, (y0 + y1) / 2, k, animate);
  }

  _animateCam(to) {
    this.camAnim = { from: this.cam, to, t0: performance.now(), dur: 750 };
    this.request();
  }

  zoomBy(f) {
    const t = this.cam;
    const k = Math.max(0.04, Math.min(10, t.k * f));
    const cx = (this.W / 2 - t.x) / t.k, cy = (this.H / 2 - t.y) / t.k;
    this.centerOn(cx, cy, k, true);
  }

  // ------------------------------------------------------------- live signals
  /** Signal particles travel from `id` along its edges (SSE file change). */
  pulse(id) {
    const now = performance.now();
    this.pulses.set(id, now);
    if (this.reduced()) return this.request();
    let k = 0;
    for (const e of this.edges) {
      if (e.source.id !== id && e.target.id !== id) continue;
      if (k++ > 40) break;
      const fwd = e.source.id === id;
      for (let j = 0; j < 2; j++) this.particles.push({ e, fwd, t0: now + j * 260 + Math.random() * 120, dur: 1100 + Math.random() * 500 });
    }
    if (this.particles.length > 900) this.particles.splice(0, this.particles.length - 900);
    this.request();
  }

  // ------------------------------------------------------------- hit testing
  hit(mx, my) {
    const m = this.layout.deco?.matrix;
    // nodes first (front to back)
    let best = null, bd = Infinity;
    for (const s of this.ns.values()) {
      if (s.a < 0.2 || s.em < 0.1) continue;
      const d = Math.hypot(s.sx - mx, s.sy - my);
      const rr = Math.max(s.sr + 3, 7);
      if (d < rr && (d < bd || (best && s.depth < best.depth - 1))) {
        best = s;
        bd = d;
      }
    }
    if (best) return { node: best.n };
    if (m && !this.tween) {
      const k = this.cam.k;
      const wx = (mx - this.cam.x) / k + m.off, wy = (my - this.cam.y) / k + m.off;
      const col = Math.floor(wx / m.s), row = Math.floor(wy / m.s);
      if (col >= 0 && row >= 0 && col < m.n && row < m.n) {
        const a = this.ns.get(m.order[row])?.n, b = this.ns.get(m.order[col])?.n;
        if (a && b) {
          const es = this.edges.filter((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a));
          return { cell: { a, b, edges: es, row, col } };
        }
      }
    }
    return null;
  }

  _hoverAt(mx, my, e) {
    const h = this.hit(mx, my);
    const id = h?.node?.id || null;
    const cell = h?.cell ? `${h.cell.row}:${h.cell.col}` : null;
    if (id !== (this.state.hover || null) || cell !== this.hoverCell) {
      this.hoverCell = cell;
      this.cb.onHover?.(h, { x: mx, y: my, ev: e });
    } else if (h) this.cb.onHover?.(h, { x: mx, y: my, ev: e, move: true });
    this.canvas.style.cursor = id ? 'pointer' : this.layout.projection > 0.5 ? 'grab' : 'default';
  }

  /** Screen position of a node (for HTML overlays). */
  screenOf(id) {
    const s = this.ns.get(id);
    return s ? { x: s.sx, y: s.sy, r: s.sr } : null;
  }

  // ------------------------------------------------------------- frame loop
  request() {
    if (!this.raf) this.raf = requestAnimationFrame((t) => this._frame(t));
  }

  _frame(t) {
    this.raf = 0;
    const dt = this.lastT ? Math.min(64, t - this.lastT) : 16;
    this.lastT = t;
    let more = false;
    // camera animation
    if (this.camAnim) {
      const a = this.camAnim;
      const p = easeInOut(clamp01((t - a.t0) / a.dur));
      const k = a.from.k * Math.pow(a.to.k / a.from.k, p);
      const x = lerp(a.from.x, a.to.x, p), y = lerp(a.from.y, a.to.y, p);
      this.setCamera(zoomIdentity.translate(x, y).scale(k));
      if (p >= 1) this.camAnim = null;
      else more = true;
    }
    // layout tween
    let p = 1;
    if (this.tween) {
      p = clamp01((t - this.tween.t0) / this.tween.dur);
      for (const s of this.ns.values()) {
        const q = easeInOut(clamp01((p - s.delay) / (1 - 0.22)));
        s.x = lerp(s.fx, s.tx, q);
        s.y = lerp(s.fy, s.ty, q);
        s.z = lerp(s.fz, s.tz, q);
      }
      if (p >= 1) this.tween = null;
      else more = true;
    }
    this.layoutP = p;
    // orbit auto-rotate
    const P = this._projNow(t);
    if (this.layout.projection > 0.5 && !this.interacting && !this.reduced() && !this.state.hover && this.autoRotate !== false) {
      this.yaw += dt * 0.00009;
      more = true;
    }
    if (this._draw(t, P)) more = true;
    if (more) this.request();
  }

  // ------------------------------------------------------------- drawing
  _sprite(color) {
    let s = this.sprites.get(color);
    if (s) return s;
    s = document.createElement('canvas');
    s.width = s.height = 64;
    const g = s.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, color);
    grd.addColorStop(0.25, color);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 1;
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    this.sprites.set(color, s);
    return s;
  }

  _nodeColor(n) {
    const th = this.theme;
    const mode = this.state.colorMode;
    if (n.missing) return th.err;
    if (mode === 'churn') return rampColor(HEAT[th.dark ? 'dark' : 'light'], n.churn ? 0.18 + 0.82 * Math.sqrt(n.heat) : 0);
    if (mode === 'age') {
      const ageD = n.age / 86_400_000;
      return rampColor(AGE[th.dark ? 'dark' : 'light'], Number.isFinite(ageD) ? Math.log1p(ageD) / Math.log1p(180) : 1);
    }
    if (mode === 'kind') return th.kind(n.kind);
    if (mode === 'health') return n.issues?.error || n.hasBroken ? th.err : n.issues?.warn ? th.warn : n.issues ? th.text3 : th.ok;
    return th.tool[n.tool] || th.tool.generic || '#8b97a8';
  }

  _project(s, P, R) {
    if (P <= 0.001) {
      s.px = s.x;
      s.py = s.y;
      s.scale = 1;
      s.depth = 0;
      s.shade = 1;
      return;
    }
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const x1 = s.x * cy + s.z * sy;
    const z1 = -s.x * sy + s.z * cy;
    const y2 = s.y * cp - z1 * sp;
    const z2 = s.y * sp + z1 * cp;
    const f = (R || 300) * 3.2;
    const sc = f / (f + z2);
    s.px = lerp(s.x, x1 * sc, P);
    s.py = lerp(s.y, y2 * sc, P);
    s.scale = lerp(1, sc, P);
    s.depth = z2 * P;
    const d = clamp01((z2 + (R || 300)) / (2 * (R || 300)));
    s.shade = lerp(1, 1 - d * 0.72, P);
  }

  _draw(t, P) {
    const ctx = this.ctx;
    const th = this.theme;
    const { W, H, dpr, cam } = this;
    const k = cam.k;
    const st = this.state;
    let more = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const R = this.layout.deco?.sphere || this.prevLayout?.deco?.sphere || 300;

    // --- emphasis targets
    const lit = new Set();
    let mode = 'none';
    if (st.path?.length) {
      mode = 'path';
      st.path.forEach((id) => lit.add(id));
    } else if (st.focus) mode = 'focus';
    const hov = st.hover && this.ns.has(st.hover) ? st.hover : null;
    const hovN = hov ? new Set([hov, ...(this.edgeNeighbors(hov))]) : null;
    const matches = st.matches;

    // --- project + node emphasis (smoothed)
    const mx = this.layout.deco?.matrix;
    const list = [];
    for (const s of this.ns.values()) {
      this._project(s, P, R);
      s.sx = s.px * k + cam.x;
      s.sy = s.py * k + cam.y;
      s.sr = Math.max(1.2, s.n.r * s.scale * Math.min(1.8, Math.max(0.55, Math.sqrt(k))));
      if (mx) s.sr = lerp(s.sr, Math.min(s.sr, mx.s * k * 0.42), this.layoutP ?? 1);
      let target = 1;
      if (mode === 'path') target = lit.has(s.id) ? 1 : 0.1;
      else if (mode === 'focus') {
        const h = st.focus.get(s.id);
        target = h == null ? 0.06 : h <= 1 ? 1 : 0.7;
      }
      if (matches && !matches.has(s.id)) target = Math.min(target, 0.18);
      if (hovN) target = hovN.has(s.id) ? Math.max(target, 1) : Math.min(target, 0.2);
      if (st.selected === s.id) target = 1;
      const dE = target - s.em;
      if (Math.abs(dE) > 0.01) {
        s.em += dE * (this.reduced() ? 1 : 0.22);
        more = true;
      } else s.em = target;
      // enter fade
      const age = t - s.enter;
      s.a = this.reduced() ? 1 : clamp01(age / 500);
      if (s.a < 1) more = true;
      list.push(s);
    }
    if (P > 0.01) list.sort((a, b) => b.depth - a.depth);

    // --- decorations
    this._drawDeco(ctx, t, k);

    // --- edges
    const m = this.layout.deco?.matrix;
    const curve = (this.layoutP ?? 1) < 0.5 && this.prevLayout ? this.prevLayout.curve : this.layout.curve;
    if (m && (this.layoutP ?? 1) > 0.35) this._drawMatrix(ctx, m, k, clamp01(((this.layoutP ?? 1) - 0.35) / 0.5));
    const edgeFade = m ? 1 - clamp01(((this.layoutP ?? 1) - 0.1) / 0.4) : curve === 'none' ? clamp01(1 - (this.layoutP ?? 1) * 2) : 1;
    if (edgeFade > 0.01) this._drawEdges(ctx, curve, k, P, edgeFade, mode, hov, lit);

    // --- particles
    if (this.particles.length || (mode === 'path' && !this.reduced())) {
      if (this._drawParticles(ctx, t, curve, mode, lit)) more = true;
    }

    // --- nodes
    const dark = th.dark;
    for (const s of list) {
      const n = s.n;
      const alpha = s.a * s.em * s.shade;
      if (alpha < 0.02) continue;
      if (s.sx < -40 || s.sy < -40 || s.sx > W + 40 || s.sy > H + 40) continue;
      const col = this._nodeColor(n);
      const r = s.sr * (0.4 + 0.6 * s.a);
      // glow: selected / hovered / pulsing / hot
      const pt = this.pulses.get(n.id);
      const pulsing = pt != null && t - pt < 2400;
      const glowAmt = (st.selected === n.id || hov === n.id ? 1 : 0) || (pulsing ? 1 - (t - pt) / 2400 : 0) || (st.colorMode === 'churn' && n.heat > 0.4 ? n.heat * 0.6 : 0) || (dark && r > 6 && alpha > 0.5 ? 0.22 : 0);
      if (glowAmt > 0.02 && r > 1.5) {
        ctx.globalAlpha = Math.min(1, glowAmt) * alpha * (dark ? 0.55 : 0.35);
        const gs = r * 5;
        ctx.drawImage(this._sprite(col), s.sx - gs / 2, s.sy - gs / 2, gs, gs);
      }
      ctx.globalAlpha = alpha;
      if (n.missing) {
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = th.err;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(s.sx, s.sy, Math.max(3, r), 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(s.sx, s.sy, r, 0, TAU);
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = th.bg;
        ctx.stroke();
      }
      if (st.selected === n.id || (matches && matches.has(n.id) && matches.size < 60)) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = st.selected === n.id ? th.text : th.accent;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(s.sx, s.sy, r + 4, 0, TAU);
        ctx.stroke();
      }
      if (pulsing) {
        const q = (t - pt) / 2400;
        ctx.globalAlpha = (1 - q) * 0.8 * s.em;
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(s.sx, s.sy, r + 3 + easeOut(q) * 22, 0, TAU);
        ctx.stroke();
        more = true;
      }
      // issue marker
      if ((n.issues?.error || n.issues?.warn || n.hasBroken) && r > 3.5 && k > 0.5 && alpha > 0.3) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = n.issues?.error || n.hasBroken ? th.err : th.warn;
        ctx.beginPath();
        ctx.arc(s.sx + r * 0.75, s.sy - r * 0.75, Math.max(2, r * 0.28), 0, TAU);
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = th.bg;
        ctx.stroke();
      }
    }
    // exiting nodes fade out
    if (this.exiting.length) {
      this.exiting = this.exiting.filter((s) => t - s.t0 < 320);
      for (const s of this.exiting) {
        ctx.globalAlpha = (1 - (t - s.t0) / 320) * 0.7;
        ctx.fillStyle = this._nodeColor(s.n);
        ctx.beginPath();
        ctx.arc(s.sx, s.sy, s.sr * (1 - (t - s.t0) / 400), 0, TAU);
        ctx.fill();
      }
      more = true;
    }
    for (const [id, pt] of this.pulses) if (t - pt > 2600) this.pulses.delete(id);

    // --- labels
    if (!m || (this.layoutP ?? 1) < 0.6) this._drawLabels(ctx, list, k, hov, hovN, lit, mode);
    ctx.globalAlpha = 1;

    this._drawMini();
    return more;
  }

  edgeNeighbors(id) {
    const out = [];
    for (const e of this.edges) {
      if (e.source.id === id) out.push(e.target.id);
      else if (e.target.id === id) out.push(e.source.id);
    }
    return out;
  }

  _edgePath(ctx, a, b, curve, move = true) {
    if (move) ctx.moveTo(a.sx, a.sy);
    if (curve === 'neural') {
      const dx = b.sx - a.sx;
      if (Math.abs(dx) > 18) ctx.bezierCurveTo(a.sx + dx * 0.5, a.sy, b.sx - dx * 0.5, b.sy, b.sx, b.sy);
      else {
        const bulge = 30 * this.cam.k + Math.abs(b.sy - a.sy) * 0.22;
        ctx.quadraticCurveTo(a.sx + bulge, (a.sy + b.sy) / 2, b.sx, b.sy);
      }
    } else if (curve === 'radial') {
      const cx = this.cam.x, cy = this.cam.y;
      const mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
      ctx.quadraticCurveTo(lerp(mx, cx, 0.22), lerp(my, cy, 0.22), b.sx, b.sy);
    } else ctx.lineTo(b.sx, b.sy);
  }

  _edgePoint(a, b, curve, u) {
    if (curve === 'neural') {
      const dx = b.sx - a.sx;
      if (Math.abs(dx) > 18) {
        const p1x = a.sx + dx * 0.5, p1y = a.sy, p2x = b.sx - dx * 0.5, p2y = b.sy;
        const v = 1 - u;
        return [v * v * v * a.sx + 3 * v * v * u * p1x + 3 * v * u * u * p2x + u * u * u * b.sx, v * v * v * a.sy + 3 * v * v * u * p1y + 3 * v * u * u * p2y + u * u * u * b.sy];
      }
      const bulge = 30 * this.cam.k + Math.abs(b.sy - a.sy) * 0.22;
      const cx = a.sx + bulge, cy = (a.sy + b.sy) / 2;
      const v = 1 - u;
      return [v * v * a.sx + 2 * v * u * cx + u * u * b.sx, v * v * a.sy + 2 * v * u * cy + u * u * b.sy];
    }
    if (curve === 'radial') {
      const mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
      const cx = lerp(mx, this.cam.x, 0.22), cy = lerp(my, this.cam.y, 0.22);
      const v = 1 - u;
      return [v * v * a.sx + 2 * v * u * cx + u * u * b.sx, v * v * a.sy + 2 * v * u * cy + u * u * b.sy];
    }
    return [lerp(a.sx, b.sx, u), lerp(a.sy, b.sy, u)];
  }

  _drawEdges(ctx, curve, k, P, fade, mode, hov, lit) {
    const th = this.theme;
    const st = this.state;
    const N = this.edges.length;
    const base = (th.dark ? 0.2 : 0.26) * fade * (N > 1500 ? 0.65 : N > 600 ? 0.8 : 1) * (this.layout.edgeAlpha ?? 1);
    const groups = new Map();
    const hi = [];
    const broken = [];
    const W = this.W, H = this.H;
    for (const e of this.edges) {
      const a = this.ns.get(e.source.id), b = this.ns.get(e.target.id);
      if (!a || !b) continue;
      if ((a.sx < -50 && b.sx < -50) || (a.sx > W + 50 && b.sx > W + 50) || (a.sy < -50 && b.sy < -50) || (a.sy > H + 50 && b.sy > H + 50)) continue;
      const isLit =
        (mode === 'path' && lit.has(a.id) && lit.has(b.id) && Math.abs(st.path.indexOf(a.id) - st.path.indexOf(b.id)) === 1) ||
        (hov && (a.id === hov || b.id === hov)) ||
        (!hov && st.selected && (a.id === st.selected || b.id === st.selected));
      const em = Math.min(a.em, b.em) * Math.min(a.a, b.a);
      if (isLit) {
        hi.push([e, a, b]);
        continue;
      }
      if (e.broken) {
        broken.push([e, a, b, em]);
        continue;
      }
      const depthBin = P > 0.05 ? Math.min(3, Math.floor(((a.shade + b.shade) / 2) * 4)) : 3;
      const emBin = em > 0.8 ? 3 : em > 0.4 ? 2 : em > 0.15 ? 1 : 0;
      const col = this._nodeColor(a.n);
      const key = col + '|' + depthBin + '|' + emBin;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { col, a: ((depthBin + 1) / 4) * [0.12, 0.3, 0.6, 1][emBin], list: [] }));
      g.list.push(a, b);
    }
    const dark = th.dark;
    ctx.save();
    if (dark) ctx.globalCompositeOperation = 'lighter';
    const width = Math.max(0.6, Math.min(1.6, 0.7 + k * 0.35));
    for (const g of groups.values()) {
      if (g.a * base < 0.004) continue;
      ctx.strokeStyle = g.col;
      ctx.beginPath();
      for (let i = 0; i < g.list.length; i += 2) this._edgePath(ctx, g.list[i], g.list[i + 1], curve);
      if (curve === 'neural' && dark) {
        ctx.globalAlpha = g.a * base * 0.35;
        ctx.lineWidth = width * 4;
        ctx.stroke();
      }
      ctx.globalAlpha = g.a * base;
      ctx.lineWidth = width;
      ctx.stroke();
    }
    ctx.restore();
    // broken links
    if (broken.length) {
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = th.err;
      ctx.lineWidth = 1.1;
      for (const [, a, b, em] of broken) {
        ctx.globalAlpha = 0.65 * fade * Math.max(0.1, em);
        ctx.beginPath();
        this._edgePath(ctx, a, b, curve);
        ctx.stroke();
      }
      ctx.restore();
    }
    // highlighted
    if (hi.length) {
      ctx.save();
      if (dark) ctx.globalCompositeOperation = 'lighter';
      for (const [e, a, b] of hi) {
        const col = e.broken ? th.err : this._nodeColor(a.n);
        ctx.strokeStyle = col;
        if (e.broken) ctx.setLineDash([3, 4]);
        ctx.beginPath();
        this._edgePath(ctx, a, b, curve);
        if (dark) {
          ctx.globalAlpha = 0.22 * fade;
          ctx.lineWidth = 5;
          ctx.stroke();
        }
        ctx.globalAlpha = 0.9 * fade;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
  }

  _drawParticles(ctx, t, curve, mode, lit) {
    let alive = false;
    ctx.save();
    if (this.theme.dark) ctx.globalCompositeOperation = 'lighter';
    const draw = (a, b, u, col, sz, al) => {
      const [x, y] = this._edgePoint(a, b, curve, u);
      ctx.globalAlpha = al;
      ctx.drawImage(this._sprite(col), x - sz / 2, y - sz / 2, sz, sz);
    };
    this.particles = this.particles.filter((p) => t - p.t0 < p.dur);
    for (const p of this.particles) {
      const u = (t - p.t0) / p.dur;
      if (u < 0) {
        alive = true;
        continue;
      }
      const a = this.ns.get(p.e.source.id), b = this.ns.get(p.e.target.id);
      if (!a || !b) continue;
      const q = easeInOut(u);
      const col = this._nodeColor((p.fwd ? a : b).n);
      draw(a, b, p.fwd ? q : 1 - q, col, 14, Math.sin(u * Math.PI) * 0.95);
      alive = true;
    }
    if (mode === 'path' && !this.reduced()) {
      const path = this.state.path;
      for (let i = 0; i < path.length - 1; i++) {
        const a = this.ns.get(path[i]), b = this.ns.get(path[i + 1]);
        if (!a || !b) continue;
        const e = this.edges.find((x) => (x.source.id === a.id && x.target.id === b.id) || (x.source.id === b.id && x.target.id === a.id));
        if (!e) continue;
        const ea = this.ns.get(e.source.id), eb = this.ns.get(e.target.id);
        const fwd = e.source.id === a.id;
        for (let j = 0; j < 3; j++) {
          const u = ((t / 1600 + j / 3 + i * 0.13) % 1);
          draw(ea, eb, fwd ? u : 1 - u, this.theme.accent, 12, Math.sin(u * Math.PI) * 0.9);
        }
      }
      alive = true;
    }
    ctx.restore();
    return alive;
  }

  _drawDeco(ctx, t, k) {
    const p = this.layoutP ?? 1;
    const cur = this.layout.deco || {};
    const prev = this.prevLayout?.deco || {};
    if (p < 1 && this.prevLayout) this._decoOf(ctx, prev, k, clamp01(1 - p * 2.5), this.prevLayout);
    this._decoOf(ctx, cur, k, clamp01((p - 0.45) / 0.55), this.layout);
  }

  _decoOf(ctx, d, k, alpha, layout) {
    if (alpha <= 0.01) return;
    const th = this.theme;
    const cam = this.cam;
    const X = (x) => x * k + cam.x;
    const Y = (y) => y * k + cam.y;
    ctx.save();
    ctx.font = `600 11px ${th.font}`;
    ctx.textBaseline = 'middle';
    if (d.columns) {
      for (const c of d.columns) {
        const x = X(c.x);
        ctx.globalAlpha = alpha * 0.5;
        ctx.strokeStyle = th.border;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 6]);
        ctx.beginPath();
        ctx.moveTo(x, Y(c.top + 22));
        ctx.lineTo(x, Y(c.bottom));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = alpha;
        ctx.textAlign = 'center';
        ctx.fillStyle = th.text3;
        ctx.font = `650 10.5px ${th.font}`;
        const label = c.label.toUpperCase();
        ctx.fillText(label, x, Y(c.top) - 2);
        ctx.font = `500 11px ${th.font}`;
        ctx.fillStyle = th.text3;
        ctx.globalAlpha = alpha * 0.8;
        ctx.fillText(`${c.count} files`, x, Y(c.top) + 13);
      }
    }
    if (d.rings) {
      for (const r of d.rings) {
        ctx.globalAlpha = alpha * (r.dashed ? 0.5 : 0.7);
        ctx.strokeStyle = th.border;
        ctx.lineWidth = 1;
        if (r.dashed) ctx.setLineDash([3, 6]);
        ctx.beginPath();
        ctx.arc(cam.x, cam.y, r.r * k, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = alpha * 0.9;
        ctx.fillStyle = th.text3;
        ctx.textAlign = 'right';
        ctx.font = `500 10.5px ${th.font}`;
        const ang = -Math.PI / 2 - 0.42;
        ctx.fillText(r.label, cam.x + Math.cos(ang) * r.r * k - 4, cam.y + Math.sin(ang) * r.r * k - 4);
      }
    }
    if (d.hulls) {
      for (const h of d.hulls) {
        const col = h.tool ? th.tool[h.tool] || th.text3 : th.text3;
        ctx.globalAlpha = alpha * (th.dark ? 0.07 : 0.06);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(X(h.x), Y(h.y), h.r * k, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = alpha * 0.45;
        ctx.strokeStyle = h.tool ? col : th.border;
        ctx.lineWidth = 1;
        ctx.stroke();
        if (h.r * k > 22) {
          ctx.globalAlpha = alpha;
          ctx.textAlign = 'center';
          ctx.font = `600 ${Math.max(10, Math.min(13, h.r * k * 0.12))}px ${th.font}`;
          ctx.fillStyle = th.text2;
          ctx.fillText(h.key, X(h.x), Y(h.y - h.r) - 9);
          ctx.font = `500 10px ${th.font}`;
          ctx.fillStyle = th.text3;
          ctx.fillText(String(h.count), X(h.x), Y(h.y - h.r) + 5);
        }
      }
    }
    if (d.lanes) {
      ctx.textAlign = 'left';
      for (const l of d.lanes) {
        const y0 = Y(l.y), y1 = Y(l.y + l.h);
        ctx.globalAlpha = alpha * 0.035;
        ctx.fillStyle = th.text;
        ctx.fillRect(X(d.x0), y0, (d.x1 - d.x0) * k, y1 - y0);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = l.tool ? th.tool[l.tool] || th.text2 : th.text2;
        ctx.font = `600 11px ${th.font}`;
        ctx.fillText(l.key, X(d.x0) + 8, y0 + 12);
        ctx.fillStyle = th.text3;
        ctx.font = `500 10px ${th.font}`;
        ctx.fillText(String(l.count), X(d.x0) + 8, y0 + 25);
      }
      const last = d.lanes[d.lanes.length - 1];
      const top = Y(d.lanes[0]?.y ?? 0) - 8, bottom = last ? Y(last.y + last.h) + 4 : 0;
      ctx.textAlign = 'center';
      for (const tk of d.ticks || []) {
        const x = X(tk.x);
        ctx.globalAlpha = alpha * 0.55;
        ctx.strokeStyle = th.border;
        ctx.setLineDash([2, 5]);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = th.text3;
        ctx.font = `600 10.5px ${th.font}`;
        ctx.fillText(tk.label, x, top - 8);
        ctx.fillText(tk.label, x, bottom + 12);
      }
      ctx.globalAlpha = alpha * 0.8;
      ctx.fillText('unknown', X(d.unknownX), top - 8);
      ctx.textAlign = 'right';
      ctx.fillStyle = th.text2;
      ctx.fillText('older  ←   last modified   →  newer', X(d.x1), bottom + 28);
    }
    if (d.sphere && layout.projection) {
      const P = this._projNow(performance.now());
      ctx.globalAlpha = alpha * 0.5 * P;
      ctx.strokeStyle = th.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cam.x, cam.y, d.sphere * k * 1.02, 0, TAU);
      ctx.stroke();
      // equator ellipse hint
      ctx.globalAlpha = alpha * 0.28 * P;
      ctx.beginPath();
      ctx.ellipse(cam.x, cam.y, d.sphere * k, Math.abs(Math.sin(this.pitch)) * d.sphere * k + 0.5, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawMatrix(ctx, m, k, alpha) {
    const th = this.theme;
    const cam = this.cam;
    const s = m.s * k;
    const ox = -m.off * k + cam.x, oy = -m.off * k + cam.y;
    const size = m.n * s;
    ctx.save();
    ctx.globalAlpha = alpha;
    // backdrop + group blocks
    ctx.fillStyle = th.dark ? 'rgba(255,255,255,0.025)' : 'rgba(15,18,34,0.03)';
    ctx.fillRect(ox, oy, size, size);
    ctx.strokeStyle = th.border;
    ctx.lineWidth = 1;
    for (const g of m.groups) {
      const a = g.start * s, b = (g.end + 1) * s;
      ctx.globalAlpha = alpha * 0.9;
      ctx.strokeRect(ox + a + 0.5, oy + a + 0.5, b - a - 1, b - a - 1);
      ctx.globalAlpha = alpha * 0.35;
      ctx.beginPath();
      ctx.moveTo(ox + b, oy);
      ctx.lineTo(ox + b, oy + size);
      ctx.moveTo(ox, oy + b);
      ctx.lineTo(ox + size, oy + b);
      ctx.stroke();
    }
    // cells
    const hov = this.hoverCell;
    for (const e of this.edges) {
      const i = m.index.get(e.source.id), j = m.index.get(e.target.id);
      if (i == null || j == null) continue;
      const a = this.ns.get(e.source.id), b = this.ns.get(e.target.id);
      const em = Math.min(a?.em ?? 1, b?.em ?? 1);
      ctx.globalAlpha = alpha * Math.max(0.15, em);
      ctx.fillStyle = e.broken ? th.err : this._nodeColor(e.source);
      const pad = s > 6 ? 1 : 0;
      ctx.fillRect(ox + j * s + pad, oy + i * s + pad, s - pad * 2, s - pad * 2);
      ctx.globalAlpha = alpha * Math.max(0.1, em) * 0.35;
      ctx.fillRect(ox + i * s + pad, oy + j * s + pad, s - pad * 2, s - pad * 2);
    }
    if (hov) {
      const [r, c] = hov.split(':').map(Number);
      ctx.globalAlpha = alpha * 0.12;
      ctx.fillStyle = th.accent;
      ctx.fillRect(ox, oy + r * s, size, s);
      ctx.fillRect(ox + c * s, oy, s, size);
    }
    // row / column labels
    if (s >= 8) {
      ctx.globalAlpha = alpha;
      ctx.font = `500 ${Math.min(12, s * 0.8)}px ${th.font}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      ctx.fillStyle = th.text2;
      const r0 = Math.max(0, Math.floor(-oy / s)), r1 = Math.min(m.n, Math.ceil((this.H - oy) / s));
      for (let i = r0; i < r1; i++) {
        const n = this.ns.get(m.order[i])?.n;
        if (n) ctx.fillText(n.label, ox - 6, oy + i * s + s / 2);
      }
      if (s >= 11) {
        const c0 = Math.max(0, Math.floor(-ox / s)), c1 = Math.min(m.n, Math.ceil((this.W - ox) / s));
        ctx.textAlign = 'left';
        for (let j = c0; j < c1; j++) {
          const n = this.ns.get(m.order[j])?.n;
          if (!n) continue;
          ctx.save();
          ctx.translate(ox + j * s + s / 2, oy - 6);
          ctx.rotate(-Math.PI / 4);
          ctx.fillText(n.label, 0, 0);
          ctx.restore();
        }
      }
    }
    // group labels
    ctx.globalAlpha = alpha;
    ctx.font = `650 10.5px ${th.font}`;
    ctx.fillStyle = th.text3;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (const g of m.groups) {
      const w = (g.end - g.start + 1) * s;
      if (w > 40) ctx.fillText(String(g.key).toUpperCase(), ox + size + 8, oy + g.start * s + Math.min(w, 14) - 2);
    }
    ctx.restore();
  }

  _drawLabels(ctx, list, k, hov, hovN, lit, mode) {
    const th = this.theme;
    const st = this.state;
    const N = list.length;
    const forced = (s) => s.id === hov || s.id === st.selected || (mode === 'path' && lit.has(s.id)) || (hovN && hovN.has(s.id) && hovN.size < 40) || (st.matches && st.matches.has(s.id) && st.matches.size <= 30);
    const want = [];
    for (const s of list) {
      if (s.a * s.em * s.shade < 0.25 && !forced(s)) continue;
      if (s.sx < -20 || s.sy < -20 || s.sx > this.W + 20 || s.sy > this.H + 20) continue;
      const f = forced(s);
      if (!f) {
        if (st.labels === 'none') continue;
        if (st.labels !== 'all') {
          const imp = s.sr * (1 + Math.min(4, s.n.degree) * 0.15);
          const need = N > 600 ? 13 : N > 200 ? 10 : N > 70 ? 7 : 0;
          if (imp < need) continue;
        }
      }
      want.push({ s, pri: f ? 1e9 : s.sr * 10 + s.n.degree });
    }
    want.sort((a, b) => b.pri - a.pri);
    const cell = 12;
    const grid = new Set();
    const occupied = (x0, y0, x1, y1) => {
      for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) if (grid.has(gx + ',' + gy)) return true;
      return false;
    };
    const occupy = (x0, y0, x1, y1) => {
      for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) grid.add(gx + ',' + gy);
    };
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    let drawn = 0;
    const leftSide = this.layout.curve === 'neural';
    for (const { s, pri } of want) {
      if (drawn > 260) break;
      const big = pri >= 1e9;
      ctx.font = `${big && (s.id === hov || s.id === st.selected) ? 650 : 520} ${big ? 12 : 11}px ${th.font}`;
      const text = s.n.missing ? s.n.id : s.n.label;
      const w = ctx.measureText(text).width;
      const onLeft = leftSide && s.n.tier === 0 && this.layout.id === 'neural';
      const x = onLeft ? s.sx - s.sr - 6 - w : s.sx + s.sr + 5;
      const y = s.sy;
      if (!big && occupied(x, y - 7, x + w, y + 7)) continue;
      occupy(x, y - 7, x + w, y + 7);
      ctx.globalAlpha = Math.max(0.35, s.em * s.shade);
      ctx.strokeStyle = th.bg;
      ctx.lineWidth = 3.5;
      ctx.textAlign = 'left';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = s.n.missing ? th.err : big ? th.text : th.text2;
      ctx.fillText(text, x, y);
      drawn++;
    }
    ctx.restore();
  }

  _drawMini() {
    const c = this.mini;
    const g = this.mctx;
    if (!c || !g || !c.width) return;
    const dpr = this.dpr;
    const w = c.width / dpr, h = c.height / dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of this.ns.values()) {
      if (!Number.isFinite(s.px)) continue;
      x0 = Math.min(x0, s.px); x1 = Math.max(x1, s.px); y0 = Math.min(y0, s.py); y1 = Math.max(y1, s.py);
    }
    if (!Number.isFinite(x0)) return;
    const pad = 8;
    const sc = Math.min((w - pad * 2) / Math.max(1, x1 - x0), (h - pad * 2) / Math.max(1, y1 - y0));
    const ox = pad - x0 * sc + ((w - pad * 2) - (x1 - x0) * sc) / 2;
    const oy = pad - y0 * sc + ((h - pad * 2) - (y1 - y0) * sc) / 2;
    this.miniMap = { s: sc, ox, oy };
    for (const s of this.ns.values()) {
      if (!Number.isFinite(s.px)) continue;
      g.globalAlpha = Math.max(0.25, s.em) * 0.9;
      g.fillStyle = this._nodeColor(s.n);
      g.fillRect(s.px * sc + ox - 1, s.py * sc + oy - 1, 2, 2);
    }
    // viewport
    const k = this.cam.k;
    const vx0 = (-this.cam.x) / k, vy0 = (-this.cam.y) / k;
    const vx1 = (this.W - this.cam.x) / k, vy1 = (this.H - this.cam.y) / k;
    g.globalAlpha = 1;
    g.strokeStyle = this.theme.accent;
    g.lineWidth = 1.2;
    const inside = vx0 <= x0 && vy0 <= y0 && vx1 >= x1 && vy1 >= y1;
    if (inside !== this._miniInside) {
      this._miniInside = inside;
      this.cb.onMini?.(!inside);
    }
    const rx = Math.max(0, vx0 * sc + ox), ry = Math.max(0, vy0 * sc + oy);
    const rw = Math.min(w, vx1 * sc + ox) - rx, rh = Math.min(h, vy1 * sc + oy) - ry;
    g.fillStyle = this.theme.accent;
    g.globalAlpha = 0.08;
    g.fillRect(rx, ry, rw, rh);
    g.globalAlpha = 0.9;
    g.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
  }
}

export { groupKey };
