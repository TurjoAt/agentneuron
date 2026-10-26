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
  import EntityDrawer from './lib/EntityDrawer.svelte';

  const COMPONENTS = { overview: Overview, graph: Graph, files: Files, diff: Diff, context: Context, health: Health, tasks: Tasks, git: Git, agents: Agents, reports: Reports, project: Project, settings: Settings, live: Live, verify: Verify, insights: Insights, rules: Rules, usage: Usage, sessions: Sessions, memory: Memory };
  const MODALS = { confirm: ConfirmDialog, 'new-file': NewFileDialog, rename: RenameDialog, replace: ReplaceDialog, task: TaskModal, shortcuts: ShortcutsDialog };
  const View = $derived(COMPONENTS[app.route.view] || Overview);
  const ModalC = $derived(app.modal ? MODALS[app.modal.kind] : null);

  onMount(() => {
    boot();
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

{#if !app.ready}
  <div class="splash">
    <div class="logo-pulse"></div>
    <div class="faint">Loading context…</div>
  </div>
{:else if app.authRequired}
  <Login />
{:else if app.fatal}
  <div class="splash"><div class="auth card"><h1>Something went wrong</h1><p class="muted">{app.fatal}</p></div></div>
{:else}
  <div class="shell" class:dock-open={jobs.dockVisible && jobs.dock}>
    <Sidebar />
    <main class="main" class:bleed={fullBleed} bind:this={mainEl}>
      <Topbar />
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
