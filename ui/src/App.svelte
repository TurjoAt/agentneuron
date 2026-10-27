<script>
  import { onMount } from 'svelte';
  import { app, boot, navigate, goBack, goForward } from './lib/store.svelte.js';
  import { VIEWS } from './lib/nav.js';
  import { jobs } from './lib/actions.svelte.js';
  import { closeModal, findReplace, newFile } from './lib/fileActions.js';
  import { canRun } from './lib/actions.js';
  import Sidebar from './lib/Sidebar.svelte';
  import Topbar from './lib/Topbar.svelte';
  import Palette from './lib/Palette.svelte';
  import Drawer from './lib/Drawer.svelte';
  import Toasts from './lib/Toasts.svelte';
  import Login from './lib/Login.svelte';
  import JobsDock from './lib/JobsDock.svelte';
  import ActionDialog from './lib/ActionDialog.svelte';
  import ContextMenu from './lib/ContextMenu.svelte';
  import PeekCard from './lib/PeekCard.svelte';
  import ConfirmDialog from './lib/dialogs/ConfirmDialog.svelte';
  import NewFileDialog from './lib/dialogs/NewFileDialog.svelte';
  import RenameDialog from './lib/dialogs/RenameDialog.svelte';
  import ReplaceDialog from './lib/dialogs/ReplaceDialog.svelte';
  import ShortcutsDialog from './lib/dialogs/ShortcutsDialog.svelte';
  import TaskModal from './lib/board/TaskModal.svelte';
  import Overview from './views/Overview.svelte';
  import Graph from './views/Graph.svelte';
  import Files from './views/Files.svelte';
  import Diff from './views/Diff.svelte';
  import Context from './views/Context.svelte';
  import Health from './views/Health.svelte';
  import Tasks from './views/Tasks.svelte';
  import Git from './views/Git.svelte';
  import Agents from './views/Agents.svelte';
  import Reports from './views/Reports.svelte';
  import Project from './views/Project.svelte';
  import Settings from './views/Settings.svelte';
  import Live from './views/Live.svelte';
  import Verify from './views/Verify.svelte';
  import Insights from './views/Insights.svelte';
  import Rules from './views/Rules.svelte';
  import Usage from './views/Usage.svelte';
  import Sessions from './views/Sessions.svelte';
  import Memory from './views/Memory.svelte';
  import Ship from './views/Ship.svelte';
  import Changes from './views/Changes.svelte';
  import Brief from './views/Brief.svelte';
  import EntityDrawer from './lib/EntityDrawer.svelte';
  import BootScreen from './lib/boot/BootScreen.svelte';
  import RelatedStrip from './lib/RelatedStrip.svelte';
  import ProductMap from './lib/map/ProductMap.svelte';
  import { entity, closeEntity } from './lib/entity.svelte.js';

  const COMPONENTS = { overview: Overview, graph: Graph, files: Files, diff: Diff, context: Context, health: Health, tasks: Tasks, git: Git, agents: Agents, reports: Reports, project: Project, settings: Settings, live: Live, verify: Verify, insights: Insights, rules: Rules, usage: Usage, sessions: Sessions, memory: Memory, ship: Ship, changes: Changes, brief: Brief };
  const MODALS = { confirm: ConfirmDialog, 'new-file': NewFileDialog, rename: RenameDialog, replace: ReplaceDialog, task: TaskModal, shortcuts: ShortcutsDialog, map: ProductMap };
  const View = $derived(COMPONENTS[app.route.view] || Overview);
  const ModalC = $derived(app.modal ? MODALS[app.modal.kind] : null);

  // Boot overlay: shown until boot() finishes and its exit animation completes. Auth / fatal outcomes skip the animation.
  let bootVisible = $state(true);
  const shellReady = $derived(app.ready && !app.authRequired && !app.fatal);
  $effect(() => {
    if (!app.ready) bootVisible = true;
    else if (app.authRequired || app.fatal) bootVisible = false;
  });

  onMount(() => {
    boot();
  });
  // fallback: never leave the pre-JS splash behind once the boot overlay is gone
  $effect(() => {
    if (!bootVisible) document.getElementById('splash')?.remove();
  });

  function isTyping(e) {
    const t = e.target;
    return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest?.('.cm-editor'));
  }

  function onkeydown(e) {
    if (!app.ready || app.authRequired) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'k') {
      e.preventDefault();
      app.palette = !app.palette;
      return;
    }
    if (mod && e.shiftKey && k === 'f') {
      e.preventDefault();
      findReplace();
      return;
    }
    if (mod && k === 'j') {
      e.preventDefault();
      jobs.dockVisible = true;
      jobs.dock = !jobs.dock;
      return;
    }
    if (e.altKey && !mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      e.key === 'ArrowLeft' ? goBack() : goForward();
      return;
    }
    if (e.key === 'Escape') {
      if (app.palette) app.palette = false;
      else if (app.modal) return;
      else if (entity.current) closeEntity();
      else if (app.drawer) app.drawer = null;
      else if (jobs.dock && !app.modal) jobs.dock = false;
      return;
    }
    if (app.palette || app.modal || isTyping(e) || mod || e.altKey) return;
    if (e.key === '/') {
      e.preventDefault();
      app.palette = true;
      return;
    }
    if (e.key === '?') {
      e.preventDefault();
      app.modal = { kind: 'shortcuts', props: {} };
      return;
    }
    if (e.key === 'm') {
      e.preventDefault();
      app.modal = { kind: 'map', props: {} };
      return;
    }
    if (e.key === 'n' && canRun('edit')) {
      e.preventDefault();
      newFile();
      return;
    }
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 9 && n <= VIEWS.length) {
      e.preventDefault();
      app.drawer = null;
      navigate(VIEWS[n - 1].id);
    } else if (e.key === '0') {
      e.preventDefault();
      navigate('settings');
    }
  }

  function onbeforeunload(e) {
    if (Object.keys(app.dirty).length) {
      e.preventDefault();
      e.returnValue = '';
    }
  }

  let mainEl = $state();
  $effect(() => {
    void app.route.view;
    mainEl?.scrollTo?.({ top: 0 });
  });

  // mobile: full-height views (files/tasks/git) manage their own scroll
  const fullBleed = $derived(['files', 'graph'].includes(app.route.view));
</script>

<svelte:window {onkeydown} {onbeforeunload} />

{#if app.ready && app.authRequired}
  <Login />
{:else if app.ready && app.fatal}
  <div class="splash">
    <div class="auth card" role="alert">
      <h1>Something went wrong</h1>
      <p class="muted">{app.fatal}</p>
      <button class="btn primary" onclick={() => location.reload()}>Reload</button>
    </div>
  </div>
{:else if shellReady}
  <div class="shell" class:dock-open={jobs.dockVisible && jobs.dock}>
    <Sidebar />
    <main class="main" class:bleed={fullBleed} bind:this={mainEl}>
      <Topbar />
      {#if !fullBleed}<RelatedStrip />{/if}
      {#key app.route.view}
        <View params={app.route.params} />
      {/key}
      {#if jobs.dockVisible}<div class="dock-spacer" class:open={jobs.dock}></div>{/if}
    </main>
  </div>
  <Drawer />
  <EntityDrawer />
  <Palette />
  <JobsDock />
  <ActionDialog />
  {#if ModalC}
    {#key app.modal}
      <ModalC {...app.modal.props} onclose={closeModal} />
    {/key}
  {/if}
  <ContextMenu />
  <PeekCard />
{/if}
{#if bootVisible}
  <BootScreen ready={shellReady} onexit={() => (bootVisible = false)} />
{/if}
<Toasts />

<style>
  .shell {
    display: grid;
    grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
    height: 100vh;
    height: 100dvh;
  }
  .shell { animation: shell-in 0.6s var(--ease) both; }
  @keyframes shell-in { from { opacity: 0; transform: scale(0.985); } to { opacity: 1; transform: none; } }
  .main {
    overflow: auto;
    min-width: 0;
    position: relative;
  }
  .dock-spacer { height: 52px; }
  .dock-spacer.open { height: min(340px, 44dvh); }
  .splash {
    height: 100vh;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 18px;
    padding: 16px;
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
  .auth .btn { align-self: flex-start; }
  @media (max-width: 760px) {
    .shell {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto;
    }
    .shell > :global(.side) { order: 2; }
  }
</style>
