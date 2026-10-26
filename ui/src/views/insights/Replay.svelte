<script>
  import { api } from '../../lib/api.js';
  import { app, navigate, openFile } from '../../lib/store.svelte.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { fmtDate, fmtTime, fmtNum, timeAgo } from '../../lib/format.js';
  import ToolBadge from '../../lib/ToolBadge.svelte';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';

  // picker=false embeds only the "why" panel (used inside the session replay).
  // onpick overrides where a picked change goes (default: Sessions › Why did it change?).
  let { path = '', ts = '', session = '', picker = true, onpick = null } = $props();
  const ICON = { prompt: 'message', edit: 'edit', action: 'terminal', change: 'target', 'context-version': 'context' };
  const recent = resource(() => api('/api/insights/replay'), { live: false, enabled: () => picker });
  const picked = $derived(!!(path || session));
  const rep = resource(() => api('/api/insights/replay', { path: path || undefined, session: session || undefined, ts: ts || undefined }), { key: () => [path, ts, session], enabled: () => picked, live: false });
  const changes = $derived(recent.data?.changes || []);
  const r = $derived(rep.data);
  let showText = $state(false);
  const pick = (c) => (onpick ? onpick(c) : navigate('sessions', { view: 'changes', path: c.path, ts: c.ts, session: c.agent?.sessionId }));
</script>

<div class="cols" class:solo={!picker}>
  {#if picker}
  <section class="card pickc">
    <div class="card-h">Recent agent changes</div>
    {#if recent.error}<div class="card-b faint small">{recent.error.message}</div>
    {:else if !recent.data}<div class="card-b"><div class="skel" style="height:200px"></div></div>
    {:else if !changes.length}<Empty icon="history" title="No agent changes yet" compact>Changes attributed to Claude Code or Codex sessions show up here.</Empty>
    {:else}
      <div class="plist">
        {#each changes as c (c.path + c.ts)}
          <button class="pitem" class:on={c.path === path && String(c.ts) === String(ts)} onclick={() => pick(c)}>
            <ToolBadge tool={c.agent?.tool} />
            <span class="grow"><span class="mono ellipsis pth">{c.path}</span><span class="faint tiny ellipsis">{c.agent?.title || c.agent?.sessionId}</span></span>
            <span class="faint tiny">{timeAgo(c.ts, app.now)}</span>
          </button>
        {/each}
      </div>
    {/if}
  </section>
  {/if}

  <section class="card main">
    {#if !picked}
      <Empty icon="timeline" title="Why did the agent do that?">Pick a change to see which context files (and which versions) the agent had, and the prompts that led to it.</Empty>
    {:else if rep.error}
      <Empty icon="alert" title="Could not replay">{rep.error.message}</Empty>
    {:else if !r}
      <div class="card-b"><div class="skel" style="height:300px"></div></div>
    {:else}
      <div class="card-h">
        {#if r.path}<button class="btn ghost sm mono" onclick={() => openFile(r.path, { drawer: true })}>{r.path}</button>{/if}
        <span class="sub">{fmtDate(r.ts)}</span><span class="spacer"></span>
        {#if r.session}<ToolBadge tool={r.session.tool} /><span class="small ellipsis st">{r.session.title || r.session.sessionId}</span>{/if}
      </div>
      <div class="card-b">
        <div class="eyebrow">Context the agent had <span class="faint">({r.context.tool}, {fmtNum(r.context.tokens)} tokens)</span></div>
        {#if !r.context.chain.length}<div class="faint small">No context files applied to this path at that time.</div>{/if}
        <div class="chain">
          {#each r.context.chain as c (c.path)}
            <div class="link">
              <button class="btn ghost sm mono" onclick={() => openFile(c.path, { drawer: true })}>{c.path}</button>
              <span class="badge">{c.reason}</span>
              {#if c.version?.source === 'history'}<span class="badge info">version {fmtDate(c.version.ts)}</span>
              {:else if c.version?.source === 'git'}<span class="badge info">commit {c.version.commit}</span>
              {:else}<span class="badge" title="no older version recorded">current</span>{/if}
              {#if c.changedSince}<span class="badge warn" title="This file changed after the agent's action"><Icon name="alert" size={11} /> changed since</span>{/if}
              <span class="faint tiny tnum">{fmtNum(c.tokens)} tok</span>
            </div>
          {/each}
        </div>
        {#if r.context.text}
          <button class="btn sm" onclick={() => (showText = !showText)}>{showText ? 'Hide' : 'Show'} merged context</button>
          {#if showText}<pre class="ctx">{r.context.text}</pre>{/if}
        {/if}
        <div class="eyebrow tl-h">Timeline</div>
        {#if !r.timeline.length}<div class="faint small">No session transcript found for this change.</div>{/if}
        <ol class="tl">
          {#each r.timeline as e, i (i)}
            <li class="ev {e.kind}">
              <span class="ic"><Icon name={ICON[e.kind] || 'dot'} size={11} /></span>
              <div class="eb">
                <span class="faint tiny tnum">{fmtTime(e.ts)}</span>
                {#if e.tool}<span class="badge">{e.tool}</span>{/if}
                <div class="et">{e.text}</div>
              </div>
            </li>
          {/each}
        </ol>
      </div>
    {/if}
  </section>
</div>

<style>
  .cols { display: grid; grid-template-columns: minmax(240px, 320px) 1fr; gap: 14px; align-items: start; }
  .cols.solo { grid-template-columns: minmax(0, 1fr); }
  @media (max-width: 860px) { .cols { grid-template-columns: 1fr; } }
  .main { min-width: 0; }
  .plist { display: flex; flex-direction: column; max-height: 620px; overflow: auto; padding: 0 8px 8px; }
  .pitem { all: unset; box-sizing: border-box; display: flex; gap: 8px; align-items: center; padding: 7px 8px; border-radius: 8px; cursor: pointer; min-width: 0; }
  .pitem:hover, .pitem.on { background: var(--panel-hover); }
  .pitem.on { outline: 1px solid var(--accent); }
  .grow { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .pth { font-size: 12px; }
  .st { max-width: 280px; }
  .chain { display: flex; flex-direction: column; gap: 6px; margin: 8px 0 12px; }
  .link { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .ctx { max-height: 360px; overflow: auto; font-size: 12px; background: var(--panel-hover); border: 1px solid var(--border); border-radius: 8px; padding: 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .tl-h { margin-top: 16px; }
  .tl { list-style: none; margin: 8px 0 0; padding: 0; border-left: 1px solid var(--border); }
  .ev { display: flex; gap: 10px; padding: 5px 0 5px 0; margin-left: -9px; min-width: 0; }
  .ic { width: 18px; height: 18px; flex: none; border-radius: 50%; display: grid; place-items: center; background: var(--panel-solid); border: 1px solid var(--border); color: var(--text-3); }
  .ev.prompt .ic { color: var(--accent); }
  .ev.change .ic { color: var(--warn); border-color: var(--warn); }
  .ev.context-version .ic { color: var(--info); }
  .eb { min-width: 0; flex: 1; }
  .et { font-size: 12.5px; overflow-wrap: anywhere; color: var(--text-2); }
  .ev.prompt .et { color: var(--text); }
  .small { font-size: 12.5px; }
  .tiny { font-size: 11px; }
</style>
