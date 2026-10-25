<script>
  import { app, saveLocal, logout, fileIndex } from './store.svelte.js';
  import { VIEWS, href } from './nav.js';
  import { fileHref } from './links.js';
  import { openMenu } from './menu.svelte.js';
  import { fileMenuItems } from './fileActions.js';
  import { basename, dirname } from './format.js';
  import Icon from './Icon.svelte';
  import ConnPulse from './ConnPulse.svelte';
  import ToolBadge from './ToolBadge.svelte';

  const badges = $derived({
    health: app.health?.counts?.error || 0,
    agents: app.conflicts.length,
  });
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
      <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
        <defs>
          <linearGradient id="brand-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#ff8a4c" />
            <stop offset="0.55" stop-color="#c07bff" />
            <stop offset="1" stop-color="#4f8dff" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill="url(#brand-g)" />
        <path d="M8 22V10l4 5 4-5v12M20 10v8m0 0-3-3m3 3 3-3M19 22h6" stroke="white" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </span>
    <span class="name">AgentNeuron<span class="sub">{app.state?.project?.name || 'context control'}</span></span>
  </a>

  <div class="scroll">
    <ul class="nav">
      {#each VIEWS as v, i (v.id)}
        {#if v.group && v.group !== VIEWS[i - 1]?.group}<li class="sec" aria-hidden="true">{v.group}</li>{/if}
        <li class:sm-hide={v.id === 'settings'}>
          <a class="item" class:on={app.route.view === v.id} href={href(v.id)} aria-current={app.route.view === v.id ? 'page' : undefined} title="{v.label}{i < 9 ? ` (${i + 1})` : ''}">
            <Icon name={v.icon} size={16} />
            <span class="lbl">{v.label}</span>
            {#if badges[v.id]}<span class="bdg" class:err={v.id === 'health' || v.id === 'agents'}>{badges[v.id]}</span>{/if}
            {#if i < 9}<span class="kbd k">{i + 1}</span>{/if}
          </a>
        </li>
      {/each}
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
            ...(app.me?.tokenRequired ? [{ sep: true }, { label: 'Sign out', icon: 'logout', run: logout }] : []),
          ],
        )}
    >
      <span class="av" class:admin={app.me?.role === 'admin'}><Icon name={app.me?.role === 'admin' ? 'shield' : 'eye'} size={12} /></span>
      <span class="col" style="gap:0;min-width:0">
        <span class="role">{app.me?.role || 'guest'}</span>
        <ConnPulse />
      </span>
    </button>
    <span class="version faint">v{app.state?.version || '—'}</span>
  </div>
</nav>

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
  .nav { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
  .nav .sec { margin: 12px 0 4px; padding: 0 10px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-3); }
  .nav .sec:first-child { margin-top: 2px; }
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
  .version { font-size: 10.5px; font-family: var(--mono); }

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
    .scroll { margin: 0; padding: 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; flex-direction: row; }
    .nav { flex-direction: row; gap: 0; }
    .nav .sec { display: none; }
    .nav li { flex: 1 0 auto; }
    .item { flex-direction: column; gap: 3px; height: 50px; padding: 6px 8px; font-size: 10px; justify-content: center; min-width: 58px; }
    .item.on { background: transparent; }
    .item.on::before { left: 30%; right: 30%; top: -4px; bottom: auto; width: auto; height: 3px; border-radius: 0 0 3px 3px; }
    .k { display: none; }
    .bdg { position: absolute; top: 3px; right: 8px; }
  }
</style>
