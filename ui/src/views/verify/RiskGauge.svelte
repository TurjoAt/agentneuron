<script>
  // Half-ring gauge for a 0-100 risk score (higher = riskier).
  let { score = 0, level = 'none', size = 180 } = $props();
  const R = 70;
  const LEN = Math.PI * R;
  const pct = $derived(Math.max(0, Math.min(100, score)) / 100);
  const tone = $derived(level === 'high' ? 'var(--err)' : level === 'medium' ? 'var(--warn)' : level === 'low' ? 'var(--info)' : 'var(--ok)');
</script>

<figure class="gauge" style="width:{size}px" aria-label="Risk score {score} of 100 ({level})">
  <svg viewBox="0 0 180 104" width={size} height={size * 104 / 180} aria-hidden="true">
    <path d="M20 94 A70 70 0 0 1 160 94" fill="none" stroke="var(--border)" stroke-width="14" stroke-linecap="round" />
    <path d="M20 94 A70 70 0 0 1 160 94" fill="none" stroke={tone} stroke-width="14" stroke-linecap="round"
      stroke-dasharray="{LEN * pct} {LEN}" class="arc" />
  </svg>
  <figcaption>
    <b class="tnum">{score}</b>
    <span class="lvl" style="color:{tone}">{level === 'none' ? 'no risk found' : `${level} risk`}</span>
  </figcaption>
</figure>

<style>
  .gauge { margin: 0; position: relative; display: grid; justify-items: center; }
  .arc { transition: stroke-dasharray 0.6s var(--ease); }
  figcaption { position: absolute; bottom: 0; display: grid; justify-items: center; line-height: 1.1; }
  b { font-size: 34px; font-weight: 700; color: var(--text); }
  .lvl { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
</style>
