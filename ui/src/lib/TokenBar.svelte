<script>
  let { value = 0, max = 1, tool = 'generic', height = 6 } = $props();
  const pct = $derived(Math.max(1.5, Math.min(100, (value / (max || 1)) * 100)));
</script>

<div class="tbar" style="height:{height}px;--c:var(--tool-{tool})">
  <div class="fill" style="width:{pct}%"></div>
</div>

<style>
  .tbar {
    width: 100%;
    border-radius: 99px;
    background: var(--panel-active);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, color-mix(in srgb, var(--c) 60%, transparent), var(--c));
    box-shadow: 0 0 10px color-mix(in srgb, var(--c) 45%, transparent);
    transition: width 0.8s var(--ease);
  }
</style>
