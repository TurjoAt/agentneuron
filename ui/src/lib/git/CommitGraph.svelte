<script>
  let { row, lanes = 1, h = 44, w = 14 } = $props();
  const W = $derived(lanes * w + 6);
  const x = (i) => i * w + w / 2 + 2;
  const color = (i) => `hsl(${(i * 67 + 210) % 360} 62% 58%)`;
  const my = $derived(h / 2);
  const segs = $derived.by(() => {
    const out = [];
    const c = row.col;
    row.before.forEach((hsh, i) => {
      if (hsh == null) return;
      if (hsh === row.hash) out.push({ d: `M${x(i)} 0 L${x(c)} ${my}`, c: i });
      else { const j = row.after.indexOf(hsh); out.push({ d: `M${x(i)} 0 L${x(j < 0 ? i : j)} ${h}`, c: i }); }
    });
    row.targets.forEach((j) => out.push({ d: `M${x(c)} ${my} L${x(j)} ${h}`, c: j }));
    return out;
  });
</script>
<svg width={W} height={h} viewBox="0 0 {W} {h}" aria-hidden="true" style="flex-shrink:0;display:block">
  {#each segs as s}<path d={s.d} stroke={color(s.c)} stroke-width="1.6" fill="none" stroke-linecap="round" />{/each}
  <circle cx={x(row.col)} cy={my} r={row.merge ? 3.2 : 4} fill={row.merge ? 'var(--bg, #111)' : color(row.col)} stroke={color(row.col)} stroke-width="1.8" />
</svg>
