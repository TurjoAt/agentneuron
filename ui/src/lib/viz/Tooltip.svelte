<script>
  // Floating chart tooltip, positioned inside a relatively positioned parent.
  // Flips to the left of the cursor near the right edge.
  let { x = 0, y = 0, width = 0, visible = false, children } = $props();
  const flip = $derived(width && x > width - 200);
</script>

{#if visible}
  <div class="vtip" style="left:{x}px;top:{y}px;transform:translate({flip ? 'calc(-100% - 14px)' : '14px'}, -50%)" role="tooltip">
    {@render children?.()}
  </div>
{/if}

<style>
  .vtip {
    position: absolute;
    z-index: 5;
    pointer-events: none;
    min-width: 150px;
    max-width: 280px;
    padding: 9px 11px;
    border-radius: 10px;
    background: var(--panel-solid);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-lg);
    font-size: 12px;
    line-height: 1.45;
    color: var(--text);
  }
  .vtip :global(.vt-h) { font-weight: 600; color: var(--text-2); margin-bottom: 5px; font-size: 11.5px; }
  .vtip :global(.vt-r) { display: flex; align-items: center; gap: 8px; }
  .vtip :global(.vt-r .k) { flex: 1; min-width: 0; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .vtip :global(.vt-r b) { font-variant-numeric: tabular-nums; font-weight: 600; }
  .vtip :global(.vt-sw) { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
  .vtip :global(.vt-f) { margin-top: 5px; padding-top: 5px; border-top: 1px solid var(--border); color: var(--text-3); }
</style>
