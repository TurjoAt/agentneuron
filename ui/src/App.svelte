<script>
  import { onMount } from 'svelte';
  import { app, boot, navigate } from './lib/store.svelte.js';
  import { VIEWS } from './lib/nav.js';
  import Sidebar from './lib/Sidebar.svelte';
  import Topbar from './lib/Topbar.svelte';
  import Palette from './lib/Palette.svelte';
  import Drawer from './lib/Drawer.svelte';
  import Toasts from './lib/Toasts.svelte';
  import Overview from './views/Overview.svelte';
  import Graph from './views/Graph.svelte';
  import Files from './views/Files.svelte';
  import Diff from './views/Diff.svelte';
  import Context from './views/Context.svelte';
  import Health from './views/Health.svelte';
  import Tasks from './views/Tasks.svelte';
  import Git from './views/Git.svelte';
  import Agents from './views/Agents.svelte';

  const COMPONENTS = { overview: Overview, graph: Graph, files: Files, diff: Diff, context: Context, health: Health, tasks: Tasks, git: Git, agents: Agents };
  const View = $derived(COMPONENTS[app.route.view] || Overview);

  let tokenInput = $state('');

  onMount(() => {
    boot();
  });

  function isTyping(e) {
    const t = e.target;
    return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }

  function onkeydown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      app.palette = !app.palette;
      return;
    }
    if (e.key === 'Escape') {
      if (app.palette) app.palette = false;
      else if (app.drawer) app.drawer = null;
      return;
    }
    if (app.palette || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') {
      e.preventDefault();
      app.palette = true;
      return;
    }
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= VIEWS.length) {
      e.preventDefault();
      app.drawer = null;
      navigate(VIEWS[n - 1].id);
    }
  }

  function submitToken(e) {
    e.preventDefault();
    const u = new URL(location.href);
    u.searchParams.set('token', tokenInput.trim());
    location.href = u.toString();
  }

  let mainEl = $state();
  $effect(() => {
    void app.route.view;
    mainEl?.scrollTo?.({ top: 0 });
  });
</script>

<svelte:window {onkeydown} />

{#if !app.ready}
  <div class="splash">
    <div class="logo-pulse"></div>
    <div class="faint">Loading context…</div>
  </div>
{:else if app.authRequired}
  <div class="splash">
    <form class="auth card" onsubmit={submitToken}>
      <h1>Access token required</h1>
      <p class="muted">This mdctl server is protected. Paste the token printed in the terminal where mdctl was started.</p>
      <input class="input mono" bind:value={tokenInput} placeholder="token" aria-label="Access token" autocomplete="off" />
      <button class="btn primary" type="submit" disabled={!tokenInput.trim()}>Unlock</button>
    </form>
  </div>
{:else if app.fatal}
  <div class="splash"><div class="auth card"><h1>Something went wrong</h1><p class="muted">{app.fatal}</p></div></div>
{:else}
  <div class="shell">
    <Sidebar />
    <main class="main" bind:this={mainEl}>
      <Topbar />
      {#key app.route.view}
        <View params={app.route.params} />
      {/key}
    </main>
  </div>
  <Drawer />
  <Palette />
{/if}
<Toasts />

<style>
  .shell {
    display: grid;
    grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
    height: 100vh;
    height: 100dvh;
  }
  .main {
    overflow: auto;
    min-width: 0;
    position: relative;
  }
  .splash {
    height: 100vh;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 18px;
    padding: 16px;
  }
  .logo-pulse {
    width: 46px;
    height: 46px;
    border-radius: 13px;
    background: linear-gradient(135deg, #ff8a4c, #c07bff 55%, #4f8dff);
    animation: breathe 1.4s var(--ease) infinite alternate;
    box-shadow: 0 10px 40px -8px #c07bff;
  }
  @keyframes breathe {
    from { transform: scale(0.9) rotate(-4deg); opacity: 0.7; }
    to { transform: scale(1.05) rotate(4deg); opacity: 1; }
  }
  .auth {
    padding: 26px;
    width: min(420px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .auth h1 { margin: 0; font-size: 18px; }
  .auth p { margin: 0; font-size: 13px; }
  @media (max-width: 760px) {
    .shell {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto;
    }
    .shell > :global(.side) { order: 2; }
  }
</style>
