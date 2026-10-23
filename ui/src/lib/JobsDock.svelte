<script>
  // Bottom-docked job runner panel: queue/history list + live terminal log.
  import { tick } from 'svelte';
  import { slide } from 'svelte/transition';
  import { app } from './store.svelte.js';
  import { jobs, openJob, cancelJob, isDone } from './actions.svelte.js';
  import { timeAgo, fmtTime } from './format.js';
  import { dur } from './motion.js';
  import { LEVELS } from './levels.js';
  import Icon from './Icon.svelte';

  const active = $derived(jobs.list.find((j) => j.id === jobs.active) || jobs.list[0] || null);
  const log = $derived(active ? jobs.logs[active.id] || [] : []);
  const running = $derived(jobs.running);
  const latest = $derived(jobs.list[0]);

  let logEl = $state();
  let follow = $state(true);
  let filter = $state('all'); // all | stderr

  const shown = $derived(filter === 'stderr' ? log.filter((l) => l.stream === 'stderr') : log);

  $effect(() => {
    void shown.length;
    if (!follow || !logEl) return;
    tick().then(() => logEl && (logEl.scrollTop = logEl.scrollHeight));
  });

  $effect(() => {
    const a = active;
    if (a && jobs.dock && !jobs.logs[a.id]?.length && isDone(a)) openJob(a.id);
  });

  function onscroll() {
    if (!logEl) return;
    follow = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 30;
  }

  function dura(j) {
    if (!j?.startedAt) return '';
    const ms = (j.endedAt || app.now) - j.startedAt;
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  }
  const cmdOf = (j) => (Array.isArray(j?.command) ? j.command.join(' ') : j?.command || '');

  function copyLog() {
    navigator.clipboard?.writeText(log.map((l) => l.text).join('')).catch(() => {});
  }
</script>

{#if jobs.dockVisible}
  <section class="dock" class:open={jobs.dock} aria-label="Jobs">
    <button class="bar" onclick={() => (jobs.dock = !jobs.dock)} aria-expanded={jobs.dock}>
      <Icon name="terminal" size={14} />
      <b>Jobs</b>
      {#if running.length}
        <span class="run"><span class="spin"></span>{running.length} running</span>
      {/if}
      {#if latest}
        <span class="last ellipsis">
          <span class="st {latest.status}"></span>
          {latest.title || latest.actionId}
          <span class="faint">· {latest.status}</span>
        </span>
      {/if}
      <span class="spacer"></span>
      <span class="faint small hide-sm">{jobs.list.length} in history</span>
      <span class="chev" class:up={!jobs.dock}><Icon name="chevronDown" size={15} /></span>
    </button>

    {#if jobs.dock}
      <div class="body" transition:slide={{ duration: dur(200) }}>
        <ul class="jl">
          {#each jobs.list as j (j.id)}
            <li>
              <button class="ji" class:on={active?.id === j.id} onclick={() => openJob(j.id)}>
                <span class="st {j.status}">
                  {#if j.status === 'running' || j.status === 'queued'}<span class="spin"></span>{/if}
                </span>
                <span class="col grow" style="gap:0">
                  <span class="ellipsis jt">{j.title || j.actionId}</span>
                  <span class="faint ellipsis jm">{j.actionId} · {timeAgo(j.startedAt, app.now)}{j.endedAt ? ` · ${dura(j)}` : ''}</span>
                </span>
                {#if j.level && j.level !== 'read'}<span class="lv {LEVELS[j.level]?.tone}" title={LEVELS[j.level]?.label}></span>{/if}
              </button>
            </li>
          {:else}
            <li class="faint none">No jobs yet. Run an action from ⌘K or any “Run” button.</li>
          {/each}
        </ul>
        <div class="term">
          {#if active}
            <div class="th">
              <span class="st {active.status}"></span>
              <span class="mono ellipsis grow cmd" title={cmdOf(active)}>{cmdOf(active) || active.actionId}</span>
              <span class="faint tnum">{dura(active)}</span>
              {#if active.exitCode != null}<span class="badge {active.exitCode === 0 ? 'ok' : 'err'}">exit {active.exitCode}</span>{/if}
              <span class="seg">
                <button class:on={filter === 'all'} onclick={() => (filter = 'all')}>all</button>
                <button class:on={filter === 'stderr'} onclick={() => (filter = 'stderr')}>stderr</button>
              </span>
              <button class="tb" title="Copy log" onclick={copyLog}><Icon name="copy" size={13} /></button>
              {#if !isDone(active)}
                <button class="tb stop" title="Cancel job" onclick={() => cancelJob(active.id)}><Icon name="stop" size={12} /> Cancel</button>
              {/if}
            </div>
            <pre class="log mono" bind:this={logEl} {onscroll}>{#each shown as l, i (i)}<span class="ln {l.stream}"><span class="ts">{fmtTime(l.ts)}</span>{l.text.endsWith('\n') ? l.text : l.text + '\n'}</span>{:else}<span class="ts">{active.status === 'queued' ? 'Waiting in queue…' : isDone(active) ? 'No output.' : 'Starting…'}</span>{/each}{#if active.error}<span class="ln stderr"><span class="ts">error</span>{active.error}
</span>{/if}{#if isDone(active)}<span class="ln end {active.status}">── {active.status === 'ok' ? '✓ finished' : active.status === 'cancelled' ? '■ cancelled' : '✕ failed'} in {dura(active)} ──</span>{/if}</pre>
          {/if}
        </div>
      </div>
    {/if}
  </section>
{/if}

<style>
  .dock {
    position: fixed;
    z-index: 50;
    left: calc(var(--sidebar-w) + 12px);
    right: 12px;
    bottom: 10px;
    border-radius: 14px;
    background: color-mix(in srgb, var(--panel-solid) 94%, transparent);
    backdrop-filter: blur(20px) saturate(140%);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }
  .dock:not(.open) { left: auto; width: min(460px, calc(100vw - var(--sidebar-w) - 24px)); }
  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 38px;
    padding: 0 12px 0 14px;
    border: 0;
    background: transparent;
    cursor: pointer;
    font-size: 12.5px;
    color: var(--text-2);
    text-align: left;
  }
  .bar b { color: var(--text); font-weight: 650; }
  .run { display: inline-flex; align-items: center; gap: 6px; color: var(--accent); font-weight: 600; }
  .last { display: inline-flex; align-items: center; gap: 6px; max-width: 280px; }
  .chev { display: grid; transition: transform 0.2s var(--ease); color: var(--text-3); }
  .chev.up { transform: rotate(180deg); }
  .small { font-size: 11.5px; }
  .body { display: grid; grid-template-columns: 260px minmax(0, 1fr); height: min(320px, 42dvh); border-top: 1px solid var(--border); }
  .jl { list-style: none; margin: 0; padding: 6px; overflow: auto; border-right: 1px solid var(--border); }
  .none { padding: 14px; font-size: 12.5px; }
  .ji { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 8px; border: 0; border-radius: 8px; background: transparent; cursor: pointer; text-align: left; }
  .ji:hover { background: var(--panel-hover); }
  .ji.on { background: var(--panel-active); }
  .jt { font-size: 12.5px; font-weight: 550; color: var(--text); }
  .jm { font-size: 11px; }
  .lv { width: 6px; height: 6px; border-radius: 50%; background: var(--text-3); flex-shrink: 0; }
  .lv.warn { background: var(--warn); }
  .lv.err { background: var(--err); }
  .lv.accent { background: var(--accent); }
  .st { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; background: var(--text-3); position: relative; display: grid; place-items: center; }
  .st.ok { background: var(--ok); box-shadow: 0 0 0 3px var(--ok-soft); }
  .st.error { background: var(--err); box-shadow: 0 0 0 3px var(--err-soft); }
  .st.cancelled { background: var(--text-3); }
  .st.running, .st.queued { background: transparent; }
  .st .spin, .run .spin { width: 10px; height: 10px; }
  .spin { display: inline-block; width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--border-strong); border-top-color: var(--accent); animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .term { display: flex; flex-direction: column; min-width: 0; background: #06070b; }
  :global([data-theme='light']) .term { background: #0f1220; }
  .th { display: flex; align-items: center; gap: 9px; padding: 7px 10px 7px 14px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); color: #9aa2b5; font-size: 11.5px; }
  .cmd { color: #e6e9f2; font-size: 11.5px; }
  .seg { display: inline-flex; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 7px; overflow: hidden; }
  .seg button { border: 0; background: transparent; color: #8b93a7; font-size: 11px; padding: 3px 8px; cursor: pointer; }
  .seg button.on { background: rgba(255, 255, 255, 0.08); color: #e6e9f2; }
  .tb { display: inline-flex; align-items: center; gap: 5px; border: 1px solid rgba(255, 255, 255, 0.08); background: transparent; color: #b5bccb; border-radius: 7px; height: 24px; padding: 0 7px; cursor: pointer; font-size: 11.5px; }
  .tb:hover { background: rgba(255, 255, 255, 0.06); color: #fff; }
  .tb.stop { color: #fb7185; border-color: rgba(251, 113, 133, 0.3); }
  .log { flex: 1; margin: 0; padding: 10px 14px 14px; overflow: auto; font-size: 12px; line-height: 1.6; color: #d7dbe6; white-space: pre-wrap; word-break: break-word; }
  .ln { display: block; }
  .ln.stderr { color: #fda4af; }
  .ln.info { color: #93c5fd; }
  .ln.end { margin-top: 6px; color: #6b7386; }
  .ln.end.ok { color: #34d399; }
  .ln.end.error { color: #fb7185; }
  .ts { color: #4b5263; margin-right: 10px; user-select: none; font-size: 10.5px; }
  @media (max-width: 760px) {
    .dock, .dock:not(.open) { left: 8px; right: 8px; width: auto; bottom: calc(70px + env(safe-area-inset-bottom)); }
    .body { grid-template-columns: 1fr; grid-template-rows: 110px minmax(0, 1fr); height: 56dvh; }
    .jl { border-right: 0; border-bottom: 1px solid var(--border); }
    .hide-sm { display: none; }
    .last { max-width: 150px; }
  }
</style>
