<script>
  // Session list: filter, search, sort; click a row to open the replay.
  import { untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { app, navigate } from '../../lib/store.svelte.js';
  import { href } from '../../lib/nav.js';
  import { fmtNum, timeAgo } from '../../lib/format.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';
  import ToolBadge from '../../lib/ToolBadge.svelte';
  import Skeleton from '../../lib/viz/Skeleton.svelte';
  import { RANGES, AGENTS, agentOf, rangeOf, usageQuery, money, fmtMs, tokTotal, modelLabel, sessionLabel, shortId } from '../usage/shared.js';

  let { params = {} } = $props();
  const range = $derived(rangeOf(params));
  const agent = $derived(agentOf(params));
  let q = $state(untrack(() => params.q || ''));
  let qd = $state(untrack(() => params.q || ''));
  let timer;
  $effect(() => {
    const v = q;
    clearTimeout(timer);
    timer = setTimeout(() => (qd = v.trim()), 250);
    return () => clearTimeout(timer);
  });

  const res = resource(() => api('/api/usage/sessions', usageQuery(range, agent, { q: qd || undefined })), { key: () => [range, agent, qd] });
  const rows = $derived(Array.isArray(res.data?.sessions) ? res.data.sessions : []);

  let only = $state('all');
  const ONLY = [['all', 'All'], ['errors', 'With errors'], ['subagents', 'With subagents'], ['exact', 'Exact cost']];
  let sort = $state({ key: 'lastAt', dir: -1 });
  const COLS = [
    ['title', 'Session'], ['tool', 'Agent'], ['branch', 'Branch'], ['models', 'Models'], ['usd', 'Cost', 1], ['tokens', 'Tokens', 1], ['toolCalls', 'Tools', 1],
    ['errors', 'Errors', 1], ['subagents', 'Subagents', 1], ['files', 'Files', 1], ['duration', 'Duration', 1], ['lastAt', 'Last', 1],
  ];
  const dur = (s) => s.activeMs ?? (s.lastAt && s.startedAt ? s.lastAt - s.startedAt : null);
  const val = (s, k) => (k === 'tokens' ? tokTotal(s.tokens) : k === 'files' ? s.filesTouched?.length : k === 'duration' ? dur(s) : k === 'models' ? (s.models || []).join() : k === 'title' ? sessionLabel(s).toLowerCase() : s[k]);
  const list = $derived.by(() => {
    const f = rows.filter((s) => only === 'all' || (only === 'errors' ? s.errors > 0 : only === 'subagents' ? s.subagents > 0 : s.exact));
    const { key, dir } = sort;
    return f.slice().sort((a, b) => {
      const x = val(a, key) ?? -Infinity;
      const y = val(b, key) ?? -Infinity;
      return (typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y)) : x - y) * dir;
    });
  });
  const sortBy = (key) => (sort = { key, dir: sort.key === key ? -sort.dir : ['title', 'tool', 'branch', 'models'].includes(key) ? 1 : -1 });
  let shown = $state(50);

  const totals = $derived.by(() => {
    const usd = list.reduce((a, s) => a + (s.usd || 0), 0);
    const exact = list.reduce((a, s) => a + (s.exact ? s.usd || 0 : 0), 0);
    return { usd, exact, est: usd - exact, errors: list.reduce((a, s) => a + (s.errors || 0), 0), tokens: list.reduce((a, s) => a + (tokTotal(s.tokens) || 0), 0) };
  });

  const set = (patch) => navigate('sessions', { q: qd || undefined, range: range === '30d' ? undefined : range, agent: agent === 'all' ? undefined : agent, ...patch });
  const open = (s) => navigate('sessions', { id: s.sessionId });
  function rowClick(e, s) {
    if (e.target.closest('a, button')) return; // EntityLinks open the side panel instead
    open(s);
  }
  const shortDate = (ts) => (ts ? new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const maxUsd = $derived(Math.max(0.01, ...rows.map((s) => s.usd || 0)));
</script>

<div class="bar">
  <div class="search"><Icon name="search" size={14} /><input class="input" type="search" placeholder="Search session titles" aria-label="Search sessions" bind:value={q} /></div>
  <div class="segc" role="group" aria-label="Agent">
    {#each AGENTS as a (a)}<button class:on={agent === a} aria-pressed={agent === a} onclick={() => set({ agent: a === 'all' ? undefined : a })}>{#if a !== 'all'}<ToolBadge tool={a} compact />{/if}{a === 'all' ? 'All' : a === 'claude' ? 'Claude' : 'Codex'}</button>{/each}
  </div>
  <div class="segc" role="group" aria-label="Time range">
    {#each RANGES as r (r)}<button class:on={range === r} aria-pressed={range === r} onclick={() => set({ range: r === '30d' ? undefined : r })}>{r === 'all' ? 'All' : r}</button>{/each}
  </div>
</div>
<div class="chips" role="group" aria-label="Show only">
  {#each ONLY as [k, l] (k)}<button class="chip" class:on={only === k} aria-pressed={only === k} onclick={() => (only = k)}>{l}</button>{/each}
  {#if res.data}
    <span class="spacer"></span>
    <span class="sum faint">
      <b class="tnum">{fmtNum(list.length)}</b> sessions · <b class="tnum">{money(totals.usd)}</b>
      <span class="tiny">({money(totals.exact)} exact, {money(totals.est, { est: true })} est.)</span> · <b class="tnum">{fmtNum(totals.tokens)}</b> tokens · <b class="tnum">{fmtNum(totals.errors)}</b> errors
    </span>
  {/if}
</div>

{#if res.error && !res.data}
  <div class="card"><Empty icon="alert" title="Sessions unavailable">{res.error.message}<div class="mt"><button class="btn sm" onclick={() => res.reload()}><Icon name="refresh" size={13} /> Retry</button></div></Empty></div>
{:else if !res.data}
  <section class="card"><div class="card-b pad"><Skeleton kind="table" count={10} label="Loading sessions" /></div></section>
{:else if !list.length}
  <div class="card"><Empty icon="agents" title={qd ? 'No sessions match' : 'No sessions in this range'}>{qd ? `No session title contains “${qd}”.` : 'Claude Code and Codex sessions for this project show up here. Try a longer range.'}</Empty></div>
{:else}
  <section class="card desk">
    <div class="tw">
      <table class="tbl">
        <thead>
          <tr>
            {#each COLS as [key, label, num] (key)}
              <th class:num aria-sort={sort.key === key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
                <button class="th" onclick={() => sortBy(key)}>{label}{#if sort.key === key}<Icon name={sort.dir > 0 ? 'arrowUp' : 'arrowDown'} size={10} />{/if}</button>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each list.slice(0, shown) as s (s.sessionId)}
            <tr class="rw" onclick={(e) => rowClick(e, s)}>
              <td class="ttl">
                <a class="tl" href={href('sessions', { id: s.sessionId })} title={sessionLabel(s)}>{sessionLabel(s)}</a>
                <div class="faint tiny"><span class="mono">{shortId(s.sessionId)}</span> · {shortDate(s.startedAt)}</div>
              </td>
              <td><EntityLink kind="agent" id={s.tool} title="Open {s.tool}"><ToolBadge tool={s.tool} /></EntityLink></td>
              <td class="br"><span class="mono tiny ellipsis">{s.branch || '—'}</span></td>
              <td class="mods">{#each s.models || [] as m (m)}<EntityLink kind="model" id={m} label={modelLabel(m)} class="mchip" />{/each}</td>
              <td class="num tnum">
                <div class="cost"><span title={s.exact ? 'Exact (cost-state)' : 'Estimated from token usage'}>{money(s.usd, { est: !s.exact })}</span><span class="cb" aria-hidden="true"><span style="width:{((s.usd || 0) / maxUsd) * 100}%"></span></span></div>
              </td>
              <td class="num tnum">{fmtNum(tokTotal(s.tokens))}</td>
              <td class="num tnum">{fmtNum(s.toolCalls)}</td>
              <td class="num tnum">{#if s.errors}<span class="err"><Icon name="alert" size={11} /> {s.errors}</span>{:else}<span class="faint">0</span>{/if}</td>
              <td class="num tnum">{s.subagents || '—'}</td>
              <td class="num tnum" title={(s.filesTouched || []).join('\n')}>{s.filesTouched?.length ?? '—'}</td>
              <td class="num tnum">{fmtMs(dur(s))}</td>
              <td class="num faint tiny">{timeAgo(s.lastAt, app.now)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <ul class="mob">
    {#each list.slice(0, shown) as s (s.sessionId)}
      <li class="card mc">
        <a class="mca" href={href('sessions', { id: s.sessionId })}>
          <div class="mh"><ToolBadge tool={s.tool} compact /><b class="ellipsis">{sessionLabel(s)}</b><span class="spacer"></span><b class="tnum">{money(s.usd, { est: !s.exact })}</b></div>
          <div class="faint tiny">{timeAgo(s.lastAt, app.now)} · {s.branch || 'no branch'} · {(s.models || []).map(modelLabel).join(', ')}</div>
          <div class="ms tiny">
            <span>{fmtNum(tokTotal(s.tokens))} tok</span><span>{fmtNum(s.toolCalls)} tools</span>
            {#if s.errors}<span class="err">{s.errors} errors</span>{/if}{#if s.subagents}<span>{s.subagents} subagents</span>{/if}
            <span>{s.filesTouched?.length ?? 0} files</span><span>{fmtMs(dur(s))}</span>
          </div>
        </a>
      </li>
    {/each}
  </ul>
  {#if list.length > shown}<div class="more"><button class="btn sm" onclick={() => (shown += 100)}>Show more ({list.length - shown})</button></div>{/if}
{/if}

<style>
  .mt { margin-top: 10px; }
  .pad { padding-top: 14px; }
  .bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .search { flex: 1 1 260px; display: flex; align-items: center; gap: 8px; color: var(--text-3); position: relative; }
  .search .input { width: 100%; }
  .chips { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin: 12px 0; }
  .sum { font-size: 12px; }
  .tiny { font-size: 11px; }
  .tw { overflow-x: auto; padding: 0 6px 6px; }
  .tbl { min-width: 980px; font-size: 12.5px; }
  .tbl :global(th), .tbl :global(td) { padding-left: 8px; padding-right: 8px; }
  .tbl th.num, .tbl td.num { text-align: right; }
  .th { all: unset; cursor: pointer; display: inline-flex; gap: 3px; align-items: center; }
  .th:focus-visible { outline: 2px solid var(--accent); border-radius: 3px; }
  .rw { cursor: pointer; }
  .ttl { max-width: 260px; }
  .tl { color: var(--text); font-weight: 600; text-decoration: none; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tl:hover { color: var(--accent); }
  .tl:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 3px; }
  .br { max-width: 150px; }
  .br span { display: block; }
  .mods { max-width: 170px; }
  .mods :global(.mchip) { display: inline-block; margin-bottom: 2px; }
  .mods :global(.mchip) { font-size: 11px; padding: 1px 6px; border-radius: 99px; border: 1px solid var(--border); margin-right: 4px; color: var(--text-2); }
  .cost { display: inline-flex; flex-direction: column; align-items: flex-end; gap: 3px; }
  .cb { width: 54px; height: 3px; border-radius: 99px; background: var(--panel-active); overflow: hidden; }
  .cb span { display: block; height: 100%; background: var(--accent-2); }
  .err { color: var(--err); display: inline-flex; align-items: center; gap: 3px; }
  .mob { display: none; list-style: none; margin: 0; padding: 0; flex-direction: column; gap: 8px; }
  .mca { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; color: inherit; text-decoration: none; }
  .mh { display: flex; align-items: center; gap: 8px; font-size: 13.5px; min-width: 0; }
  .ms { display: flex; gap: 10px; flex-wrap: wrap; color: var(--text-2); }
  .more { margin-top: 12px; }
  @media (max-width: 760px) {
    .desk { display: none; }
    .mob { display: flex; }
    .sum { width: 100%; }
    .bar .segc { flex: 1 1 auto; }
    .bar .segc button { flex: 1; justify-content: center; padding: 0 5px; }
  }
</style>
