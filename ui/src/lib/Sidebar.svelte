<script>
  import { app } from './store.svelte.js';
  import { VIEWS, href } from './nav.js';
  import Icon from './Icon.svelte';
  import ConnPulse from './ConnPulse.svelte';

  const badges = $derived({
    health: app.health?.counts?.error || 0,
    agents: app.conflicts.length,
  });
</script>

<nav class="side" aria-label="Main">
  <a class="brand" href="#/overview" aria-label="mdctl overview">
    <span class="mark">
      <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
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
    <span class="name">mdctl<span class="sub">{app.state?.project?.name || 'context control'}</span></span>
  </a>

  <ul class="nav">
    {#each VIEWS as v, i (v.id)}
      <li>
        <a class="item" class:on={app.route.view === v.id} href={href(v.id)} aria-current={app.route.view === v.id ? 'page' : undefined} title="{v.label} ({i + 1})">
          <Icon name={v.icon} size={17} />
          <span class="lbl">{v.label}</span>
          {#if badges[v.id]}<span class="bdg" class:err={v.id === 'health' || v.id === 'agents'}>{badges[v.id]}</span>{/if}
          <span class="kbd k">{i + 1}</span>
        </a>
      </li>
    {/each}
  </ul>

  <div class="foot">
    <ConnPulse />
    <span class="version faint">v{app.state?.version || '—'}</span>
  </div>
</nav>

<style>
  .side {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 14px 10px;
    height: 100%;
    border-right: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-elev) 55%, transparent);
    backdrop-filter: blur(20px);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 8px 14px;
    color: var(--text);
    text-decoration: none;
  }
  .mark { display: grid; filter: drop-shadow(0 4px 14px rgba(192, 123, 255, 0.35)); }
  .name { display: flex; flex-direction: column; font-weight: 700; font-size: 16px; letter-spacing: -0.02em; line-height: 1.15; min-width: 0; }
  .sub { font-size: 11.5px; font-weight: 500; color: var(--text-3); letter-spacing: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px; }
  .nav { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; flex: 1; }
  .item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 11px;
    height: 36px;
    padding: 0 10px;
    border-radius: 10px;
    color: var(--text-2);
    font-weight: 550;
    font-size: 13.5px;
    text-decoration: none;
    transition: color 0.15s, background 0.15s;
  }
  .item:hover { color: var(--text); background: var(--panel-hover); text-decoration: none; }
  .item.on {
    color: var(--text);
    background: linear-gradient(90deg, var(--accent-soft), transparent);
  }
  .item.on::before {
    content: '';
    position: absolute;
    left: -10px;
    top: 9px;
    bottom: 9px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: var(--accent);
    box-shadow: 0 0 12px var(--accent);
  }
  .item.on :global(.icon) { color: var(--accent); }
  .lbl { flex: 1; }
  .k { opacity: 0; transition: opacity 0.15s; }
  .item:hover .k { opacity: 1; }
  .bdg {
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 99px;
    font-size: 10.5px;
    font-weight: 700;
    display: grid;
    place-items: center;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .bdg.err { background: var(--err-soft); color: var(--err); }
  .foot { display: flex; align-items: center; justify-content: space-between; padding: 8px 4px 0; border-top: 1px solid var(--border); }
  .version { font-size: 11px; font-family: var(--mono); }

  @media (max-width: 760px) {
    .side {
      flex-direction: row;
      height: auto;
      padding: 6px 6px calc(6px + env(safe-area-inset-bottom));
      border-right: 0;
      border-top: 1px solid var(--border);
      background: color-mix(in srgb, var(--bg-elev) 85%, transparent);
    }
    .brand, .foot { display: none; }
    .nav { flex-direction: row; overflow-x: auto; scrollbar-width: none; gap: 0; }
    .nav li { flex: 1 0 auto; }
    .item { flex-direction: column; gap: 2px; height: 50px; padding: 6px 10px; font-size: 10px; justify-content: center; min-width: 56px; }
    .item.on::before { left: 30%; right: 30%; top: -7px; bottom: auto; width: auto; height: 3px; border-radius: 0 0 3px 3px; }
    .k { display: none; }
    .bdg { position: absolute; top: 3px; right: 8px; }
  }
</style>
