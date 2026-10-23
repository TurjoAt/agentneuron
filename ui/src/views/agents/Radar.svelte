<script>
  import { app, openFile } from '../../lib/store.svelte.js';
  import { timeAgo, toMs, basename, fmtNum } from '../../lib/format.js';
  import { toolOf } from '../../lib/tools.js';
  import ToolBadge from '../../lib/ToolBadge.svelte';
  import Icon from '../../lib/Icon.svelte';

  let { list = [], loading = false } = $props();
  const ACTIVE_MS = 10 * 60_000;
  const active = $derived(list.filter((s) => app.now - s.last < ACTIVE_MS));
  const conflictPaths = $derived(new Set(app.conflicts.map((c) => c.path)));
  const tokTotal = (t = {}) => (t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0);
  const totals = $derived(
    list.reduce((a, s) => {
      for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) a[k] += s.tokens?.[k] || 0;
      return a;
    }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  );
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
  const blips = $derived(
    list.slice(0, 12).map((s) => {
      const h = [...s.sessionId].reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5381);
      const age = Math.min(1, (app.now - s.last) / (6 * 3600_000));
      const ang = ((h % 360) * Math.PI) / 180;
      const r = 16 + age * 70;
      return { s, x: 100 + Math.cos(ang) * r, y: 100 + Math.sin(ang) * r, live: app.now - s.last < ACTIVE_MS };
    })
  );
  const USAGE = [['input', 'Input', 'var(--accent)'], ['output', 'Output', 'var(--tool-claude)'], ['cacheRead', 'Cache read', 'var(--tool-codex)'], ['cacheWrite', 'Cache write', 'var(--tool-windsurf)']];
</script>

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
        {#if app.conflicts.length}<circle cx="100" cy="100" r="10" class="conf" />{/if}
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

  <section class="card">
    <div class="card-h">Token usage <span class="sub">{list.length} sessions</span></div>
    <div class="card-b col" style="gap:10px">
      {#each USAGE as [k, label, c] (k)}
        <div class="urow"><span class="ud" style="background:{c}"></span><span class="grow small muted">{label}</span><b class="tnum">{fmtNum(totals[k])}</b></div>
      {/each}
      <div class="stk">{#each USAGE as [k, , c] (k)}<span style="flex:{totals[k] || 0};background:{c}"></span>{/each}</div>
      <div class="faint tiny">Totals across transcripts found for this project.</div>
    </div>
  </section>
</div>

<style>
  .top { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 16px; }
  .radar-card.alarm { border-color: color-mix(in srgb, var(--err) 45%, transparent); }
  .radar-body { display: flex; gap: 18px; padding: 0 16px 16px; align-items: flex-start; flex-wrap: wrap; }
  .radar { width: 200px; height: 200px; flex-shrink: 0; }
  .ring { fill: none; stroke: var(--border-strong); stroke-width: 0.8; }
  .sweep { transform-origin: 100px 100px; animation: sweep 4s linear infinite; }
  @keyframes sweep { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .sweep, .halo, .conf { animation: none; } }
  .blip .core { fill: var(--c); }
  .blip.live .core { filter: drop-shadow(0 0 4px var(--c)); }
  .halo { fill: none; stroke: var(--c); stroke-width: 1.2; transform-box: fill-box; transform-origin: center; animation: halo 1.8s ease-out infinite; }
  @keyframes halo { from { transform: scale(0.4); opacity: 1; } to { transform: scale(1.6); opacity: 0; } }
  .conf { fill: var(--err); opacity: 0.3; transform-box: fill-box; transform-origin: center; animation: halo 1.2s ease-out infinite; }
  .rlist { flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 8px; }
  .conflict { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 10px; background: var(--err-soft); color: var(--err); }
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
  .stk { display: flex; height: 10px; border-radius: 99px; overflow: hidden; gap: 2px; background: var(--panel-active); }
  .stk span { min-width: 2px; transition: flex 0.6s var(--ease); }
  .fchip { border: 1px solid var(--border); background: var(--panel-hover); border-radius: 7px; padding: 2px 7px; font-size: 11px; color: var(--text-2); cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fchip:hover { color: var(--text); border-color: var(--border-strong); }
  .fchip.hot { color: var(--err); border-color: color-mix(in srgb, var(--err) 50%, transparent); background: var(--err-soft); }
  @media (max-width: 1000px) { .top { grid-template-columns: 1fr; } }
  @media (max-width: 640px) { .radar-body { justify-content: center; } }
</style>
