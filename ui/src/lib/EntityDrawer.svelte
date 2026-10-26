<script>
  // Entity side panel: details for any session, file, commit, task, tool, model or agent, from /api/usage/entity.
  // Related items are EntityLinks, so clicking one navigates inside the panel (with a back stack).
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { tick } from 'svelte';
  import { api } from './api.js';
  import { app } from './store.svelte.js';
  import { entity, closeEntity, backEntity, entityHref, entityLabel, ENTITY_META } from './entity.svelte.js';
  import { fmtStat } from './statfmt.js';
  import { timeAgo, fmtDate, toMs } from './format.js';
  import { dur } from './motion.js';
  import Icon from './Icon.svelte';
  import EntityLink from './EntityLink.svelte';
  import ToolBadge from './ToolBadge.svelte';

  const TONE = { session: 'accent', file: 'info', commit: 'warn', task: 'ok', tool: 'accent-2', model: 'info', agent: 'accent' };
  const cache = new Map(); // `${kind}:${id}` → payload (kept for this page load; back navigation is instant)

  let data = $state.raw(null);
  let error = $state(null);
  let panel = $state();
  let bodyEl = $state();
  let restoreTo = null;

  const cur = $derived(entity.current);
  const meta = $derived(cur ? ENTITY_META[cur.kind] || { icon: 'info', label: cur.kind } : null);

  $effect(() => {
    const c = entity.current;
    error = null;
    if (!c) {
      data = null;
      return;
    }
    const key = `${c.kind}:${c.id}`;
    data = cache.get(key) || null;
    if (data) return;
    api('/api/usage/entity', { kind: c.kind, id: c.id })
      .then((d) => {
        cache.set(key, d);
        if (entity.current === c) data = d;
      })
      .catch((e) => {
        if (entity.current === c) error = e;
      });
  });

  // focus management: remember the opener, focus the panel, restore on close
  let wasOpen = false;
  $effect(() => {
    const open = !!entity.current;
    if (open && !wasOpen) {
      restoreTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      tick().then(() => panel?.focus());
    } else if (!open && wasOpen) {
      const el = restoreTo;
      restoreTo = null;
      if (el?.isConnected) el.focus();
    }
    wasOpen = open;
  });
  // new entity inside the panel → scroll to top
  $effect(() => {
    void entity.current;
    bodyEl?.scrollTo?.({ top: 0 });
  });

  function onkeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeEntity();
      return;
    }
    if ((e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft')) && entity.history.length && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) {
      e.preventDefault();
      e.stopPropagation();
      backEntity();
      return;
    }
    if (e.key !== 'Tab' || !panel) return;
    const f = [...panel.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const title = $derived(data?.title || cur?.label || (cur ? entityLabel(cur.kind, cur.id) : ''));
  const rel = $derived(data?.related || {});
  const nRel = $derived(['sessions', 'files', 'commits', 'tasks', 'tools'].reduce((a, k) => a + (rel[k]?.length || 0), 0));
  const maxCalls = $derived(Math.max(1, ...(rel.tools || []).map((t) => t.calls || 0)));
  const prev = $derived(entity.history[entity.history.length - 1]);
  const notFound = $derived(error && (error.status === 404 || error.status === 400));
  const STATUS_TONE = { done: 'ok', review: 'info', doing: 'accent', 'in-progress': 'accent', todo: '', backlog: '' };
</script>

{#if cur}
  <div class="scrim" transition:fade={{ duration: dur(160) }} onclick={closeEntity} aria-hidden="true"></div>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <aside
    class="edrawer"
    bind:this={panel}
    tabindex="-1"
    role="dialog"
    aria-modal="true"
    aria-labelledby="edrawer-title"
    {onkeydown}
    transition:fly={{ x: 40, duration: dur(260), easing: cubicOut, opacity: 0 }}
  >
    <header class="eh tone-{TONE[cur.kind] || 'accent'}">
      <div class="bar">
        {#if entity.history.length}
          <button class="btn ghost sm back" onclick={backEntity} title="Back to {prev ? prev.label || entityLabel(prev.kind, prev.id) : 'previous'} (Backspace)">
            <Icon name="arrowLeft" size={14} /><span class="ellipsis">{prev ? prev.label || entityLabel(prev.kind, prev.id) : 'Back'}</span>
          </button>
        {:else}
          <span class="eyebrow kindl">{meta.label}</span>
        {/if}
        <span class="spacer"></span>
        <a class="btn ghost sm icon" href={entityHref(cur.kind, cur.id)} onclick={closeEntity} title="Open full page" aria-label="Open full page"><Icon name="maximize" size={14} /></a>
        <button class="btn ghost sm icon" onclick={closeEntity} aria-label="Close details (Esc)" title="Close (Esc)"><Icon name="x" size={15} /></button>
      </div>
      <div class="id">
        <span class="kico"><Icon name={meta.icon} size={18} /></span>
        <div class="col tt">
          <h2 id="edrawer-title" class:mono={cur.kind === 'file' || cur.kind === 'commit' || cur.kind === 'tool'}>{title || '—'}</h2>
          <span class="subt ellipsis">
            {#if cur.kind === 'agent'}<ToolBadge tool={cur.id} compact />{/if}
            {data?.subtitle || (cur.kind === 'file' ? cur.id : meta.label)}
          </span>
        </div>
      </div>
    </header>

    <div class="eb" bind:this={bodyEl}>
      {#if error}
        <div class="state">
          <Icon name={notFound ? 'search' : 'alert'} size={18} />
          <div class="col" style="gap:4px">
            <b>{notFound ? `No usage data for this ${meta.label.toLowerCase()}` : 'Could not load details'}</b>
            <span class="muted">{notFound ? 'It may be outside the analysed range, or not touched by an agent yet.' : error.message}</span>
          </div>
        </div>
      {:else if !data}
        <div class="tiles" aria-hidden="true">{#each [0, 1, 2, 3] as i (i)}<div class="tile"><span class="skel" style="width:50%;height:10px"></span><span class="skel" style="width:70%;height:18px"></span></div>{/each}</div>
        <div class="skel-rows" aria-hidden="true">{#each [0, 1, 2, 3, 4] as i (i)}<span class="skel"></span>{/each}</div>
        <span class="sr-only" role="status">Loading details</span>
      {:else}
        {#if data.stats?.length}
          <div class="tiles">
            {#each data.stats as s (s.label)}
              <div class="tile">
                <span class="tl">{s.label}</span>
                <span class="tv tnum">{fmtStat(s.value, s.unit, app.now)}</span>
              </div>
            {/each}
          </div>
        {/if}

        {#if rel.sessions?.length}
          <section>
            <h3><Icon name="message" size={13} /> Sessions <span class="n">{rel.sessions.length}</span></h3>
            <ul class="rl">
              {#each rel.sessions.slice(0, 12) as s (s.sessionId)}
                <li><EntityLink kind="session" id={s.sessionId} label={s.title || entityLabel('session', s.sessionId)} class="grow ellipsis" /><span class="meta" title={s.ts ? fmtDate(toMs(s.ts)) : ''}>{s.ts ? timeAgo(toMs(s.ts), app.now) : ''}</span></li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if rel.files?.length}
          <section>
            <h3><Icon name="file" size={13} /> Files <span class="n">{rel.files.length}</span></h3>
            <ul class="rl">
              {#each rel.files.slice(0, 12) as f (f.path)}
                <li><EntityLink kind="file" id={f.path} label={f.path} mono class="grow ellipsis" />{#if f.edits != null}<span class="meta tnum">{f.edits} edit{f.edits === 1 ? '' : 's'}</span>{/if}</li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if rel.commits?.length}
          <section>
            <h3><Icon name="commit" size={13} /> Commits <span class="n">{rel.commits.length}</span></h3>
            <ul class="rl">
              {#each rel.commits.slice(0, 10) as c (c.hash)}
                <li>
                  <EntityLink kind="commit" id={c.hash} label={c.subject || c.hash} class="grow ellipsis" />
                  <span class="meta mono">{String(c.hash).slice(0, 7)}</span>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if rel.tasks?.length}
          <section>
            <h3><Icon name="checkSquare" size={13} /> Tasks <span class="n">{rel.tasks.length}</span></h3>
            <ul class="rl">
              {#each rel.tasks.slice(0, 10) as t (t.id)}
                <li><EntityLink kind="task" id={t.id} label={t.title || t.id} class="grow ellipsis" />{#if t.status}<span class="badge {STATUS_TONE[t.status] ?? ''}">{t.status}</span>{/if}</li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if rel.tools?.length}
          <section>
            <h3><Icon name="terminal" size={13} /> Tools <span class="n">{rel.tools.length}</span></h3>
            <ul class="rl tools">
              {#each rel.tools.slice(0, 10) as t (t.name)}
                <li>
                  <EntityLink kind="tool" id={t.name} label={t.name} mono class="tname ellipsis" />
                  <span class="tb" aria-hidden="true"><span style="width:{Math.max(4, ((t.calls || 0) / maxCalls) * 100)}%"></span></span>
                  <span class="meta tnum">{t.calls ?? '—'} calls</span>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if !nRel && !data.stats?.length}
          <div class="state"><Icon name="info" size={18} /><span class="muted">No related activity recorded yet.</span></div>
        {/if}
      {/if}
    </div>

    <footer class="ef">
      {#each data?.links || [] as l (l.href)}
        <a class="btn sm" href={l.href} onclick={closeEntity}>{l.label}<Icon name="arrowRight" size={12} /></a>
      {/each}
      {#if !data?.links?.length}
        <a class="btn sm primary" href={entityHref(cur.kind, cur.id)} onclick={closeEntity}>Open {meta.label.toLowerCase()}<Icon name="arrowRight" size={12} /></a>
      {/if}
    </footer>
  </aside>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 64; background: rgba(5, 6, 10, 0.28); }
  :global([data-theme='light']) .scrim { background: rgba(20, 24, 50, 0.12); }
  .edrawer {
    position: fixed;
    z-index: 65;
    top: 10px;
    right: 10px;
    bottom: 10px;
    width: min(440px, calc(100vw - 20px));
    display: flex;
    flex-direction: column;
    background: var(--panel-solid);
    border: 1px solid var(--border);
    border-radius: 18px;
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    outline: none;
  }
  .eh {
    --tone: var(--accent);
    padding: 10px 12px 14px 16px;
    border-bottom: 1px solid var(--border);
    background: linear-gradient(180deg, color-mix(in srgb, var(--tone) 9%, transparent), transparent);
  }
  .tone-info { --tone: var(--info); }
  .tone-warn { --tone: var(--warn); }
  .tone-ok { --tone: var(--ok); }
  .tone-accent-2 { --tone: var(--accent-2); }
  .bar { display: flex; align-items: center; gap: 4px; min-height: 28px; }
  .kindl { color: var(--tone); }
  .back { max-width: 70%; gap: 6px; margin-left: -6px; }
  .id { display: flex; gap: 12px; align-items: flex-start; margin-top: 6px; }
  .kico {
    width: 38px;
    height: 38px;
    border-radius: 11px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    color: var(--tone);
    background: color-mix(in srgb, var(--tone) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--tone) 25%, transparent);
  }
  .tt { gap: 2px; min-width: 0; }
  h2 { margin: 0; font-size: 16px; font-weight: 650; letter-spacing: -0.01em; line-height: 1.3; overflow-wrap: anywhere; }
  h2.mono { font-size: 14.5px; }
  .subt { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-3); }

  .eb { flex: 1; overflow: auto; padding: 14px 16px 18px; display: flex; flex-direction: column; gap: 18px; overscroll-behavior: contain; }
  .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .tile { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 11px; background: var(--inset); border: 1px solid var(--border); min-width: 0; }
  .tl { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-3); }
  .tv { font-size: 18px; font-weight: 650; letter-spacing: -0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  section { display: flex; flex-direction: column; gap: 6px; }
  h3 { margin: 0; display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 650; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-3); }
  h3 .n { margin-left: auto; font-weight: 600; letter-spacing: 0; }
  .rl { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .rl li { display: flex; align-items: center; gap: 10px; min-height: 32px; padding: 4px 8px; margin: 0 -8px; border-radius: 8px; font-size: 13px; min-width: 0; }
  .rl li:hover { background: var(--panel-hover); }
  .rl :global(.grow) { flex: 1; min-width: 0; }
  .rl :global(.ellipsis) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { font-size: 11.5px; color: var(--text-3); flex-shrink: 0; }
  .tools :global(.tname) { width: 42%; flex-shrink: 0; }
  .tb { flex: 1; height: 6px; border-radius: 6px; background: var(--panel-active); overflow: hidden; }
  .tb span { display: block; height: 100%; border-radius: 6px; background: color-mix(in srgb, var(--accent) 70%, transparent); }
  .state { display: flex; gap: 12px; align-items: flex-start; padding: 14px; border-radius: 12px; border: 1px dashed var(--border-strong); color: var(--text-2); font-size: 13px; }
  .ef {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 10px 16px calc(12px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--border);
  }
  .ef .btn { gap: 6px; text-decoration: none; }

  @media (max-width: 640px) {
    .edrawer { top: auto; left: 0; right: 0; bottom: 0; width: 100%; height: min(88dvh, 100%); border-radius: 18px 18px 0 0; border-bottom: 0; }
    .eh::before { content: ''; display: block; width: 36px; height: 4px; border-radius: 4px; background: var(--border-strong); margin: 0 auto 6px; }
  }
</style>
