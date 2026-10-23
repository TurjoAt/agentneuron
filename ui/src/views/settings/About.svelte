<script>
  import { app } from '../../lib/store.svelte.js';
  import { copyPath } from '../../lib/fileActions.js';
  import Icon from '../../lib/Icon.svelte';

  let { settings = null } = $props();
  const rows = $derived(Object.entries(settings?.paths || {}));
</script>

<section class="card">
  <div class="card-h">About mdctl</div>
  <div class="card-b col" style="gap:14px">
    <div class="row" style="gap:12px;flex-wrap:wrap">
      <div class="col" style="gap:2px"><div class="eyebrow">Version</div><div class="v mono">{settings?.version || '—'}</div></div>
      <div class="col" style="gap:2px"><div class="eyebrow">Connection</div><span class="badge {app.conn === 'live' ? 'ok' : 'warn'}">{app.conn}</span></div>
      {#if app.mock}<span class="badge info">demo data (mock)</span>{/if}
    </div>
    <div>
      <div class="eyebrow" style="margin-bottom:6px">Paths</div>
      <div class="col" style="gap:4px">
        {#each rows as [k, v] (k)}
          <div class="kv"><span class="faint">{k}</span><code class="grow ellipsis" title={v}>{v}</code>
            <button class="btn sm ghost icon" aria-label="Copy {k}" onclick={() => copyPath(v)}><Icon name="copy" size={13} /></button></div>
        {:else}<span class="faint small">No path information.</span>{/each}
      </div>
    </div>
    <div class="faint small">Press <kbd class="kbd">⌘K</kbd> / <kbd class="kbd">Ctrl K</kbd> for the command palette. Markdown is the source of truth; mdctl keeps its own state in <code>.mdctl/</code>.</div>
  </div>
</section>

<style>
  .v { font-size: 20px; font-weight: 650; }
  .kv { display: flex; align-items: center; gap: 10px; padding: 4px 10px; border: 1px solid var(--border); border-radius: 9px; font-size: 12.5px; min-width: 0; }
  .kv > span { width: 64px; flex-shrink: 0; }
  code { font-family: var(--mono); font-size: 12px; }
  .small { font-size: 12.5px; }
</style>
