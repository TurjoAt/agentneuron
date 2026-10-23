<script>
  // Generic modal dialog shell: backdrop, header, scrollable body, footer.
  import { fade, scale } from 'svelte/transition';
  import { tick } from 'svelte';
  import { dur } from './motion.js';
  import Icon from './Icon.svelte';

  let {
    title = '',
    subtitle = '',
    icon = '',
    tone = '', // '', 'danger', 'accent'
    width = 560,
    onclose,
    children,
    footer,
    header,
    bodyClass = '',
    flush = false,
  } = $props();

  let el = $state();

  $effect(() => {
    tick().then(() => {
      const f = el?.querySelector('[data-autofocus]') || el?.querySelector('input:not([type=checkbox]):not([disabled]), textarea, select');
      (f || el)?.focus?.();
    });
  });

  function onkeydown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onclose?.();
    } else if (e.key === 'Tab' && el) {
      const items = [...el.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')].filter((n) => n.offsetParent);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
</script>

<div class="m-bg" transition:fade={{ duration: dur(150) }} onclick={() => onclose?.()} aria-hidden="true"></div>
<div class="m-wrap">
  <div
    class="m card {tone}"
    role="dialog"
    aria-modal="true"
    aria-label={title}
    tabindex="-1"
    bind:this={el}
    style="--w:{typeof width === 'number' ? width + 'px' : width}"
    {onkeydown}
    transition:scale={{ start: 0.97, duration: dur(190) }}
  >
    {#if header}
      {@render header()}
    {:else if title}
      <header class="m-h">
        {#if icon}<span class="m-ic {tone}"><Icon name={icon} size={17} /></span>{/if}
        <div class="col grow" style="gap:1px">
          <h2>{title}</h2>
          {#if subtitle}<p class="faint">{subtitle}</p>{/if}
        </div>
        <button class="btn icon ghost sm" onclick={() => onclose?.()} aria-label="Close"><Icon name="x" size={15} /></button>
      </header>
    {/if}
    <div class="m-b {bodyClass}" class:flush>
      {@render children?.()}
    </div>
    {#if footer}
      <footer class="m-f">{@render footer()}</footer>
    {/if}
  </div>
</div>

<style>
  .m-bg {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(4, 5, 9, 0.55);
    backdrop-filter: blur(5px);
  }
  .m-wrap {
    position: fixed;
    inset: 0;
    z-index: 101;
    display: grid;
    place-items: center;
    padding: 16px;
    pointer-events: none;
  }
  .m {
    pointer-events: auto;
    width: min(var(--w), 100%);
    max-height: min(88dvh, 900px);
    display: flex;
    flex-direction: column;
    background: var(--panel-solid);
    box-shadow: var(--shadow-lg);
    border-radius: 18px;
    outline: none;
    overflow: hidden;
  }
  .m-h {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 18px 18px 14px 20px;
  }
  .m-h h2 { margin: 0; font-size: 16px; font-weight: 650; letter-spacing: -0.01em; }
  .m-h p { margin: 0; font-size: 12.5px; }
  .m-ic {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    background: var(--panel-active);
    color: var(--text-2);
  }
  .m-ic.accent { background: var(--accent-soft); color: var(--accent); }
  .m-ic.danger { background: var(--err-soft); color: var(--err); }
  .m-b { padding: 4px 20px 18px; overflow: auto; min-height: 0; flex: 1; }
  .m-b.flush { padding: 0; }
  .m-f {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--border);
    background: var(--inset);
    flex-wrap: wrap;
  }
  @media (max-width: 640px) {
    .m-wrap { place-items: end center; padding: 0; }
    .m { border-radius: 18px 18px 0 0; max-height: 92dvh; width: 100%; }
  }
</style>
