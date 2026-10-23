<script>
  import { tick } from 'svelte';
  import { scale } from 'svelte/transition';
  import { menu, closeMenu } from './menu.svelte.js';
  import { dur } from './motion.js';
  import Icon from './Icon.svelte';

  let el = $state();
  let pos = $state({ x: 0, y: 0 });
  let sel = $state(-1);

  const runnable = $derived(menu.items.map((it, i) => (!it.sep && !it.header && !it.disabled ? i : -1)).filter((i) => i >= 0));

  $effect(() => {
    if (!menu.open) return;
    pos = { x: menu.x, y: menu.y };
    sel = -1;
    tick().then(() => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = innerWidth;
      const vh = innerHeight;
      pos = {
        x: Math.max(8, Math.min(menu.x, vw - r.width - 8)),
        y: menu.y + r.height > vh - 8 ? Math.max(8, menu.y - r.height) : menu.y,
      };
      el.focus();
    });
  });

  function run(it) {
    if (!it || it.disabled || it.sep || it.header) return;
    closeMenu();
    it.run?.();
  }

  function onkeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!runnable.length) return;
      const k = runnable.indexOf(sel);
      const n = e.key === 'ArrowDown' ? (k + 1) % runnable.length : (k - 1 + runnable.length) % runnable.length;
      sel = runnable[k < 0 && e.key === 'ArrowUp' ? runnable.length - 1 : n];
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(menu.items[sel]);
    }
  }
</script>

<svelte:window onblur={closeMenu} onresize={closeMenu} />

{#if menu.open}
  <div class="cm-bg" onpointerdown={closeMenu} oncontextmenu={(e) => { e.preventDefault(); closeMenu(); }} aria-hidden="true"></div>
  <div
    class="cm"
    role="menu"
    tabindex="-1"
    bind:this={el}
    style="left:{pos.x}px;top:{pos.y}px"
    {onkeydown}
    transition:scale={{ start: 0.96, duration: dur(110) }}
  >
    {#if menu.title}<div class="cm-t mono ellipsis">{menu.title}</div>{/if}
    {#each menu.items as it, i (i)}
      {#if it.sep}
        <div class="cm-sep"></div>
      {:else if it.header}
        <div class="cm-hd">{it.header}</div>
      {:else}
        <button
          class="cm-it"
          class:on={sel === i}
          class:danger={it.danger}
          role="menuitem"
          disabled={it.disabled}
          title={it.disabled ? it.reason || '' : it.hint || ''}
          onmouseenter={() => (sel = i)}
          onclick={() => run(it)}
        >
          <span class="ic"><Icon name={it.icon || 'dot'} size={14} /></span>
          <span class="grow ellipsis">{it.label}</span>
          {#if it.disabled && it.reason}<Icon name="lock" size={12} />{/if}
          {#if it.kbd}<span class="kbd">{it.kbd}</span>{/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .cm-bg { position: fixed; inset: 0; z-index: 120; }
  .cm {
    position: fixed;
    z-index: 121;
    min-width: 210px;
    max-width: 320px;
    padding: 5px;
    border-radius: 12px;
    background: var(--panel-solid);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-lg);
    outline: none;
    transform-origin: top left;
  }
  .cm-t { padding: 6px 9px 6px; font-size: 11px; color: var(--text-3); border-bottom: 1px solid var(--border); margin-bottom: 4px; }
  .cm-hd { padding: 6px 9px 3px; font-size: 10.5px; font-weight: 650; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-3); }
  .cm-sep { height: 1px; background: var(--border); margin: 4px 2px; }
  .cm-it {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    height: 30px;
    padding: 0 9px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--text-2);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  .cm-it.on { background: var(--panel-active); color: var(--text); }
  .cm-it.danger { color: var(--err); }
  .cm-it.danger.on { background: var(--err-soft); }
  .cm-it:disabled { opacity: 0.45; cursor: not-allowed; }
  .ic { display: grid; color: var(--text-3); }
  .cm-it.on .ic { color: inherit; }
  .danger .ic { color: var(--err); }
</style>
