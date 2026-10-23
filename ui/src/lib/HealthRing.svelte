<script>
  import { Tween, prefersReducedMotion } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';

  let { score = 0, grade = '–', size = 148, stroke = 11, label = 'health' } = $props();
  const tw = new Tween(0, { easing: cubicOut });
  $effect(() => {
    tw.set(Math.max(0, Math.min(100, Number(score) || 0)), { duration: prefersReducedMotion.current ? 0 : 1200 });
  });

  const r = $derived((size - stroke) / 2);
  const c = $derived(2 * Math.PI * r);
  const color = $derived(score >= 85 ? 'var(--ok)' : score >= 65 ? 'var(--warn)' : 'var(--err)');
  const uid = Math.random().toString(36).slice(2, 8);
</script>

<div class="ring" style="width:{size}px;height:{size}px;--rc:{color}">
  <svg width={size} height={size} viewBox="0 0 {size} {size}" role="img" aria-label="{label} {Math.round(score)} of 100, grade {grade}">
    <defs>
      <linearGradient id="rg-{uid}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color={color} stop-opacity="1" />
        <stop offset="1" stop-color="var(--accent)" stop-opacity="0.9" />
      </linearGradient>
    </defs>
    <circle cx={size / 2} cy={size / 2} {r} fill="none" stroke="var(--border)" stroke-width={stroke} />
    <circle
      class="arc"
      cx={size / 2}
      cy={size / 2}
      {r}
      fill="none"
      stroke="url(#rg-{uid})"
      stroke-width={stroke}
      stroke-linecap="round"
      stroke-dasharray={c}
      stroke-dashoffset={c * (1 - tw.current / 100)}
      transform="rotate(-90 {size / 2} {size / 2})"
    />
  </svg>
  <div class="center">
    <div class="grade">{grade}</div>
    <div class="score tnum">{Math.round(tw.current)}<span>/100</span></div>
  </div>
</div>

<style>
  .ring {
    position: relative;
    flex-shrink: 0;
  }
  .arc {
    filter: drop-shadow(0 0 8px color-mix(in srgb, var(--rc) 55%, transparent));
  }
  .center {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    text-align: center;
  }
  .grade {
    font-size: 40px;
    font-weight: 750;
    letter-spacing: -0.04em;
    line-height: 1;
    background: linear-gradient(180deg, var(--text), color-mix(in srgb, var(--rc) 70%, var(--text)));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .score {
    font-size: 12px;
    color: var(--text-2);
    margin-top: 4px;
    font-weight: 600;
  }
  .score span {
    color: var(--text-3);
    font-weight: 500;
  }
</style>
