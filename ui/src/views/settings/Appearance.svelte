<script>
  import { app, setTheme } from '../../lib/store.svelte.js';
  import Icon from '../../lib/Icon.svelte';
</script>

<section class="card">
  <div class="card-h">Appearance</div>
  <div class="card-b col" style="gap:14px">
    <div class="eyebrow">Theme</div>
    <div class="opts" role="radiogroup" aria-label="Theme">
      {#each [['dark', 'Dark', 'moon'], ['light', 'Light', 'sun']] as [id, label, icon] (id)}
        <button class="opt {id}" class:on={app.theme === id} role="radio" aria-checked={app.theme === id} onclick={() => setTheme(id)}>
          <span class="pv"><i></i><i></i><i></i></span>
          <span class="row" style="gap:6px"><Icon name={icon} size={14} /> {label}</span>
        </button>
      {/each}
    </div>
    <p class="muted small" style="margin:0">Your choice is remembered in this browser. Reduced-motion preferences are respected automatically.</p>
  </div>
</section>

<style>
  .opts { display: flex; gap: 12px; flex-wrap: wrap; }
  .opt { border: 1px solid var(--border); background: transparent; color: var(--text); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 8px; cursor: pointer; width: 150px; font-weight: 600; font-size: 13px; }
  .opt.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
  .pv { height: 62px; border-radius: 8px; padding: 8px; display: flex; flex-direction: column; gap: 5px; border: 1px solid var(--border); }
  .pv i { display: block; height: 7px; border-radius: 4px; }
  .dark .pv { background: #0c0e15; } .dark .pv i { background: #2a2f40; } .dark .pv i:first-child { background: #8b7dff; width: 40%; }
  .light .pv { background: #f4f5f9; } .light .pv i { background: #d6d9e4; } .light .pv i:first-child { background: #5b4ee0; width: 40%; }
  .small { font-size: 12.5px; }
</style>
