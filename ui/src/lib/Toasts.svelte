<script>
  import { fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { app, dismissToast } from './store.svelte.js';
  import { dur } from './motion.js';
  import Icon from './Icon.svelte';
  const icons = { ok: 'check', error: 'error', warn: 'alert', info: 'info' };
</script>

<div class="toasts" aria-live="polite">
  {#each app.toasts as t (t.id)}
    <div class="toast {t.kind}" animate:flip={{ duration: dur(250) }} transition:fly={{ y: 16, duration: dur(260) }}>
      <span class="ic"><Icon name={icons[t.kind] || 'info'} size={14} /></span>
      <span class="msg">{t.message}</span>
      {#if t.action}
        <button class="act" onclick={() => { dismissToast(t.id); t.action.run(); }}>{t.action.label}</button>
      {/if}
      <button class="x" aria-label="Dismiss" onclick={() => dismissToast(t.id)}><Icon name="x" size={12} /></button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    z-index: 130;
    right: 16px;
    bottom: 16px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    max-width: min(440px, calc(100vw - 32px));
    pointer-events: none;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 8px 9px 12px;
    font-size: 13px;
    border-radius: 12px;
    background: var(--panel-solid);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-lg);
    pointer-events: auto;
    color: var(--text);
  }
  .ic { width: 22px; height: 22px; border-radius: 7px; display: grid; place-items: center; flex-shrink: 0; background: var(--info-soft); color: var(--info); }
  .ok .ic { background: var(--ok-soft); color: var(--ok); }
  .error .ic { background: var(--err-soft); color: var(--err); }
  .warn .ic { background: var(--warn-soft); color: var(--warn); }
  .msg { flex: 1; min-width: 0; line-height: 1.45; word-break: break-word; }
  .act { border: 0; background: var(--accent-soft); color: var(--accent); font-weight: 650; font-size: 12px; height: 24px; padding: 0 10px; border-radius: 7px; cursor: pointer; }
  .act:hover { filter: brightness(1.15); }
  .x { border: 0; background: transparent; color: var(--text-3); width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; cursor: pointer; flex-shrink: 0; }
  .x:hover { background: var(--panel-active); color: var(--text); }
  @media (max-width: 760px) {
    .toasts { bottom: calc(76px + env(safe-area-inset-bottom)); right: 12px; left: 12px; max-width: none; }
    .toast { width: 100%; }
  }
</style>
