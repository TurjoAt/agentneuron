<script>
  import { addDays, dayKey, parseDay, statusColor, isOverdue, byOrder } from './util.js';

  let { tasks = [], onopen } = $props();
  const DAY = 24 * 3600 * 1000;
  const W = 26; // px per day

  const dated = $derived(tasks.filter((t) => t.due && parseDay(t.due)).sort((a, b) => a.due.localeCompare(b.due) || byOrder(a, b)));
  const undated = $derived(tasks.filter((t) => !t.due).length);

  const range = $derived.by(() => {
    const now = new Date();
    const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let lo = addDays(t0, -7), hi = addDays(t0, 21);
    for (const t of dated) {
      const c = new Date(t.createdAt || Date.now());
      const cd = new Date(c.getFullYear(), c.getMonth(), c.getDate());
      const d = parseDay(t.due);
      if (cd < lo) lo = cd;
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    if (lo < addDays(t0, -90)) lo = addDays(t0, -90);
    if (hi > addDays(t0, 240)) hi = addDays(t0, 240);
    lo = addDays(lo, -((lo.getDay() + 6) % 7)); // snap to Monday
    hi = addDays(hi, 7 - ((hi.getDay() + 6) % 7) + 6);
    const n = Math.round((hi - lo) / DAY);
    const weeks = Array.from({ length: Math.ceil(n / 7) }, (_, i) => addDays(lo, i * 7));
    return { lo, n, weeks, today: Math.round((t0 - lo) / DAY) };
  });
  const dayIdx = (d) => Math.round((d - range.lo) / DAY);
  function bar(t) {
    const due = parseDay(t.due);
    const c = new Date(t.createdAt || Date.now());
    const start = Math.max(0, Math.min(dayIdx(new Date(c.getFullYear(), c.getMonth(), c.getDate())), dayIdx(due)));
    const end = Math.min(range.n - 1, dayIdx(due));
    const s = Math.min(start, end);
    return { left: s * W, width: Math.max(1, end - s + 1) * W };
  }
  const wl = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
</script>

{#if undated}<div class="faint small" style="margin-bottom:8px">{undated} task{undated === 1 ? '' : 's'} without a due date are not shown.</div>{/if}
<div class="card tl">
  <div class="inner" style="width:{range.n * W + 200}px">
    <div class="hdr">
      <div class="lbl"></div>
      <div class="weeks" style="width:{range.n * W}px">
        {#each range.weeks as w (w.getTime())}<div class="wk" style="width:{7 * W}px">{wl(w)}</div>{/each}
      </div>
    </div>
    {#each dated as t (t.id)}
      {@const b = bar(t)}
      <div class="tr">
        <button class="lbl ellipsis" onclick={() => onopen(t.id)} title={t.title}>{t.title}</button>
        <div class="lane" style="width:{range.n * W}px; background-size:{7 * W}px 100%">
          <button
            class="bar"
            class:over={isOverdue(t)}
            class:done={t.status === 'done'}
            style="left:{b.left}px;width:{b.width}px;--c:{statusColor(t.status)}"
            onclick={() => onopen(t.id)}
            title="{t.title} — due {t.due}"
          ><span class="ellipsis">{t.title}</span></button>
        </div>
      </div>
    {:else}
      <div class="faint" style="padding:24px;text-align:center;font-size:13px">No tasks with due dates.</div>
    {/each}
    <div class="today" style="left:{200 + range.today * W + W / 2}px"></div>
  </div>
</div>

<style>
  .tl { overflow: auto; padding: 0; max-height: 70dvh; }
  .inner { position: relative; }
  .small { font-size: 12px; }
  .hdr { display: flex; position: sticky; top: 0; z-index: 3; background: var(--panel-solid); border-bottom: 1px solid var(--border); }
  .lbl { width: 200px; flex-shrink: 0; position: sticky; left: 0; z-index: 2; background: var(--panel-solid); border: 0; text-align: left; padding: 0 12px; font-size: 12.5px; color: var(--text); cursor: pointer; height: 34px; line-height: 34px; border-right: 1px solid var(--border); }
  .tr .lbl:hover { color: var(--accent); }
  .weeks { display: flex; }
  .wk { flex-shrink: 0; font-size: 11px; color: var(--text-3); padding: 9px 6px; border-left: 1px solid var(--border); box-sizing: border-box; }
  .tr { display: flex; border-bottom: 1px solid var(--border); }
  .tr:last-of-type { border-bottom: 0; }
  .lane { position: relative; height: 34px; background-image: linear-gradient(90deg, var(--border) 1px, transparent 1px); background-repeat: repeat-x; }
  .bar { position: absolute; top: 7px; height: 20px; border: 0; border-radius: 6px; padding: 0 8px; background: color-mix(in srgb, var(--c) 28%, transparent); border-left: 3px solid var(--c); color: var(--text); font-size: 11px; text-align: left; cursor: pointer; display: flex; align-items: center; min-width: 0; }
  .bar:hover { background: color-mix(in srgb, var(--c) 45%, transparent); }
  .bar.over { background: var(--err-soft); border-left-color: var(--err); }
  .bar.done { opacity: 0.55; }
  .today { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--accent); opacity: 0.6; pointer-events: none; z-index: 1; }
</style>
