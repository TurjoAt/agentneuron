<script>
  // Session replay: header stats, time ruler, filterable timeline (j/k, &at= deep link),
  // subagent tree, files changed with before/after diffs and "why did it change?".
  import { untrack, tick } from 'svelte';
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { app, navigate, toast } from '../../lib/store.svelte.js';
  import { href } from '../../lib/nav.js';
  import { fmtNum, fmtDate, fmtTime, timeAgo, basename } from '../../lib/format.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';
  import ToolBadge from '../../lib/ToolBadge.svelte';
  import Gantt from '../../lib/viz/Gantt.svelte';
  import Skeleton from '../../lib/viz/Skeleton.svelte';
  import FileDiff from './FileDiff.svelte';
  import WhyReplay from '../insights/Replay.svelte';
  import { money, fmtMs, tokTotal, modelLabel, sessionLabel, shortId, copyText } from '../usage/shared.js';

  let { id, params = {} } = $props();
  const res = resource(() => api('/api/usage/session', { id }), { key: () => id });
  const d = $derived(res.data);
  const s = $derived(d?.session || null);
  // row ids may be missing or shared (tool + result); make them unique, keep the raw id for &at=
  const timeline = $derived(Array.isArray(d?.timeline) ? d.timeline.map((r, i) => ({ ...r, rawId: r.id, id: r.id != null ? `${r.id}:${r.kind}:${i}` : `row${i}` })).sort((a, b) => (a.ts || 0) - (b.ts || 0)) : []);
  const agents = $derived(Array.isArray(d?.agents) ? d.agents : []);
  const files = $derived(Array.isArray(d?.files) ? d.files : []);

  // ---- kinds + filters
  const K = {
    prompt: { icon: 'message', label: 'Prompt', c: 'accent' },
    thinking: { icon: 'sparkles', label: 'Thinking', c: 'muted' },
    text: { icon: 'bookmark', label: 'Reply', c: 'muted' },
    tool: { icon: 'terminal', label: 'Tool call', c: 'info' },
    result: { icon: 'check', label: 'Result', c: 'muted' },
    edit: { icon: 'edit', label: 'Edit', c: 'ok' },
    subagent: { icon: 'users', label: 'Subagent', c: 'info' },
    compact: { icon: 'layers', label: 'Compaction', c: 'warn' },
    hook: { icon: 'hook', label: 'Hook', c: 'muted' },
    interrupt: { icon: 'stop', label: 'Interrupt', c: 'warn' },
    denied: { icon: 'lock', label: 'Denied', c: 'err' },
    error: { icon: 'alert', label: 'Error', c: 'err' },
  };
  const GROUPS = [
    ['prompt', 'Prompts', ['prompt']], ['thinking', 'Thinking', ['thinking']], ['text', 'Replies', ['text']], ['tool', 'Tools', ['tool', 'result']],
    ['edit', 'Edits', ['edit']], ['subagent', 'Subagents', ['subagent']], ['marker', 'Markers', ['compact', 'hook', 'interrupt', 'denied', 'error']],
  ];
  const isErr = (r) => r.kind === 'error' || r.kind === 'denied' || (r.kind === 'result' && r.isError);
  let off = $state(new Set());
  let errorsOnly = $state(false);
  const groupOf = (kind) => GROUPS.find((g) => g[2].includes(kind))?.[0] || 'marker';
  const counts = $derived(Object.fromEntries(GROUPS.map(([g, , kinds]) => [g, timeline.filter((r) => kinds.includes(r.kind)).length])));
  const errCount = $derived(timeline.filter(isErr).length);
  // errors-only keeps each failing result plus the tool call that produced it
  const errIds = $derived.by(() => {
    const ids = new Set();
    timeline.forEach((r, i) => {
      if (!isErr(r)) return;
      ids.add(r.id);
      if (r.kind === 'result') for (let j = i - 1; j >= 0 && j > i - 6; j--) if (timeline[j].kind === 'tool' && (!r.tool || timeline[j].tool === r.tool)) { ids.add(timeline[j].id); break; }
    });
    return ids;
  });
  const rows = $derived(timeline.filter((r) => (errorsOnly ? errIds.has(r.id) : !off.has(groupOf(r.kind)))));
  const toggle = (g) => { const n = new Set(off); n.has(g) ? n.delete(g) : n.add(g); off = n; };

  // ---- selection, deep link (&at=), keyboard
  let sel = $state(null);
  let limit = $state(250);
  let inited = false;
  const t0 = $derived(s?.startedAt ?? timeline[0]?.ts ?? 0);
  const t1 = $derived(Math.max(s?.lastAt ?? 0, timeline[timeline.length - 1]?.ts ?? 0, ...agents.map((a) => a.endedAt || 0)));
  const selRow = $derived(timeline.find((r) => r.id === sel) || null);
  const nearest = (list, ts) => list.reduce((b, r) => (!b || Math.abs((r.ts || 0) - ts) < Math.abs((b.ts || 0) - ts) ? r : b), null);

  let lastLink = '';
  $effect(() => {
    const link = `${params.at ?? ''}|${params.ts ?? ''}`;
    if (!timeline.length || (inited && link === lastLink)) return;
    const first = !inited;
    inited = true;
    lastLink = link;
    untrack(() => {
      const at = params.at && timeline.find((r) => r.rawId === params.at || r.id === params.at);
      if (!first && !at && !params.ts) return;
      const ts = Number(params.ts);
      const r = at || (Number.isFinite(ts) && ts > 0 ? nearest(timeline, ts) : null);
      if (r) select(r.id, true);
      if (first && params.path) why = { path: params.path, ts: Number.isFinite(ts) && ts > 0 ? ts : null };
    });
  });

  function select(rid, scroll = false) {
    sel = rid;
    const i = rows.findIndex((r) => r.id === rid);
    if (i >= limit) limit = i + 50;
    if (scroll) tick().then(() => document.getElementById(`row-${CSS.escape(String(rid))}`)?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
  }
  // write &at= to the URL without a history entry per keypress
  let urlTimer;
  $effect(() => {
    const at = sel;
    clearTimeout(urlTimer);
    if (!at) return;
    urlTimer = setTimeout(() => {
      const raw = timeline.find((r) => r.id === at)?.rawId;
      if (raw == null) return;
      const h = href('sessions', { id, at: raw });
      if (location.hash !== h) history.replaceState(history.state, '', h);
    }, 400);
    return () => clearTimeout(urlTimer);
  });
  function step(dir) {
    if (!rows.length) return;
    let i = rows.findIndex((r) => r.id === sel);
    if (i < 0) i = dir > 0 ? -1 : rows.length;
    const n = rows[Math.max(0, Math.min(rows.length - 1, i + dir))];
    if (n) select(n.id, true);
  }
  function onkeydown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || app.palette || app.modal) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === 'j' || e.key === 'k') { e.preventDefault(); step(e.key === 'j' ? 1 : -1); }
    else if (e.key === 'Enter' && selRow?.kind === 'edit' && document.activeElement === document.body) { e.preventDefault(); showDiffFor(selRow); }
  }

  // ---- ruler
  const COLORS = ['var(--accent)', 'var(--ok)', 'var(--info)', 'var(--warn)', 'var(--accent-2)'];
  const lanes = $derived.by(() => {
    if (!agents.length) return t0 ? [{ key: 'main', label: 'main', start: t0, end: t1, color: COLORS[0] }] : [];
    return agents.map((a, i) => ({ key: a.agentId, label: a.agentId === 'main' || !a.parent ? 'main' : a.name || a.agentId, start: a.startedAt ?? t0, end: a.endedAt ?? t1, color: COLORS[i % COLORS.length] }));
  });
  const mainKey = $derived(lanes[0]?.key);
  const marks = $derived(timeline.filter((r) => ['prompt', 'edit', 'compact', 'interrupt'].includes(r.kind) || isErr(r)).map((r) => ({
    ts: r.ts, lane: mainKey, tall: r.kind === 'prompt' || isErr(r) || r.kind === 'compact',
    color: isErr(r) ? 'var(--err)' : r.kind === 'prompt' ? 'var(--accent)' : r.kind === 'edit' ? 'var(--ok)' : 'var(--warn)',
    title: `${K[r.kind]?.label || r.kind} · ${fmtTime(r.ts)}`,
  })));
  const seek = (ts) => { const r = nearest(rows, ts); if (r) select(r.id, true); };

  // ---- files + diffs
  let fileSel = $state(null); // { path, backup }
  let why = $state(null); // { path, ts }
  function versionFor(path, ts) {
    const f = files.find((x) => x.path === path);
    if (!f?.versions?.length) return null;
    return f.versions.filter((v) => (v.ts || 0) <= (ts || Infinity) + 5000).pop() || f.versions[0];
  }
  function showDiffFor(r) {
    const v = versionFor(r.path, r.ts);
    if (v) { fileSel = { path: r.path, backup: v.backup }; tick().then(() => document.getElementById('files-panel')?.scrollIntoView({ block: 'nearest' })); }
    else toast('No file-history version recorded for this edit', 'info');
  }

  // ---- subagent tree
  const tree = $derived.by(() => {
    const root = agents.find((a) => !a.parent) || null;
    const kids = (pid) => agents.filter((a) => a.parent === pid);
    const walk = (a, depth) => [{ a, depth }, ...kids(a.agentId).flatMap((k) => walk(k, depth + 1))];
    return root ? walk(root, 0) : [];
  });
  const jumpAgent = (a) => { const r = timeline.find((x) => x.kind === 'subagent' && x.agentId === a.agentId); if (r) { off = new Set(); errorsOnly = false; select(r.id, true); } };

  const blank = (v) => v == null || !String(v).trim();
  const rel = (ts) => (t0 && ts ? `+${fmtMs(Math.max(0, ts - t0))}` : '');
  const dur = $derived(s ? s.activeMs ?? (s.lastAt && s.startedAt ? s.lastAt - s.startedAt : null) : null);
  async function copyId() { toast((await copyText(id)) ? 'Session id copied' : 'Clipboard unavailable', 'ok'); }
</script>

<svelte:window {onkeydown} />

<div class="top">
  <button class="btn ghost sm" onclick={() => navigate('sessions')}><Icon name="arrowLeft" size={13} /> All sessions</button>
</div>

{#if res.error && !d}
  <div class="card"><Empty icon={res.error.status === 404 ? 'search' : 'alert'} title={res.error.status === 404 ? 'Session not found' : 'Could not load the session'}>
    {res.error.status === 404 ? `No transcript for ${shortId(id)} in this project. It may have been deleted or belong to another project.` : res.error.message}
    <div class="mt"><button class="btn sm" onclick={() => navigate('sessions')}>Back to sessions</button></div></Empty></div>
{:else if !d}
  <div class="card hdr"><div class="card-b pad"><Skeleton kind="kpis" count={6} label="Loading session" /></div></div>
  <div class="layout"><section class="card"><div class="card-b pad"><Skeleton kind="timeline" count={10} /></div></section><aside class="card"><div class="card-b pad"><Skeleton kind="bars" count={5} /></div></aside></div>
{:else}
  <section class="card hdr">
    <div class="hh">
      <ToolBadge tool={s?.tool} />
      <h2 class="ttl">{sessionLabel(s)}</h2>
      <span class="spacer"></span>
      <EntityLink kind="session" id={id} title="Open in the side panel"><span class="btn ghost sm"><Icon name="layers" size={12} /> Details</span></EntityLink>
      <button class="btn ghost sm" onclick={copyId} title="Copy session id"><Icon name="copy" size={12} /> <span class="mono">{shortId(id)}</span></button>
    </div>
    <div class="meta faint">
      <span><Icon name="clock" size={12} /> {fmtDate(s?.startedAt)} · {timeAgo(s?.lastAt, app.now)}</span>
      {#if s?.branch}<span><Icon name="branch" size={12} /> <span class="mono">{s.branch}</span></span>{/if}
      {#each s?.models || [] as m (m)}<EntityLink kind="model" id={m} label={modelLabel(m)} class="mchip" />{/each}
    </div>
    <div class="stats">
      <div class="st"><div class="eyebrow">Cost {#if s?.exact}<span class="badge ok xs">exact</span>{:else}<span class="badge warn xs" title="Estimated from token usage at list prices">estimated</span>{/if}</div><b class="tnum">{money(s?.usd, { est: !s?.exact })}</b></div>
      <div class="st"><div class="eyebrow">Tokens</div><b class="tnum">{fmtNum(tokTotal(s?.tokens))}</b>{#if s?.tokens}<span class="faint tiny">{fmtNum(s.tokens.input)} in · {fmtNum(s.tokens.output)} out · {fmtNum(s.tokens.cacheRead)} cache</span>{/if}</div>
      <div class="st"><div class="eyebrow">Prompts</div><b class="tnum">{fmtNum(s?.prompts)}</b></div>
      <div class="st"><div class="eyebrow">Tool calls</div><b class="tnum">{fmtNum(s?.toolCalls)}</b>{#if s?.errors}<span class="err tiny"><Icon name="alert" size={10} /> {s.errors} errors</span>{/if}</div>
      <div class="st"><div class="eyebrow">Subagents</div><b class="tnum">{fmtNum(s?.subagents)}</b>{#if s?.compactions}<span class="faint tiny">{s.compactions} compaction{s.compactions === 1 ? '' : 's'}</span>{/if}</div>
      <div class="st"><div class="eyebrow">Lines</div><b class="tnum"><span class="ok">+{fmtNum(s?.linesAdded)}</span> <span class="err">−{fmtNum(s?.linesRemoved)}</span></b><span class="faint tiny">{s?.filesTouched?.length ?? files.length} files</span></div>
      <div class="st"><div class="eyebrow">Active</div><b class="tnum">{fmtMs(dur)}</b></div>
    </div>
    {#if lanes.length && t1 > t0}
      <div class="ruler">
        <Gantt from={t0} to={t1} {lanes} {marks} cursor={selRow?.ts ?? null} onseek={seek} label="Session time ruler: click or drag to jump; arrow keys step through prompts, edits and errors" />
        <div class="rl faint tiny"><span><i class="sw a"></i>prompt</span><span><i class="sw o"></i>edit</span><span><i class="sw e"></i>error</span><span><i class="sw w"></i>compaction / interrupt</span><span class="spacer"></span><span><span class="kbd">j</span> <span class="kbd">k</span> step</span></div>
      </div>
    {/if}
  </section>

  <div class="layout">
    <section class="card tlc">
      <div class="card-h">
        Timeline <span class="sub">{fmtNum(rows.length)} of {fmtNum(timeline.length)} events</span>
      </div>
      <div class="filters" role="group" aria-label="Filter timeline by kind">
        {#each GROUPS as [g, label] (g)}
          {#if counts[g]}<button class="chip" class:on={!errorsOnly && !off.has(g)} aria-pressed={!errorsOnly && !off.has(g)} disabled={errorsOnly} onclick={() => toggle(g)}>{label} <span class="n">{counts[g]}</span></button>{/if}
        {/each}
        {#if errCount}<button class="chip errchip" class:on={errorsOnly} aria-pressed={errorsOnly} onclick={() => (errorsOnly = !errorsOnly)}><Icon name="alert" size={11} /> Errors only <span class="n">{errCount}</span></button>{/if}
      </div>
      {#if !timeline.length}
        <Empty icon="timeline" title="No events recorded" compact>The transcript has no prompts or tool calls we could read.</Empty>
      {:else if !rows.length}
        <Empty icon="filter" title="Nothing matches the filters" compact><button class="btn sm" onclick={() => { off = new Set(); errorsOnly = false; }}>Show everything</button></Empty>
      {:else}
        <ol class="tl">
          {#each rows.slice(0, limit) as r (r.id)}
            {@const k = K[r.kind] || { icon: 'dot', label: r.kind, c: 'muted' }}
            {@const bad = isErr(r)}
            <li id="row-{r.id}" class="ev k-{k.c} kind-{r.kind}" class:bad class:sel={sel === r.id} class:sub={r.kind === 'result'}>
              <button class="hit" aria-label="{k.label} at {fmtTime(r.ts)}" aria-current={sel === r.id ? 'step' : undefined} onclick={() => select(r.id)}></button>
              <span class="ic"><Icon name={bad ? 'alert' : k.icon} size={12} /></span>
              <div class="eb">
                {#if r.kind === 'result'}
                  <div class="et rs" class:errt={bad}><span class="arrow" aria-hidden="true">↳</span>{#if bad}<b>Error</b>&nbsp;{/if}{r.text || (bad ? 'Failed' : 'OK')}</div>
                {:else}
                <div class="eh">
                  <span class="kl">{k.label}</span>
                  {#if r.tool && r.kind !== 'edit'}<EntityLink kind="tool" id={r.tool} label={r.tool.replace(/^mcp__([^_]+)__/, '$1 · ')} class="tool mono" />{/if}
                  {#if r.model && r.kind !== 'text'}<EntityLink kind="model" id={r.model} label={modelLabel(r.model)} class="tiny" />{/if}
                  <span class="spacer"></span>
                  {#if r.durationMs != null}<span class="faint tiny tnum" title="Duration">{fmtMs(r.durationMs)}</span>{/if}
                  {#if r.tokens != null}<span class="faint tiny tnum">{fmtNum(r.tokens)} tok</span>{/if}
                  {#if r.usd != null}<span class="faint tiny tnum">{money(r.usd)}</span>{/if}
                  <span class="faint tiny tnum ts" title={fmtDate(r.ts)}>{fmtTime(r.ts)} <span class="rel">{rel(r.ts)}</span></span>
                </div>
                {/if}
                {#if r.kind === 'prompt'}
                  {#if blank(r.prompt ?? r.text)}<div class="et hidden"><Icon name="lock" size={11} /> Prompt text hidden for your role</div>{:else}<div class="et pr">{r.prompt ?? r.text}</div>{/if}
                {:else if r.kind === 'thinking'}
                  <div class="et faint">{#if r.durationMs != null}Thought for {fmtMs(r.durationMs)}{:else}Thinking{/if}{#if !blank(r.thinking)}&nbsp;·&nbsp;<span class="th">{r.thinking}</span>{/if}</div>
                {:else if r.kind === 'tool'}
                  {#if r.input}<code class="in">{r.input}</code>{/if}
                {:else if r.kind === 'edit'}
                  <div class="et row">
                    {#if r.path}<EntityLink kind="file" id={r.path} label={r.path} class="mono" />{/if}
                    {#if r.text}<span class="tnum faint">{r.text}</span>{/if}
                    {#if r.path}<button class="btn ghost sm" onclick={() => showDiffFor(r)}><Icon name="diff" size={11} /> Diff</button><button class="btn ghost sm" onclick={() => (why = { path: r.path, ts: r.ts })}><Icon name="sparkles" size={11} /> Why?</button>{/if}
                  </div>
                {:else if r.kind === 'subagent'}
                  <div class="et">{r.text || r.agentId}</div>
                {:else if r.kind !== 'result'}
                  {#if r.text || r.input}<div class="et" class:errt={bad}>{r.text || r.input}</div>{/if}
                {/if}
              </div>
            </li>
          {/each}
        </ol>
        {#if rows.length > limit}<div class="more"><button class="btn sm" onclick={() => (limit += 300)}>Show more ({fmtNum(rows.length - limit)})</button></div>{/if}
      {/if}
    </section>

    <aside class="side">
      {#if tree.length > 1}
        <section class="card">
          <div class="card-h">Agents <span class="sub">{tree.length - 1} subagent{tree.length === 2 ? '' : 's'}</span></div>
          <ul class="tree">
            {#each tree as { a, depth }, i (a.agentId ?? `a${i}`)}
              <li style="--d:{depth}">
                <button class="tn" onclick={() => jumpAgent(a)} disabled={depth === 0} title={depth ? 'Jump to where it was spawned' : ''}>
                  <span class="dot" class:main={depth === 0}></span>
                  <span class="grow"><b class="ellipsis">{depth === 0 ? 'main' : a.name || a.agentId}</b><span class="faint tiny">{modelLabel(a.model)} · {fmtNum(a.turns)} turns · {fmtNum(a.tokens)} tok{#if a.startedAt && a.endedAt} · {fmtMs(a.endedAt - a.startedAt)}{/if}</span></span>
                  <b class="tnum">{money(a.usd)}</b>
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <section class="card" id="files-panel">
        <div class="card-h">Files changed <span class="sub">{files.length}</span></div>
        {#if !files.length}
          <div class="card-b faint tiny">No file edits in this session.</div>
        {:else}
          <ul class="files">
            {#each files as f, i (f.path ?? i)}
              <li class:on={fileSel?.path === f.path}>
                <div class="fh">
                  <EntityLink kind="file" id={f.path} title={f.path}><span class="mono">{basename(f.path)}</span></EntityLink>
                  <span class="faint tiny ellipsis">{f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''}</span>
                  <span class="spacer"></span>
                  <button class="btn ghost sm" onclick={() => (why = why?.path === f.path ? null : { path: f.path, ts: f.versions?.[f.versions.length - 1]?.ts })} aria-pressed={why?.path === f.path}>Why?</button>
                </div>
                {#if f.versions?.length}
                  <div class="vers" role="group" aria-label="Versions of {f.path}">
                    {#each f.versions as v, i (v.backup ?? i)}
                      <button class="chip vchip" class:on={fileSel?.path === f.path && fileSel.backup === v.backup} onclick={() => (fileSel = fileSel?.backup === v.backup && fileSel.path === f.path ? null : { path: f.path, backup: v.backup })} title={fmtDate(v.ts)}>v{i + 1} <span class="n">{fmtTime(v.ts).slice(0, 5)}</span></button>
                    {/each}
                  </div>
                {/if}
                {#if fileSel?.path === f.path}<FileDiff session={id} path={f.path} backup={fileSel.backup} />{/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      {#if why}
        <section class="whyc">
          <div class="wh"><span class="eyebrow">Why did the agent change <span class="mono">{basename(why.path)}</span>?</span><span class="spacer"></span><button class="btn ghost sm icon" aria-label="Close" onclick={() => (why = null)}><Icon name="x" size={12} /></button></div>
          <WhyReplay path={why.path} ts={why.ts ? String(why.ts) : ''} session={id} picker={false} />
        </section>
      {/if}
    </aside>
  </div>
{/if}

<style>
  .top { margin: -6px 0 10px; }
  .mt { margin-top: 10px; }
  .pad { padding-top: 14px; }
  .hdr { padding: 14px 16px 12px; }
  .hh { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .ttl { margin: 0; font-size: 18px; font-weight: 650; letter-spacing: -0.01em; min-width: 0; overflow-wrap: anywhere; }
  .hh :global(.elink) { border-bottom: 0; }
  .meta { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; font-size: 12px; margin-top: 6px; }
  .meta > span { display: inline-flex; gap: 5px; align-items: center; }
  .meta :global(.mchip), :global(.mchip) { font-size: 11px; padding: 1px 7px; border-radius: 99px; border: 1px solid var(--border); color: var(--text-2); }
  .stats { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
  .st { display: flex; flex-direction: column; gap: 2px; padding: 9px 11px; border-radius: 10px; background: var(--inset); min-width: 0; }
  .st b { font-size: 17px; }
  .st .eyebrow { display: flex; gap: 5px; align-items: center; }
  .xs { font-size: 9.5px; height: 16px; padding: 0 5px; letter-spacing: 0; text-transform: none; }
  .ok { color: var(--ok); }
  .err { color: var(--err); display: inline-flex; gap: 3px; align-items: center; }
  .tiny { font-size: 11px; }
  .ruler { margin-top: 14px; }
  .rl { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-top: 6px; }
  .rl > span { display: inline-flex; gap: 5px; align-items: center; }
  .sw { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
  .sw.a { background: var(--accent); } .sw.o { background: var(--ok); } .sw.e { background: var(--err); } .sw.w { background: var(--warn); }
  .layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, 400px); gap: 14px; margin-top: 14px; align-items: start; }
  .tlc { min-width: 0; }
  .filters { display: flex; gap: 6px; flex-wrap: wrap; padding: 0 16px 10px; }
  .errchip.on { color: var(--err); border-color: color-mix(in srgb, var(--err) 40%, transparent); background: var(--err-soft); }
  .tl { list-style: none; margin: 0; padding: 4px 12px 12px 18px; position: relative; }
  .tl::before { content: ''; position: absolute; left: 30px; top: 8px; bottom: 16px; width: 1px; background: var(--border); }
  .ev { position: relative; display: flex; gap: 10px; padding: 6px 8px 6px 0; border-radius: 9px; min-width: 0; scroll-margin: 80px; }
  .ev.sub { padding-top: 0; padding-bottom: 4px; margin-top: -4px; }
  .ev.sub .ic { visibility: hidden; height: 14px; }
  .ev.sub.bad .ic { visibility: visible; height: 24px; }
  .rs { font-size: 12px; display: flex; gap: 6px; align-items: baseline; }
  .arrow { color: var(--text-3); flex: none; }
  .rs b { flex: none; white-space: nowrap; }
  .hit { all: unset; position: absolute; inset: 0; border-radius: 9px; cursor: pointer; }
  .hit:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }
  .ev:hover { background: var(--panel-hover); }
  .ev.sel { background: var(--accent-soft); box-shadow: inset 2px 0 0 var(--accent); }
  .ev :global(a), .ev button:not(.hit) { position: relative; z-index: 1; }
  .ic { width: 24px; height: 24px; flex: none; border-radius: 50%; display: grid; place-items: center; background: var(--panel-solid); border: 1px solid var(--border-strong); color: var(--text-3); position: relative; z-index: 0; margin-left: 0; }
  .k-accent .ic { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
  .k-ok .ic { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, transparent); }
  .k-info .ic { color: var(--info); }
  .k-warn .ic { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, transparent); }
  .k-err .ic, .bad .ic { color: var(--err); border-color: var(--err); background: var(--err-soft); }
  .ev.bad { background: color-mix(in srgb, var(--err) 6%, transparent); }
  .eb { flex: 1; min-width: 0; pointer-events: none; }
  .eb :global(a), .eb button, .eb code { pointer-events: auto; }
  .eh { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 12px; min-height: 24px; }
  .kl { font-weight: 600; color: var(--text-2); }
  .k-accent .kl { color: var(--accent); }
  .bad .kl { color: var(--err); }
  .eh :global(.tool) { font-size: 11.5px; }
  .ts .rel { opacity: 0.7; }
  .et { font-size: 13px; color: var(--text-2); overflow-wrap: anywhere; margin-top: 1px; }
  .et.pr { color: var(--text); font-size: 13.5px; white-space: pre-wrap; padding: 6px 10px; border-radius: 8px; background: var(--inset); border: 1px solid var(--border); margin-top: 3px; }
  .et.hidden { font-style: italic; color: var(--text-3); display: flex; gap: 5px; align-items: center; }
  .et.errt { color: var(--err); font-family: var(--mono); font-size: 12px; }
  .et.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .th { font-style: italic; }
  .in { display: inline-block; font-family: var(--mono); font-size: 11.5px; color: var(--text-2); background: var(--inset); padding: 2px 7px; border-radius: 6px; margin-top: 2px; overflow-wrap: anywhere; max-width: 100%; }
  .kind-text .et { color: var(--text); }
  .more { padding: 0 16px 14px; }
  .side { display: flex; flex-direction: column; gap: 14px; min-width: 0; position: sticky; top: 12px; max-height: calc(100vh - 90px); overflow: auto; }
  .tree { list-style: none; margin: 0; padding: 0 10px 10px; display: flex; flex-direction: column; gap: 2px; }
  .tree li { padding-left: calc(var(--d) * 16px); }
  .tn { all: unset; box-sizing: border-box; width: 100%; display: flex; gap: 8px; align-items: center; padding: 6px 8px; border-radius: 8px; cursor: pointer; font-size: 12.5px; }
  .tn:hover:not(:disabled) { background: var(--panel-hover); }
  .tn:disabled { cursor: default; }
  .tn:focus-visible { outline: 2px solid var(--accent); }
  .tn .grow { display: flex; flex-direction: column; min-width: 0; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); flex: none; }
  .dot.main { background: var(--accent); }
  .files { list-style: none; margin: 0; padding: 0 10px 10px; display: flex; flex-direction: column; gap: 4px; }
  .files li { padding: 7px 8px; border-radius: 9px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .files li.on { background: var(--inset); }
  .fh { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12.5px; }
  .vers { display: flex; gap: 4px; flex-wrap: wrap; }
  .vchip { height: 22px; font-size: 11px; padding: 0 7px; }
  .whyc { display: flex; flex-direction: column; gap: 8px; }
  .wh { display: flex; align-items: center; gap: 6px; }
  @media (max-width: 1200px) { .stats { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
  @media (max-width: 980px) { .layout { grid-template-columns: minmax(0, 1fr); } .side { position: static; max-height: none; } }
  @media (max-width: 560px) {
    .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .ts .rel { display: none; }
    .tl { padding-left: 8px; }
    .tl::before { left: 20px; }
  }
</style>
