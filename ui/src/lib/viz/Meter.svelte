<script>
  // Budget meter: value vs budget with a soft-limit tick. Over budget turns warn,
  // over 1.5× turns err (with a text cue, never color alone).
  import { fmtNum } from '../format.js';
  let { value = 0, budget = 1, color = 'var(--accent)', height = 6, showLabel = true, unit = 'tok' } = $props();
  const ratio = $derived(value / (budget || 1));
  const pct = $derived(Math.min(100, ratio * 66.6667)); // budget sits at 2/3 of the track
  const state = $derived(ratio > 1.5 ? 'err' : ratio > 1 ? 'warn' : 'ok');
</script>

<div class="mt">
  <div class="track" style="height:{height}px" role="meter" aria-valuemin="0" aria-valuemax={budget * 1.5} aria-valuenow={value} aria-label="{fmtNum(value)} of {fmtNum(budget)} {unit} budget">
    <div class="fill {state}" style="width:{Math.max(1.5, pct)}%;--c:{color}"></div>
    <span class="tick" title="Budget {fmtNum(budget)}"></span>
  </div>
  {#if showLabel}
    <div class="lbl">
      <b class="tnum">{fmtNum(value)}</b><span class="faint"> / {fmtNum(budget)} {unit}</span>
      {#if state !== 'ok'}<span class="st {state}">{state === 'err' ? 'way over' : 'over'} budget</span>{/if}
    </div>
  {/if}
</div>

<style>
  .mt { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .track { position: relative; border-radius: 99px; background: var(--panel-active); overflow: visible; }
  .fill { height: 100%; border-radius: inherit; background: linear-gradient(90deg, color-mix(in srgb, var(--c) 55%, transparent), var(--c)); transition: width 0.9s var(--ease); }
  .fill.warn { background: linear-gradient(90deg, color-mix(in srgb, var(--warn) 55%, transparent), var(--warn)); }
  .fill.err { background: linear-gradient(90deg, color-mix(in srgb, var(--err) 55%, transparent), var(--err)); }
  .tick { position: absolute; left: 66.6667%; top: -3px; bottom: -3px; width: 2px; border-radius: 2px; background: var(--text-3); opacity: 0.7; }
  .lbl { font-size: 11.5px; display: flex; gap: 4px; align-items: baseline; flex-wrap: wrap; }
  .st { margin-left: auto; font-size: 10.5px; font-weight: 600; }
  .st.warn { color: var(--warn); }
  .st.err { color: var(--err); }
</style>
