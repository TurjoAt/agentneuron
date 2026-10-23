<script>
  import { TOOLS, toolOf } from './tools.js';
  let { tool, compact = false } = $props();
  const t = $derived(toolOf(tool));
</script>

<span class="tb" class:compact style="--c: var(--tool-{t})" title={TOOLS[t].label}>
  <span class="d"></span>{#if !compact}{TOOLS[t].label}{/if}
</span>

<style>
  .tb {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 20px;
    padding: 0 8px 0 7px;
    border-radius: 99px;
    font-size: 11px;
    font-weight: 600;
    color: var(--c);
    background: color-mix(in srgb, var(--c) 13%, transparent);
    border: 1px solid color-mix(in srgb, var(--c) 22%, transparent);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .tb.compact {
    padding: 0;
    width: 10px;
    height: 10px;
    border: 0;
    background: none;
  }
  .d {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--c);
    box-shadow: 0 0 8px var(--c);
  }
  .compact .d {
    width: 8px;
    height: 8px;
  }
</style>
