<script>
  import { app, toggleTheme } from './store.svelte.js';
  import { VIEWS } from './nav.js';
  import Icon from './Icon.svelte';
  import ConnPulse from './ConnPulse.svelte';

  const view = $derived(VIEWS.find((v) => v.id === app.route.view));
  const git = $derived(app.state?.git);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
</script>

<header class="top">
  <div class="title">
    <span class="proj ellipsis">{app.state?.project?.name || 'mdctl'}</span>
    <span class="slash">/</span>
    <span class="view">{view?.label}</span>
  </div>

  {#if git?.available}
    <a class="git chip" href="#/git" title="Branch {git.branch}{git.dirty ? ` · ${git.dirty} uncommitted` : ''}">
      <Icon name="branch" size={13} />
      <span class="mono ellipsis br">{git.branch || 'detached'}</span>
      {#if git.dirty}<span class="dirty tnum">●{git.dirty}</span>{/if}
    </a>
  {/if}

  {#if app.mock}
    <span class="mockpill" title={app.mockReason}>DEMO DATA</span>
  {/if}

  <span class="spacer"></span>

  <button class="search" onclick={() => (app.palette = true)} aria-label="Open command palette">
    <Icon name="search" size={15} />
    <span class="ph">Search…</span>
    <span class="kbd">{isMac ? '⌘' : 'Ctrl'}</span><span class="kbd">K</span>
  </button>

  <span class="mobile-conn"><ConnPulse showLabel={false} /></span>

  <button class="btn icon ghost" onclick={toggleTheme} aria-label="Toggle theme" title="Toggle light/dark">
    <Icon name={app.theme === 'dark' ? 'sun' : 'moon'} size={17} />
  </button>
</header>

<style>
  .top {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 12px;
    height: var(--topbar-h);
    padding: 0 clamp(12px, 2.6vw, 30px);
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg) 70%, transparent);
    backdrop-filter: blur(18px) saturate(150%);
    -webkit-backdrop-filter: blur(18px) saturate(150%);
  }
  .title { display: flex; align-items: center; gap: 8px; font-size: 14px; min-width: 0; }
  .proj { color: var(--text-2); font-weight: 500; max-width: 200px; }
  .slash { color: var(--text-3); }
  .view { font-weight: 650; }
  .git { text-decoration: none; max-width: 240px; }
  .br { max-width: 150px; }
  .dirty { color: var(--warn); font-size: 11px; font-weight: 700; }
  .mockpill {
    font: 700 10px var(--font);
    letter-spacing: 0.1em;
    padding: 4px 8px;
    border-radius: 99px;
    color: var(--accent-2);
    background: color-mix(in srgb, var(--accent-2) 14%, transparent);
    border: 1px dashed color-mix(in srgb, var(--accent-2) 45%, transparent);
    white-space: nowrap;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 8px 0 11px;
    min-width: 220px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--inset);
    color: var(--text-3);
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }
  .search:hover { border-color: var(--border-strong); color: var(--text-2); }
  .ph { flex: 1; text-align: left; font-size: 13px; }
  .mobile-conn { display: none; }
  @media (max-width: 760px) {
    .search { min-width: 0; width: 36px; padding: 0; justify-content: center; }
    .search .ph, .search .kbd { display: none; }
    .proj, .slash { display: none; }
    .mobile-conn { display: inline-flex; }
    .git .br { max-width: 90px; }
  }
  @media (max-width: 420px) {
    .git { display: none; }
  }
</style>
