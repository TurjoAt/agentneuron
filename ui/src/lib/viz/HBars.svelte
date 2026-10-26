<script>
  // Ranked horizontal bars: label · bar · value. Bars share one scale (the max),
  // color follows the item's key (palette.js) unless `color` is set. Rows can be
  // selected (onselect) and one key can be highlighted. `label` snippet renders
  // custom label content (e.g. an EntityLink); `sub` adds a faint second value.
  import { colorize } from './palette.js';
  import { app } from '../store.svelte.js';
  import { defaultFmt } from './scale.js';

  let {
    items = [], // [{ key, label?, value, sub? }]
    format = defaultFmt,
    max = 8,
    highlight = '',
    onselect = null,
    color = null, // single color for all bars
    title = 'Ranking',
    label: labelSnip = null,
    more = true,
  } = $props();

  let expanded = $state(false);
  const sorted = $derived(items.filter((d) => d && d.value != null).slice().sort((a, b) => b.value - a.value));
  const colored = $derived(colorize(sorted, app.theme === 'light' ? 'light' : 'dark'));
  const shown = $derived(expanded ? colored : colored.slice(0, max));
  const top = $derived(Math.max(1e-9, ...sorted.map((d) => d.value)));
  const total = $derived(sorted.reduce((a, d) => a + d.value, 0));
  const summary = $derived(`${title}: ${sorted.slice(0, 3).map((d) => `${d.label ?? d.key} ${format(d.value)}`).join(', ')}${sorted.length > 3 ? ` and ${sorted.length - 3} more` : ''}`);
</script>

<div class="hb" role="list" aria-label={summary}>
  {#each shown as d, i (d.key)}
    <div class="r" class:hi={highlight && highlight === d.key} class:dim={highlight && highlight !== d.key} role="listitem" style="--c:{color || d.color};--i:{i}">
      <div class="lb ellipsis" title={d.label ?? d.key}>
        {#if labelSnip}{@render labelSnip(d)}{:else if onselect}<button class="pick" onclick={() => onselect(d)}>{d.label ?? d.key}</button>{:else}{d.label ?? d.key}{/if}
      </div>
      <div class="tr" aria-hidden="true"><div class="fill" style="width:{Math.max(1.5, (d.value / top) * 100)}%"></div></div>
      <div class="v tnum">{format(d.value)}{#if d.sub != null}<span class="faint sub">{d.sub}</span>{/if}</div>
      <span class="sr-only">{((d.value / (total || 1)) * 100).toFixed(0)}% of total</span>
    </div>
  {/each}
  {#if more && colored.length > max}
    <button class="btn ghost sm more" onclick={() => (expanded = !expanded)}>{expanded ? 'Show less' : `Show all ${colored.length}`}</button>
  {/if}
</div>

<style>
  .hb { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .r { display: grid; grid-template-columns: minmax(80px, 38%) 1fr auto; gap: 10px; align-items: center; padding: 4px 6px; border-radius: 7px; min-width: 0; transition: background 0.15s, opacity 0.2s; }
  .r:hover { background: var(--panel-hover); }
  .r.hi { background: color-mix(in srgb, var(--c) 10%, transparent); box-shadow: inset 2px 0 0 var(--c); }
  .r.dim { opacity: 0.62; }
  .lb { font-size: 12.5px; color: var(--text-2); }
  .pick { all: unset; cursor: pointer; }
  .pick:hover { color: var(--accent); }
  .pick:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 3px; }
  .tr { height: 8px; border-radius: 99px; background: var(--panel-active); overflow: hidden; }
  .fill { height: 100%; border-radius: inherit; background: var(--c); transform-origin: left; animation: grow 0.7s var(--ease) backwards; animation-delay: calc(var(--i) * 40ms); }
  @keyframes grow { from { transform: scaleX(0); } }
  .v { font-size: 12.5px; font-weight: 600; text-align: right; white-space: nowrap; }
  .sub { font-weight: 500; margin-left: 6px; font-size: 11.5px; }
  .more { align-self: flex-start; margin-top: 4px; }
  @media (max-width: 520px) { .r { grid-template-columns: minmax(70px, 42%) 1fr auto; gap: 8px; } }
</style>
