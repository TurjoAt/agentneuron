<script>
  import { app, toggleTheme, goBack, goForward, canBack, canForward, navigate } from './store.svelte.js';
  import { VIEWS, href } from './nav.js';
  import { jobs } from './actions.svelte.js';
  import Icon from './Icon.svelte';
  import RadarScan from './RadarScan.svelte';
  import Bell from './Bell.svelte';
  import WorkspaceSwitcher from './insight/WorkspaceSwitcher.svelte';

  const view = $derived(VIEWS.find((v) => v.id === app.route.view));
  const git = $derived(app.state?.git);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const filePath = $derived(app.route.view === 'files' ? app.route.params.path || '' : '');
  const segs = $derived(filePath ? filePath.split('/') : []);
  const running = $derived(jobs.running.length);
</script>

<header class="top">
  <div class="navbtns">
    <button class="btn icon ghost sm" onclick={goBack} disabled={!canBack()} aria-label="Back" title="Back (Alt+←)"><Icon name="arrowLeft" size={15} /></button>
    <button class="btn icon ghost sm" onclick={goForward} disabled={!canForward()} aria-label="Forward" title="Forward (Alt+→)"><Icon name="arrowRight" size={15} /></button>
  </div>

  <nav class="crumbs" aria-label="Breadcrumbs">
    <span class="proj ellipsis">{app.state?.project?.name || 'agentneuron'}</span>
    <span class="slash">/</span>
    {#if view?.group}<span class="grp hide-md">{view.group}</span><span class="slash hide-md">/</span>{/if}
    <a class="view" href={href(app.route.view)} onclick={(e) => { if (segs.length) { e.preventDefault(); navigate('files', {}); } }}>{view?.label}</a>
    {#each segs as s, i (i)}
      <span class="slash">/</span>
      {#if i < segs.length - 1}
        <button class="seg mono" title="Filter files in {segs.slice(0, i + 1).join('/')}" onclick={() => navigate('files', { dir: segs.slice(0, i + 1).join('/') })}>{s}</button>
      {:else}
        <span class="seg last mono ellipsis">{s}</span>
      {/if}
    {/each}
  </nav>

  {#if git?.available}
    <a class="git chip hide-md" href="#/git" title="Branch {git.branch}{git.dirty ? ` · ${git.dirty} uncommitted` : ''}">
      <Icon name="branch" size={13} />
      <span class="mono ellipsis br">{git.branch || 'detached'}</span>
      {#if git.dirty}<span class="dirty tnum">●{git.dirty}</span>{/if}
    </a>
  {/if}

  {#if app.mock}
    <span class="mockpill hide-sm" title={app.mockReason}>DEMO</span>
  {/if}

  <span class="spacer"></span>

  <span class="ws hide-sm"><WorkspaceSwitcher /></span>

  <button class="search" onclick={() => (app.palette = true)} aria-label="Open command palette">
    <Icon name="search" size={15} />
    <span class="ph">Search or run…</span>
    <span class="kbd">{isMac ? '⌘' : 'Ctrl'}</span><span class="kbd">K</span>
  </button>

  {#if running}
    <button class="runpill" onclick={() => { jobs.dockVisible = true; jobs.dock = true; }} title="Jobs running">
      <span class="spin"></span><span class="tnum">{running}</span>
    </button>
  {/if}

  <RadarScan />

  <Bell />

  <button class="btn icon ghost hide-sm" onclick={() => (app.modal = { kind: 'map', props: {} })} aria-label="Product map" title="Product map: how pages and data connect (m)">
    <Icon name="map" size={17} />
  </button>

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
    gap: 10px;
    height: var(--topbar-h);
    padding: 0 clamp(10px, 2vw, 24px) 0 clamp(8px, 1.4vw, 16px);
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    backdrop-filter: blur(18px) saturate(150%);
    -webkit-backdrop-filter: blur(18px) saturate(150%);
  }
  .navbtns { display: flex; gap: 2px; }
  .navbtns .btn:disabled { opacity: 0.3; }
  .crumbs { display: flex; align-items: center; gap: 6px; font-size: 13.5px; min-width: 0; overflow: hidden; }
  .proj { color: var(--text-3); font-weight: 500; max-width: 160px; }
  .slash { color: var(--text-3); opacity: 0.6; }
  .grp { color: var(--text-3); font-weight: 500; white-space: nowrap; }
  .view { font-weight: 650; color: var(--text); text-decoration: none; white-space: nowrap; }
  .view:hover { text-decoration: none; color: var(--accent); }
  .seg { border: 0; background: transparent; padding: 2px 4px; margin: 0 -4px; border-radius: 6px; color: var(--text-2); font-size: 12.5px; cursor: pointer; white-space: nowrap; }
  .seg:hover { background: var(--panel-hover); color: var(--text); }
  .seg.last { color: var(--text); font-weight: 600; cursor: default; }
  .git { text-decoration: none; max-width: 220px; flex-shrink: 0; }
  .br { max-width: 140px; }
  .dirty { color: var(--warn); font-size: 11px; font-weight: 700; }
  .mockpill {
    font: 700 9.5px var(--font);
    letter-spacing: 0.12em;
    padding: 4px 8px;
    border-radius: 99px;
    color: var(--accent-2);
    border: 1px dashed color-mix(in srgb, var(--accent-2) 45%, transparent);
    white-space: nowrap;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 8px 0 11px;
    min-width: 230px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--inset);
    color: var(--text-3);
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }
  .search:hover { border-color: var(--border-strong); color: var(--text-2); }
  .ph { flex: 1; text-align: left; font-size: 13px; }
  .runpill { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 99px; border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); background: var(--accent-soft); color: var(--accent); font-weight: 700; font-size: 12px; cursor: pointer; }
  .spin { width: 11px; height: 11px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--accent) 30%, transparent); border-top-color: var(--accent); animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 1100px) {
    .hide-md { display: none; }
    .search { min-width: 0; }
    .search .ph { display: none; }
  }
  @media (max-width: 760px) {
    .search { width: 36px; padding: 0; justify-content: center; }
    .search .kbd { display: none; }
    .proj, .proj + .slash { display: none; }
    .hide-sm { display: none; }
    .navbtns { display: none; }
  }
</style>
