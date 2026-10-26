<script>
  // Slim "related pages" strip under the top bar: where to go next from the current page.
  import { app } from './store.svelte.js';
  import { viewMeta, href } from './nav.js';
  import { badgeFor } from './navbadges.svelte.js';
  import Icon from './Icon.svelte';

  const cur = $derived(viewMeta(app.route.view));
  const rel = $derived((cur?.related || []).map(viewMeta).filter(Boolean));
</script>

{#if rel.length}
  <nav class="rel" aria-label="Related pages">
    <span class="lab">Related</span>
    {#each rel as v (v.id)}
      {@const b = badgeFor(v.id)}
      <a class="rc" href={href(v.id)} title={v.desc}>
        <Icon name={v.icon} size={13} /><span>{v.label}</span>
        {#if b.n}<span class="dot {b.tone}" aria-label="{b.n} {b.title}"></span>{/if}
      </a>
    {/each}
    <button class="rc map" onclick={() => (app.modal = { kind: 'map', props: {} })} title="How pages and data connect (m)">
      <Icon name="map" size={13} /><span>Map</span>
    </button>
  </nav>
{/if}

<style>
  .rel {
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: 1600px;
    margin: 0 auto;
    padding: 10px clamp(14px, 2.6vw, 30px) 0;
    overflow-x: auto;
    scrollbar-width: none;
    white-space: nowrap;
  }
  .rel::-webkit-scrollbar { display: none; }
  .lab { font-size: 10.5px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-3); margin-right: 4px; }
  .rc {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 9px;
    border-radius: 99px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-2);
    font-size: 12px;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
    flex-shrink: 0;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
  }
  .rc:hover { color: var(--text); border-color: var(--border-strong); background: var(--panel-hover); text-decoration: none; }
  .rc :global(.icon) { color: var(--text-3); }
  .rc:hover :global(.icon) { color: var(--accent); }
  .map { border-style: dashed; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--warn); }
  .dot.err { background: var(--err); }
</style>
