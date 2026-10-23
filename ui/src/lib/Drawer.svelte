<script>
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { app } from './store.svelte.js';
  import { dur } from './motion.js';
  import FileViewer from './FileViewer.svelte';
  import Icon from './Icon.svelte';

  let tab = $state('preview');
  $effect(() => {
    void app.drawer?.path;
    tab = 'preview';
  });
  const close = () => (app.drawer = null);
</script>

{#if app.drawer}
  <div class="backdrop" transition:fade={{ duration: dur(180) }} onclick={close} aria-hidden="true"></div>
  <div class="drawer card" role="dialog" aria-modal="true" aria-label="File preview" transition:fly={{ x: 60, duration: dur(320), easing: cubicOut }}>
    <button class="btn icon ghost close" onclick={close} aria-label="Close preview"><Icon name="x" /></button>
    {#key app.drawer.path}
      <FileViewer path={app.drawer.path} line={app.drawer.line} bind:tab compact />
    {/key}
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgba(5, 6, 10, 0.45);
    backdrop-filter: blur(2px);
  }
  .drawer {
    position: fixed;
    z-index: 61;
    top: 10px;
    right: 10px;
    bottom: 10px;
    width: min(780px, calc(100vw - 20px));
    overflow: auto;
    background: var(--panel-solid);
    box-shadow: var(--shadow-lg);
    border-radius: 18px;
  }
  .close {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 2;
  }
  @media (max-width: 640px) {
    .drawer { top: 40px; right: 0; left: 0; bottom: 0; width: 100%; border-radius: 18px 18px 0 0; }
  }
</style>
