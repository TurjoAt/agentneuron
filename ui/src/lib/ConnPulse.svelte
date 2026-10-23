<script>
  import { app, reconnect } from './store.svelte.js';
  import { timeAgo } from './format.js';
  let { showLabel = true } = $props();
  const label = $derived(
    app.mock ? 'Demo stream' : { live: 'Live', connecting: 'Connecting', reconnecting: 'Reconnecting', offline: 'Offline' }[app.conn] || app.conn
  );
</script>

<button
  class="conn {app.conn}"
  title="{label}{app.lastPing ? ` · last signal ${timeAgo(app.lastPing, app.now)}` : ''}{app.conn !== 'live' ? ' — click to reconnect' : ''}"
  onclick={reconnect}
>
  <span class="dot"><span class="ring"></span></span>
  {#if showLabel}<span class="lbl">{label}</span>{/if}
</button>

<style>
  .conn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 0;
    background: transparent;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
  }
  .conn:hover { background: var(--panel-hover); }
  .dot {
    position: relative;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--c);
    box-shadow: 0 0 10px var(--c);
    --c: var(--ok);
  }
  .ring {
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    border: 2px solid var(--c);
    opacity: 0;
    animation: ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;
  }
  .connecting .dot, .reconnecting .dot { --c: var(--warn); }
  .reconnecting .ring { animation-duration: 0.9s; }
  .offline .dot { --c: var(--err); }
  .offline .ring { animation: none; }
  .live .lbl { color: var(--ok); }
  .reconnecting .lbl, .connecting .lbl { color: var(--warn); }
  .offline .lbl { color: var(--err); }
  @keyframes ping {
    0% { transform: scale(0.6); opacity: 0.9; }
    80%, 100% { transform: scale(1.9); opacity: 0; }
  }
</style>
