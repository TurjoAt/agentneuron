<script>
  // Topbar "always scanning" radar. The sweep rotates only while the live
  // stream is connected; it stops (grey/red) when offline. Every incoming file
  // event flashes a blip at a stable position derived from its path.
  // CSS-only motion (compositor transform); paused when the tab is hidden;
  // static wedge under prefers-reduced-motion.
  import { prefersReducedMotion } from 'svelte/motion';
  import { app, onStream, reconnect } from './store.svelte.js';
  import { page } from './visibility.svelte.js';
  import { timeAgo, basename } from './format.js';

  const MAX_BLIPS = 6;
  const BLIP_MS = 1700;
  let blips = $state([]);
  let seq = 0;

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  $effect(() =>
    onStream('event', (ev) => {
      if (!ev?.path) return;
      const h = hash(ev.path);
      const a = ((h % 360) * Math.PI) / 180;
      const r = 0.3 + ((h >>> 9) % 55) / 100; // 0.30 … 0.84 of the radius
      const b = { id: ++seq, x: 50 + Math.cos(a) * r * 50, y: 50 + Math.sin(a) * r * 50, kind: ev.type === 'unlink' ? 'del' : ev.type === 'add' ? 'add' : 'chg' };
      blips = [...blips.slice(-(MAX_BLIPS - 1)), b];
      setTimeout(() => (blips = blips.filter((x) => x.id !== b.id)), BLIP_MS);
    })
  );

  const mode = $derived(app.conn === 'live' ? 'live' : app.conn === 'offline' ? 'off' : 'wait');
  const last = $derived(app.events[0]);
  const label = $derived(
    (app.mock ? 'Demo stream' : { live: 'Scanning — live', connecting: 'Connecting…', reconnecting: 'Reconnecting…', offline: 'Offline — not scanning' }[app.conn] || app.conn) +
      (last ? ` · last file event ${timeAgo(last.ts, app.now)} (${basename(last.path)})` : ' · no file events yet') +
      (app.conn !== 'live' ? ' — click to reconnect' : '')
  );
</script>

<button
  class="radar {mode}"
  class:paused={!page.visible}
  class:rm={prefersReducedMotion.current}
  title={label}
  aria-label={label}
  onclick={() => app.conn !== 'live' && reconnect()}
>
  <span class="disc" aria-hidden="true">
    <span class="ring r1"></span>
    <span class="ring r2"></span>
    <span class="cross"></span>
    {#if mode !== 'off'}<span class="sweep"></span>{/if}
    {#each blips as b (b.id)}
      <span class="blip {b.kind}" style="left:{b.x}%;top:{b.y}%"></span>
    {/each}
    <span class="core"></span>
  </span>
</button>

<style>
  .radar {
    --c: var(--ok);
    display: inline-grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: 9px;
    background: transparent;
    cursor: pointer;
    flex-shrink: 0;
  }
  .radar:hover { background: var(--panel-hover); }
  .radar.wait { --c: var(--warn); }
  .radar.off { --c: var(--err); }
  .disc {
    position: relative;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    overflow: hidden;
    background: radial-gradient(circle, color-mix(in srgb, var(--c) 16%, transparent) 0%, color-mix(in srgb, var(--c) 6%, transparent) 70%);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--c) 45%, transparent), 0 0 12px -2px color-mix(in srgb, var(--c) 45%, transparent);
    transition: box-shadow 0.4s var(--ease), background 0.4s var(--ease);
  }
  .off .disc {
    background: color-mix(in srgb, var(--text-3) 10%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--err) 55%, transparent);
  }
  .ring { position: absolute; border-radius: 50%; border: 1px solid color-mix(in srgb, var(--c) 30%, transparent); }
  .r1 { inset: 3.5px; }
  .r2 { inset: 7.5px; }
  .off .ring { border-color: color-mix(in srgb, var(--text-3) 40%, transparent); }
  .cross {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(color-mix(in srgb, var(--c) 22%, transparent), color-mix(in srgb, var(--c) 22%, transparent)) center / 1px 100% no-repeat,
      linear-gradient(color-mix(in srgb, var(--c) 22%, transparent), color-mix(in srgb, var(--c) 22%, transparent)) center / 100% 1px no-repeat;
  }
  .off .cross { opacity: 0.4; }
  .sweep {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: conic-gradient(from 0deg, transparent 0deg, transparent 270deg, color-mix(in srgb, var(--c) 18%, transparent) 320deg, color-mix(in srgb, var(--c) 70%, transparent) 359deg, transparent 360deg);
    animation: sweep 2.8s linear infinite;
    will-change: transform;
  }
  .wait .sweep { animation-duration: 5.5s; opacity: 0.7; }
  .paused .sweep { animation-play-state: paused; }
  .core {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 3px;
    height: 3px;
    margin: -1.5px 0 0 -1.5px;
    border-radius: 50%;
    background: var(--c);
  }
  .off .core { background: var(--err); }
  .blip {
    position: absolute;
    width: 4px;
    height: 4px;
    margin: -2px 0 0 -2px;
    border-radius: 50%;
    background: var(--c);
    box-shadow: 0 0 6px var(--c);
    animation: blip 1.7s var(--ease) forwards;
  }
  .blip.add { background: var(--info); box-shadow: 0 0 6px var(--info); }
  .blip.del { background: var(--err); box-shadow: 0 0 6px var(--err); }
  /* reduced motion: still sweep wedge, blips just appear then vanish (timer) */
  .rm .sweep { animation: none; transform: rotate(-30deg); }
  .rm .blip { animation: none; opacity: 0.9; }
  @keyframes sweep { to { transform: rotate(360deg); } }
  @keyframes blip {
    0% { transform: scale(2.2); opacity: 1; }
    20% { transform: scale(1); opacity: 1; }
    100% { transform: scale(0.8); opacity: 0; }
  }
</style>
