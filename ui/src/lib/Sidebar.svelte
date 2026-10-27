<script>
  import { app, saveLocal, logout, fileIndex } from './store.svelte.js';
  import { VIEWS, GROUPS, MOBILE_PRIMARY, href } from './nav.js';
  import { badgeFor, refreshNavBadges } from './navbadges.svelte.js';
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { dur } from './motion.js';
  import { fileHref, REPO_URL } from './links.js';
  import { openMenu } from './menu.svelte.js';
  import { fileMenuItems } from './fileActions.js';
  import { basename, dirname } from './format.js';
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';
  import ConnPulse from './ConnPulse.svelte';
  import ToolBadge from './ToolBadge.svelte';

  const keyOf = Object.fromEntries(VIEWS.map((v, i) => [v.id, i < 9 ? String(i + 1) : v.id === 'settings' ? '0' : '']));
  const sections = GROUPS.map((g) => ({ ...g, views: VIEWS.filter((v) => v.group === g.id) }));
  const settingsView = VIEWS.find((v) => v.id === 'settings');
  const primary = MOBILE_PRIMARY.map((id) => VIEWS.find((v) => v.id === id));

  // collapsible groups (remembered per browser)
  let collapsed = $state(loadCollapsed());
  function loadCollapsed() {
    try {
      return JSON.parse(localStorage.getItem('agentneuron.side.groups') || '[]');
    } catch {
      return [];
    }
  }
  function toggleGroup(id) {
    collapsed = collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id];
    saveLocal('agentneuron.side.groups', collapsed);
  }
  const groupBadge = (g) => g.views.reduce((a, v) => a + (badgeFor(v.id).n || 0), 0);

  // badges that need data refresh when files change (throttled inside)
  // (the first load happens after boot, in navbadges.svelte.js; this only reacts to later changes)
  const firstTick = app.dataTick;
  $effect(() => {
    if (app.dataTick !== firstTick) refreshNavBadges();
  });

  // phones: "More" sheet with every page, grouped
  let more = $state(false);
  $effect(() => {
    void app.route.view;
    more = false;
  });
  const inPrimary = $derived(MOBILE_PRIMARY.includes(app.route.view));
  const curPath = $derived(app.route.view === 'files' ? app.route.params.path : null);
  const pinned = $derived(app.bookmarks.filter((b) => b && b.path));
  const recent = $derived(app.recent.filter((p) => !pinned.some((b) => b.path === p) && fileIndex().set.has(p)).slice(0, 6));
  const toolOfPath = (p) => fileIndex().byPath.get(p)?.tool;

  function toggle(which) {
    if (which === 'pinned') saveLocal('agentneuron.side.pinned', (app.sidePinnedOpen = !app.sidePinnedOpen));
    else saveLocal('agentneuron.side.recent', (app.sideRecentOpen = !app.sideRecentOpen));
  }
</script>

<nav class="side" aria-label="Main">
  <a class="brand" href="#/overview" aria-label="AgentNeuron overview">
    <span class="mark">
      <Logo size={28} />
    </span>
    <span class="name">AgentNeuron<span class="sub">{app.state?.project?.name || 'context control'}</span></span>
  </a>

  <div class="scroll">
    {#snippet item(v)}
      {@const b = badgeFor(v.id)}
      <a class="item" class:on={app.route.view === v.id} href={href(v.id)} aria-current={app.route.view === v.id ? 'page' : undefined} title="{v.desc || v.label}{keyOf[v.id] ? ` (${keyOf[v.id]})` : ''}">
        <Icon name={v.icon} size={16} />
        <span class="lbl">{v.label}</span>
        {#if b.n}<span class="bdg {b.tone}" title="{b.n} {b.title}">{b.n}</span>{/if}
        {#if keyOf[v.id]}<span class="kbd k">{keyOf[v.id]}</span>{/if}
      </a>
    {/snippet}
    <div class="nav">
      {#each sections as g (g.id)}
        {@const open = !collapsed.includes(g.id)}
        {@const nb = open ? 0 : groupBadge(g)}
        <div class="gsec">
          <button class="sec" onclick={() => toggleGroup(g.id)} aria-expanded={open} title={g.desc}>
            <span>{g.id}</span>
            {#if nb}<span class="gdot" title="{nb} alerts in {g.id}"></span>{/if}
            <span class="chev" class:open><Icon name="chevron" size={10} /></span>
          </button>
          <ul>
            {#each g.views as v (v.id)}
              {#if open || app.route.view === v.id}<li>{@render item(v)}</li>{/if}
            {/each}
          </ul>
        </div>
      {/each}
      <ul class="sm-hide"><li>{@render item(settingsView)}</li></ul>
    </div>

    <!-- phones: bottom bar -->
    <ul class="mbar">
      {#each primary as v (v.id)}<li>{@render item(v)}</li>{/each}
      <li>
        <button class="item" class:on={!inPrimary || more} onclick={() => (more = !more)} aria-expanded={more} aria-controls="more-sheet">
          <Icon name="grid" size={16} /><span class="lbl">More</span>
        </button>
      </li>
    </ul>

    <section class="grp">
      <button class="gh" onclick={() => toggle('pinned')} aria-expanded={app.sidePinnedOpen}>
        <span class="chev" class:open={app.sidePinnedOpen}><Icon name="chevron" size={11} /></span>
        Pinned <span class="n tnum">{pinned.length || ''}</span>
      </button>
      {#if app.sidePinnedOpen}
        {#each pinned as b (b.path)}
          <a
            class="fl"
            class:on={curPath === b.path}
            href={fileHref(b.path)}
            data-path={b.path}
            title={b.path}
            oncontextmenu={(e) => openMenu(e, fileMenuItems(b.path), b.path)}
          >
            <ToolBadge tool={toolOfPath(b.path)} compact />
            <span class="ellipsis grow">{b.label || basename(b.path)}</span>
            {#if !b.label && dirname(b.path)}<span class="dir ellipsis">{dirname(b.path)}</span>{/if}
          </a>
        {:else}
          <div class="hint">Right-click any file → <b>Pin to sidebar</b></div>
        {/each}
      {/if}
    </section>

    {#if recent.length}
      <section class="grp">
        <button class="gh" onclick={() => toggle('recent')} aria-expanded={app.sideRecentOpen}>
          <span class="chev" class:open={app.sideRecentOpen}><Icon name="chevron" size={11} /></span>
          Recent
        </button>
        {#if app.sideRecentOpen}
          {#each recent as p (p)}
            <a class="fl" class:on={curPath === p} href={fileHref(p)} data-path={p} title={p} oncontextmenu={(e) => openMenu(e, fileMenuItems(p), p)}>
              <ToolBadge tool={toolOfPath(p)} compact />
              <span class="ellipsis grow">{basename(p)}</span>
              {#if dirname(p)}<span class="dir ellipsis">{dirname(p)}</span>{/if}
            </a>
          {/each}
        {/if}
      </section>
    {/if}
  </div>

  <div class="foot">
    <button
      class="me"
      title="Session"
      onclick={(e) =>
        openMenu(
          e.currentTarget,
          [
            { header: `Signed in as ${app.me?.role || '—'}` },
            { label: 'Permissions & roles', icon: 'shield', run: () => (location.hash = '#/settings?tab=permissions') },
            { label: 'Keyboard shortcuts', icon: 'command', kbd: '?', run: () => (app.modal = { kind: 'shortcuts', props: {} }) },
            { label: 'Product map', icon: 'map', kbd: 'm', run: () => (app.modal = { kind: 'map', props: {} }) },
            { label: 'AgentNeuron on GitHub', icon: 'github', run: () => window.open(REPO_URL, '_blank', 'noopener,noreferrer') },
            { label: 'Report an issue', icon: 'flag', run: () => window.open(`${REPO_URL}/issues/new`, '_blank', 'noopener,noreferrer') },
            ...(app.me?.tokenRequired ? [{ sep: true }, { label: 'Sign out', icon: 'logout', run: logout }] : []),
          ],
        )}
    >
      <span class="av" class:admin={app.me?.role === 'admin'}><Icon name={app.me?.role === 'admin' ? 'shield' : 'eye'} size={12} /></span>
      <span class="col" style="gap:0;min-width:0">
        <span class="role">{app.me?.role || 'guest'}</span>
        <span class="version faint">v{app.state?.version || '—'}</span>
      </span>
    </button>
    <ConnPulse />
  </div>
</nav>

{#if more}
  <div class="msheet-bg" transition:fade={{ duration: dur(150) }} onclick={() => (more = false)} aria-hidden="true"></div>
  <div class="msheet" id="more-sheet" role="dialog" aria-label="All pages" transition:fly={{ y: 40, duration: dur(240), easing: cubicOut }}>
    {#each sections as g (g.id)}
      <div class="mg">
        <div class="eyebrow">{g.id}</div>
        <div class="mgrid">
          {#each g.views as v (v.id)}
            {@const b = badgeFor(v.id)}
            <a class="mtile" class:on={app.route.view === v.id} href={href(v.id)}>
              <Icon name={v.icon} size={18} /><span>{v.label}</span>
              {#if b.n}<span class="bdg {b.tone}">{b.n}</span>{/if}
            </a>
          {/each}
        </div>
      </div>
    {/each}
    <div class="mg">
      <div class="mgrid">
        <a class="mtile" href={href('settings')}><Icon name="settings" size={18} /><span>Settings</span></a>
        <button class="mtile" onclick={() => { more = false; app.modal = { kind: 'map', props: {} }; }}><Icon name="map" size={18} /><span>Product map</span></button>
      </div>
    </div>
  </div>
{/if}

<style>
  .side {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 14px 10px 10px;
    height: 100%;
    min-height: 0;
    border-right: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-elev) 55%, transparent);
    backdrop-filter: blur(20px);
  }
  .brand { display: flex; align-items: center; gap: 10px; padding: 2px 8px 12px; color: var(--text); text-decoration: none; }
  .brand:hover { text-decoration: none; }
  .mark { display: grid; filter: drop-shadow(0 4px 14px rgba(192, 123, 255, 0.3)); }
  .name { display: flex; flex-direction: column; font-weight: 700; font-size: 15px; letter-spacing: -0.02em; line-height: 1.15; min-width: 0; }
  .sub { font-size: 11.5px; font-weight: 500; color: var(--text-3); letter-spacing: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px; }
  .scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; margin: 0 -4px; padding: 0 4px; display: flex; flex-direction: column; gap: 14px; }
  .nav { display: flex; flex-direction: column; gap: 6px; }
  .nav ul, .mbar { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
  .mbar { display: none; }
  .sec {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 4px 0 2px;
    padding: 3px 10px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-3);
    cursor: pointer;
    text-align: left;
  }
  .sec:hover { color: var(--text-2); }
  .sec .chev { margin-left: auto; opacity: 0; transition: opacity 0.15s, transform 0.18s var(--ease); }
  .sec:hover .chev, .sec:focus-visible .chev, .sec[aria-expanded='false'] .chev { opacity: 1; }
  .gdot { width: 6px; height: 6px; border-radius: 50%; background: var(--warn); }
  .item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 11px;
    height: 33px;
    padding: 0 10px;
    border-radius: 9px;
    color: var(--text-2);
    font-weight: 540;
    font-size: 13.5px;
    text-decoration: none;
    transition: color 0.15s, background 0.15s;
  }
  .item:hover { color: var(--text); background: var(--panel-hover); text-decoration: none; }
  .item.on { color: var(--text); background: var(--panel-active); }
  .item.on::before { content: ''; position: absolute; left: -10px; top: 9px; bottom: 9px; width: 3px; border-radius: 0 3px 3px 0; background: var(--accent); }
  .item.on :global(.icon) { color: var(--accent); }
  .lbl { flex: 1; }
  .k { opacity: 0; transition: opacity 0.15s; }
  .item:hover .k { opacity: 1; }
  .bdg { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 99px; font-size: 10.5px; font-weight: 700; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
  .bdg.err { background: var(--err-soft); color: var(--err); }
  .bdg.warn { background: var(--warn-soft); color: var(--warn); }
  button.item { width: 100%; border: 0; background: transparent; cursor: pointer; }
  .msheet-bg { position: fixed; inset: 0 0 calc(59px + env(safe-area-inset-bottom)); z-index: 70; background: rgba(5, 6, 10, 0.4); }
  .msheet {
    position: fixed;
    z-index: 71;
    left: 0;
    right: 0;
    bottom: calc(59px + env(safe-area-inset-bottom));
    max-height: calc(100dvh - 120px);
    overflow: auto;
    padding: 10px 16px 16px;
    background: var(--panel-solid);
    border-top: 1px solid var(--border);
    border-radius: 18px 18px 0 0;
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .msheet::before { content: ''; align-self: center; width: 36px; height: 4px; border-radius: 4px; background: var(--border-strong); }
  .mg { display: flex; flex-direction: column; gap: 6px; }
  .mgrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .mtile {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 10px 4px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: var(--inset);
    color: var(--text-2);
    font-size: 11.5px;
    text-align: center;
    text-decoration: none;
    cursor: pointer;
  }
  .mtile:hover { text-decoration: none; color: var(--text); }
  .mtile.on { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); background: var(--accent-soft); }
  .mtile .bdg { position: absolute; top: 4px; right: 4px; }
  .grp { display: flex; flex-direction: column; gap: 1px; }
  .gh { display: flex; align-items: center; gap: 6px; border: 0; background: transparent; padding: 4px 8px; font-size: 10.5px; font-weight: 650; letter-spacing: 0.09em; text-transform: uppercase; color: var(--text-3); cursor: pointer; text-align: left; }
  .gh:hover { color: var(--text-2); }
  .gh .n { margin-left: auto; letter-spacing: 0; }
  .chev { display: inline-grid; transition: transform 0.18s var(--ease); }
  .chev.open { transform: rotate(90deg); }
  .fl { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 8px 0 12px; border-radius: 8px; font-size: 12.5px; color: var(--text-2); text-decoration: none; min-width: 0; }
  .fl:hover { background: var(--panel-hover); color: var(--text); text-decoration: none; }
  .fl.on { background: var(--accent-soft); color: var(--text); }
  .dir { font-size: 10.5px; color: var(--text-3); max-width: 70px; font-family: var(--mono); }
  .hint { font-size: 11.5px; color: var(--text-3); padding: 4px 12px 2px; line-height: 1.5; }
  .hint b { color: var(--text-2); font-weight: 600; }
  .foot { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 8px 2px 0; border-top: 1px solid var(--border); }
  .me { display: flex; align-items: center; gap: 9px; border: 0; background: transparent; padding: 5px 6px; border-radius: 9px; cursor: pointer; min-width: 0; text-align: left; }
  .me:hover { background: var(--panel-hover); }
  .av { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; background: var(--panel-active); color: var(--text-2); flex-shrink: 0; }
  .av.admin { background: var(--accent-soft); color: var(--accent); }
  .role { font-size: 12px; font-weight: 600; text-transform: capitalize; line-height: 1.2; }
  .version { font-size: 10.5px; font-family: var(--mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .foot :global(.conn) { white-space: nowrap; flex-shrink: 0; }

  @media (max-width: 760px) {
    .side {
      flex-direction: row;
      height: auto;
      padding: 4px 4px calc(4px + env(safe-area-inset-bottom));
      border-right: 0;
      border-top: 1px solid var(--border);
      background: color-mix(in srgb, var(--bg-elev) 88%, transparent);
    }
    .brand, .foot, .grp { display: none; }
    .scroll { margin: 0; padding: 0; overflow: visible; flex-direction: row; flex: 1; }
    .nav { display: none; }
    .mbar { display: flex; flex-direction: row; gap: 0; flex: 1; }
    .mbar li { flex: 1 1 0; min-width: 0; }
    .item { flex-direction: column; gap: 3px; height: 50px; padding: 6px 4px; font-size: 10.5px; justify-content: center; min-width: 0; }
    .item .lbl { flex: 0 0 auto; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .item.on { background: transparent; }
    .item.on::before { left: 30%; right: 30%; top: -4px; bottom: auto; width: auto; height: 3px; border-radius: 0 0 3px 3px; }
    .k { display: none; }
    .bdg { position: absolute; top: 3px; right: 8px; }
  }
</style>
