<script>
  // Animated number that tweens to new values.
  import { Tween, prefersReducedMotion } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { fmtNum } from './format.js';

  let { value = 0, format = fmtNum, duration = 900 } = $props();
  const tw = new Tween(0, { easing: cubicOut });
  let bump = $state(false);
  let prev = null;

  $effect(() => {
    const v = Number(value) || 0;
    tw.set(v, { duration: prefersReducedMotion.current ? 0 : duration });
    if (prev !== null && v !== prev) {
      bump = false;
      requestAnimationFrame(() => (bump = true));
    }
    prev = v;
  });
</script>

<span class="ctr tnum" class:bump onanimationend={() => (bump = false)}>{format(Math.round(tw.current))}</span>

<style>
  .ctr { display: inline-block; }
  .bump { animation: bump 0.6s var(--ease-spring); }
  @keyframes bump {
    0% { transform: none; }
    35% { transform: translateY(-2px) scale(1.06); color: var(--accent); }
    100% { transform: none; }
  }
</style>
