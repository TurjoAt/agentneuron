<script>
  import { api } from '../lib/api.js';
  import { app, openFile } from '../lib/store.svelte.js';
  import { resource } from '../lib/resource.svelte.js';
  import { timeAgo, toMs, fmtNum, fmtDate, basename } from '../lib/format.js';
  import { toolOf } from '../lib/tools.js';
  import ToolBadge from '../lib/ToolBadge.svelte';
  import Tabs from '../lib/Tabs.svelte';
  import Icon from '../lib/Icon.svelte';
  import Empty from '../lib/Empty.svelte';

  let { params: _p } = $props();

  const sessions = resource(() => api('/api/sessions'));
  const config = resource(() => api('/api/config'), { live: false });
  let cfgTab = $state('mcp');
  let showAll = $state(false);

  const list = $derived(
    (Array.isArray(sessions.data) ? sessions.data : [])
      .map((s) => ({ ...s, last: toMs(s.lastAt), start: toMs(s.startedAt) }))
      .sort((a, b) => b.last - a.last)
  );
  const shown = $derived(showAll ? list : list.slice(0, 8));
  const tokTotal = (t = {}) => (t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0);
  const maxTok = $derived(Math.max(1, ...list.map((s) => tokTotal(s.tokens))));
  const totals = $derived(list.reduce((a, s) => {
    for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) a[k] += s.tokens?.[k] || 0;
    return a;
  }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }));
  const ACTIVE_MS = 10 * 60_000;
  const active = $derived(list.filter((s) => app.now - s.last < ACTIVE_MS));

  // who is touching what right now (from the live event ring)
  const touching = $derived.by(() => {
    const m = new Map();
    for (const e of app.events) {
      if (!e.agent || app.now - e.ts > 30 * 60_000) continue;
      const k = e.agent.sessionId;
      if (!m.has(k)) m.set(k, { agent: e.agent, files: new Map() });
      const f = m.get(k).files;
      if (!f.has(e.path)) f.set(e.path, e.ts);
    }
    return [...m.values()];
  });

  // radar blips: angle by session hash, radius by recency
  const blips = $derived(
    list.slice(0, 12).map((s) => {
      const h = [...s.sessionId].reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5381);
      const age = Math.min(1, (app.now - s.last) / (6 * 3600_000));
      const ang = ((h % 360) * Math.PI) / 180;
      const r = 16 + age * 70;
      return { s, x: 100 + Math.cos(ang) * r, y: 100 + Math.sin(ang) * r, live: app.now - s.last < ACTIVE_MS };
    })
  );
  const conflictPaths = $derived(new Set(app.conflicts.map((c) => c.path)));

  const cfg = $derived(config.data);
  const PERM = [['allow', 'ok'], ['ask', 'warn'], ['deny', 'err']];
</script>

<div class="page">
  <div class="page-h">
    <div>
      <h1>Agents</h1>
      <p>Sessions from Claude Code and Codex transcripts, live file attribution, conflicts and agent config.</p>
    </div>
  </div>

  <div class="top">
    <section class="card radar-card" class:alarm={app.conflicts.length}>
      <div class="card-h"><Icon name="radar" size={15} /> Conflict radar <span class="sub">{active.length} active · {app.conflicts.length} conflicts</span></div>
      <div class="radar-body">
        <svg class="radar" viewBox="0 0 200 200" role="img" aria-label="{active.length} active sessions, {app.conflicts.length} conflicts">
          <defs>
            <radialGradient id="rad-bg"><stop offset="0" stop-color="var(--accent)" stop-opacity="0.12" /><stop offset="1" stop-color="var(--accent)" stop-opacity="0" /></radialGradient>
            <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="var(--accent)" stop-opacity="0" /><stop offset="1" stop-color="var(--accent)" stop-opacity="0.45" /></linearGradient>
          </defs>
          <circle cx="100" cy="100" r="92" fill="url(#rad-bg)" />
          {#each [30, 58, 86] as r (r)}<circle cx="100" cy="100" {r} class="ring" />{/each}
          <line x1="100" y1="8" x2="100" y2="192" class="ring" /><line x1="8" y1="100" x2="192" y2="100" class="ring" />
          <g class="sweep"><path d="M100 100 L100 14 A86 86 0 0 1 174.5 57 Z" fill="url(#sweep)" /></g>
          {#each blips as b (b.s.sessionId)}
            <g class="blip" class:live={b.live} style="--c:var(--tool-{toolOf(b.s.tool)})">
              {#if b.live}<circle cx={b.x} cy={b.y} r="9" class="halo" />{/if}
              <circle cx={b.x} cy={b.y} r={b.live ? 4.5 : 3} class="core"><title>{b.s.title || b.s.sessionId} · {timeAgo(b.s.last, app.now)}</title></circle>
            </g>
          {/each}
          {#if app.conflicts.length}
            <circle cx="100" cy="100" r="10" class="conf" />
          {/if}
        </svg>
        <div class="rlist">
          {#each app.conflicts as c (c.path)}
            <div class="conflict">
              <Icon name="alert" size={15} />
              <div class="grow col" style="gap:3px">
                <button class="lnk mono" onclick={() => openFile(c.path, { drawer: true })}>{c.path}</button>
                <div class="row" style="flex-wrap:wrap;gap:6px">
                  {#each c.agents || [] as a, k (a.sessionId + k)}<ToolBadge tool={a.tool} /><span class="small muted ellipsis">{a.title || a.sessionId?.slice(0, 8)}</span>{/each}
                </div>
              </div>
              <span class="faint tiny">{timeAgo(toMs(c.lastTs), app.now)}</span>
            </div>
          {/each}
          {#if !app.conflicts.length}
            <div class="clear"><Icon name="shield" size={15} /> No agents are editing the same file.</div>
          {/if}
          <div class="eyebrow" style="margin-top:6px">Touching now · 30m</div>
          {#each touching as t (t.agent.sessionId)}
            <div class="touch">
              <ToolBadge tool={t.agent.tool} compact />
              <span class="small ellipsis tt">{t.agent.title || t.agent.sessionId?.slice(0, 8)}</span>
              <span class="tfiles">
                {#each [...t.files.keys()].slice(0, 3) as p (p)}
                  <button class="fchip mono" class:hot={conflictPaths.has(p)} onclick={() => openFile(p, { drawer: true })}>{basename(p)}</button>
                {/each}
                {#if t.files.size > 3}<span class="faint tiny">+{t.files.size - 3}</span>{/if}
              </span>
            </div>
          {:else}
            <div class="faint small">No attributed edits in the last 30 minutes.</div>
          {/each}
        </div>
      </div>
    </section>

    <section class="card usage">
      <div class="card-h">Token usage <span class="sub">{list.length} sessions</span></div>
      <div class="card-b col" style="gap:10px">
        {#each [['input', 'Input', 'var(--accent)'], ['output', 'Output', 'var(--tool-claude)'], ['cacheRead', 'Cache read', 'var(--tool-codex)'], ['cacheWrite', 'Cache write', 'var(--tool-windsurf)']] as [k, label, c] (k)}
          <div class="urow">
            <span class="ud" style="background:{c}"></span>
            <span class="grow small muted">{label}</span>
            <b class="tnum">{fmtNum(totals[k])}</b>
          </div>
        {/each}
        <div class="stack">
          {#each [['input', 'var(--accent)'], ['output', 'var(--tool-claude)'], ['cacheRead', 'var(--tool-codex)'], ['cacheWrite', 'var(--tool-windsurf)']] as [k, c] (k)}
            <span style="flex:{totals[k] || 0};background:{c}"></span>
          {/each}
        </div>
        <div class="faint tiny">Totals across transcripts found for this project.</div>
      </div>
    </section>
  </div>

  <section class="card sessions">
    <div class="card-h">Sessions <span class="sub">most recent first</span></div>
    {#if sessions.error}
      <Empty icon="alert" title="Could not load sessions">{sessions.error.message}</Empty>
    {:else if !sessions.data}
      <div class="card-b"><div class="skel" style="height:160px"></div></div>
    {:else if !list.length}
      <Empty icon="agents" title="No sessions found">No Claude Code or Codex transcripts reference this project yet.</Empty>
    {:else}
      <div class="slist">
        {#each shown as s (s.sessionId)}
          <article class="sess" class:live={app.now - s.last < ACTIVE_MS}>
            <div class="sh">
              <ToolBadge tool={s.tool} />
              <span class="st ellipsis">{s.title || 'Untitled session'}</span>
              {#if app.now - s.last < ACTIVE_MS}<span class="badge ok">active</span>{/if}
              <span class="spacer"></span>
              <span class="faint tiny" title="{fmtDate(s.start)} → {fmtDate(s.last)}">{timeAgo(s.last, app.now)}</span>
            </div>
            {#if s.lastPrompt}<div class="prompt">“{s.lastPrompt}”</div>{/if}
            <div class="sm-row">
              <span class="tiny faint mono">{s.sessionId.slice(0, 13)}</span>
              <span class="tiny muted"><b class="tnum">{fmtNum(s.messages)}</b> msgs</span>
              <span class="tiny muted"><b class="tnum">{fmtNum(tokTotal(s.tokens))}</b> tokens</span>
              <span class="tiny muted"><b class="tnum">{s.filesTouched?.length || 0}</b> files</span>
            </div>
            <div class="tokbar" style="width:{Math.max(4, (tokTotal(s.tokens) / maxTok) * 100)}%">
              {#each [['input', 'var(--accent)'], ['output', 'var(--tool-claude)'], ['cacheRead', 'var(--tool-codex)'], ['cacheWrite', 'var(--tool-windsurf)']] as [k, c] (k)}
                <span style="flex:{s.tokens?.[k] || 0};background:{c}" title="{k}: {fmtNum(s.tokens?.[k] || 0)}"></span>
              {/each}
            </div>
            {#if s.filesTouched?.length}
              <div class="files">
                {#each s.filesTouched.slice(0, 8) as p (p)}
                  <button class="fchip mono" class:hot={conflictPaths.has(p)} onclick={() => openFile(p, { drawer: true })}>{p}</button>
                {/each}
                {#if s.filesTouched.length > 8}<span class="faint tiny">+{s.filesTouched.length - 8} more</span>{/if}
              </div>
            {/if}
          </article>
        {/each}
      </div>
      {#if list.length > 8}
        <div class="card-b"><button class="btn sm" onclick={() => (showAll = !showAll)}>{showAll ? 'Show fewer' : `Show all ${list.length}`}</button></div>
      {/if}
    {/if}
  </section>

  <section class="card cfg">
    <div class="card-h">
      Agent configuration
      <span class="spacer"></span>
      <Tabs
        tabs={[
          { id: 'mcp', label: 'MCP servers', count: cfg?.mcpServers?.length ?? 0 },
          { id: 'hooks', label: 'Hooks', count: cfg?.hooks?.length ?? 0 },
          { id: 'perms', label: 'Permissions' },
          { id: 'files', label: 'Settings files', count: cfg?.settingsFiles?.length ?? 0 },
        ]}
        bind:active={cfgTab}
      />
    </div>
    <div class="card-b">
      {#if config.error}
        <Empty icon="alert" title="Could not load config">{config.error.message}</Empty>
      {:else if !cfg}
        <div class="skel" style="height:120px"></div>
      {:else if cfgTab === 'mcp'}
        {#if cfg.mcpServers?.length}
          <div class="tbl">
            {#each cfg.mcpServers as m (m.source + m.name)}
              <div class="tr">
                <span class="ic"><Icon name="server" size={14} /></span>
                <b class="nm">{m.name}</b>
                <span class="badge {m.type === 'stdio' ? '' : 'info'}">{m.type || 'stdio'}</span>
                <span class="mono grow ellipsis small muted" title={m.command || m.url}>{m.command || m.url || ''}</span>
                <button class="src mono" onclick={() => openFile(m.source, { drawer: true })}>{m.source}</button>
              </div>
            {/each}
          </div>
        {:else}<Empty icon="server" title="No MCP servers configured" />{/if}
      {:else if cfgTab === 'hooks'}
        {#if cfg.hooks?.length}
          <div class="tbl">
            {#each cfg.hooks as h, i (i)}
              <div class="tr">
                <span class="ic"><Icon name="hook" size={14} /></span>
                <span class="badge accent">{h.event}</span>
                {#if h.matcher}<span class="mono small muted">{h.matcher}</span>{/if}
                <code class="grow ellipsis cmd" title={h.command}>{h.command}</code>
                <button class="src mono" onclick={() => openFile(h.source, { drawer: true })}>{h.source}</button>
              </div>
            {/each}
          </div>
        {:else}<Empty icon="hook" title="No hooks configured" />{/if}
      {:else if cfgTab === 'perms'}
        <div class="perms">
          {#each PERM as [k, cls] (k)}
            <div class="pcol">
              <div class="eyebrow"><span class="pd {cls}"></span>{k} · {cfg.permissions?.[k]?.length || 0}</div>
              {#each cfg.permissions?.[k] || [] as r (r)}
                <code class="rule {cls}">{r}</code>
              {:else}
                <span class="faint small">None</span>
              {/each}
            </div>
          {/each}
        </div>
        {#if cfg.permissions?.source}<div class="faint tiny" style="margin-top:10px">from <span class="mono">{cfg.permissions.source}</span></div>{/if}
      {:else}
        <div class="col" style="gap:2px">
          {#each cfg.settingsFiles || [] as f (f)}
            <button class="list-row" onclick={() => openFile(f, { drawer: true })}><Icon name="file" size={14} /><span class="mono small">{f}</span></button>
          {:else}
            <span class="faint small">No settings files found.</span>
          {/each}
        </div>
      {/if}
    </div>
  </section>
</div>

<style>
  .top { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 16px; margin-bottom: 16px; }
  .radar-card.alarm { border-color: color-mix(in srgb, var(--err) 45%, transparent); }
  .radar-body { display: flex; gap: 18px; padding: 0 16px 16px; align-items: flex-start; flex-wrap: wrap; }
  .radar { width: 200px; height: 200px; flex-shrink: 0; }
  .ring { fill: none; stroke: var(--border-strong); stroke-width: 0.8; }
  .sweep { transform-origin: 100px 100px; animation: sweep 4s linear infinite; }
  @keyframes sweep { to { transform: rotate(360deg); } }
  .blip .core { fill: var(--c); }
  .blip.live .core { filter: drop-shadow(0 0 4px var(--c)); }
  .halo { fill: none; stroke: var(--c); stroke-width: 1.2; transform-box: fill-box; transform-origin: center; animation: halo 1.8s ease-out infinite; }
  @keyframes halo { from { transform: scale(0.4); opacity: 1; } to { transform: scale(1.6); opacity: 0; } }
  .conf { fill: var(--err); opacity: 0.3; transform-box: fill-box; transform-origin: center; animation: halo 1.2s ease-out infinite; }
  .rlist { flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 8px; }
  .conflict { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 10px; background: var(--err-soft); color: var(--err); animation: slide-in 0.4s var(--ease); }
  .clear { display: flex; gap: 8px; align-items: center; padding: 10px 12px; border-radius: 10px; background: var(--ok-soft); color: var(--ok); font-size: 13px; }
  .lnk { border: 0; background: none; padding: 0; color: var(--text); font-weight: 600; cursor: pointer; text-align: left; font-size: 12.5px; }
  .lnk:hover { color: var(--accent); }
  .touch { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .tt { max-width: 180px; }
  .tfiles { display: flex; gap: 4px; flex-wrap: wrap; margin-left: auto; }
  .small { font-size: 12.5px; }
  .tiny { font-size: 11px; }
  .urow { display: flex; align-items: center; gap: 10px; }
  .ud { width: 9px; height: 9px; border-radius: 3px; }
  .stack { display: flex; height: 10px; border-radius: 99px; overflow: hidden; gap: 2px; background: var(--panel-active); }
  .stack span { min-width: 2px; transition: flex 0.6s var(--ease); }
  .sessions { margin-bottom: 16px; }
  .slist { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; padding: 0 16px 16px; }
  .sess { border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; background: var(--panel-hover); min-width: 0; transition: border-color 0.2s; }
  .sess.live { border-color: color-mix(in srgb, var(--ok) 35%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--ok) 12%, transparent), 0 8px 30px -18px var(--ok); }
  .sh { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .st { font-weight: 600; }
  .sh .tiny { white-space: nowrap; }
  .prompt { font-size: 12.5px; color: var(--text-2); font-style: italic; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
  .sm-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
  .sm-row b { color: var(--text); }
  .tokbar { display: flex; height: 5px; border-radius: 99px; overflow: hidden; gap: 1px; transition: width 0.6s var(--ease); }
  .tokbar span { min-width: 1px; }
  .files { display: flex; gap: 5px; flex-wrap: wrap; }
  .fchip { border: 1px solid var(--border); background: var(--panel-hover); border-radius: 7px; padding: 2px 7px; font-size: 11px; color: var(--text-2); cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fchip:hover { color: var(--text); border-color: var(--border-strong); }
  .fchip.hot { color: var(--err); border-color: color-mix(in srgb, var(--err) 50%, transparent); background: var(--err-soft); }
  .cfg .card-h { flex-wrap: wrap; }
  .tbl { display: flex; flex-direction: column; }
  .tr { display: flex; align-items: center; gap: 10px; padding: 10px 4px; border-bottom: 1px solid var(--border); min-width: 0; flex-wrap: wrap; }
  .tr:last-child { border-bottom: 0; }
  .ic { color: var(--text-3); display: grid; }
  .nm { min-width: 90px; }
  .cmd { font-family: var(--mono); font-size: 12px; background: var(--inset); border: 1px solid var(--border); padding: 3px 8px; border-radius: 6px; }
  .src { border: 0; background: none; color: var(--text-3); font-size: 11.5px; cursor: pointer; padding: 0; }
  .src:hover { color: var(--accent); }
  .perms { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
  .pcol { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; min-width: 0; }
  .pcol .eyebrow { display: flex; align-items: center; gap: 6px; }
  .pd { width: 8px; height: 8px; border-radius: 50%; }
  .pd.ok { background: var(--ok); }
  .pd.warn { background: var(--warn); }
  .pd.err { background: var(--err); }
  .rule { font-family: var(--mono); font-size: 12px; padding: 4px 9px; border-radius: 7px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .rule.ok { background: var(--ok-soft); color: var(--ok); }
  .rule.warn { background: var(--warn-soft); color: var(--warn); }
  .rule.err { background: var(--err-soft); color: var(--err); }
  @media (max-width: 1000px) {
    .top { grid-template-columns: 1fr; }
  }
  @media (max-width: 640px) {
    .perms { grid-template-columns: 1fr; }
    .slist { grid-template-columns: 1fr; padding: 0 10px 10px; }
    .radar-body { justify-content: center; }
  }
</style>
