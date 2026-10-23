<script>
  import { fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { app } from './store.svelte.js';
  import { dur } from './motion.js';
  import Icon from './Icon.svelte';
  const icons = { ok: 'check', error: 'error', warn: 'alert', info: 'info' };
</script>

<div class="toasts" aria-live="polite">
  {#each app.toasts as t (t.id)}
    <div class="toast card {t.kind}" animate:flip={{ duration: dur(250) }} transition:fly={{ y: 16, duration: dur(260) }}>
      <Icon name={icons[t.kind] || 'info'} />
      <span>{t.message}</span>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    z-index: 90;
    right: 16px;
    bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: min(420px, calc(100vw - 32px));
    pointer-events: none;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 14px;
    font-size: 13px;
    background: var(--panel-solid);
    box-shadow: var(--shadow-lg);
    pointer-events: auto;
  }
  .ok { color: var(--ok); }
  .error { color: var(--err); }
  .warn { color: var(--warn); }
  .toast span { color: var(--text); }
  @media (max-width: 760px) {
    .toasts { bottom: 76px; }
  }
</style>
