<script>
  // Stored verification runs; the selected one shows failures and its (admin-only) log.
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { navigate } from '../../lib/store.svelte.js';
  import { timeAgo, fmtDate } from '../../lib/format.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';
  import { duration } from './shared.js';

  let { params = {} } = $props();
  const list = resource(() => api('/api/ship/runs', { limit: 100 }));
  const runs = $derived(list.data?.runs || []);
  const sel = $derived(params.run || runs[0]?.id || null);
  const detail = resource((id) => (id ? api('/api/ship/run', { id }) : Promise.resolve(null)), { key: () => sel, live: false });
  const d = $derived(detail.data);
  const ok = (r) => r.exitCode === 0 && !r.failed;
</script>

{#if list.error && !list.data}
  <div class="card"><Empty icon="alert" title="Could not load runs">{list.error.message}</Empty></div>
{:else if !list.data}
  <div class="card card-b" aria-busy="true"><div class="skel-rows"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div></div>
{:else if !runs.length}
  <div class="card"><Empty icon="play" title="No runs yet">Run the checks from the Report tab (needs <code>actions.exec</code>) or with <code>agentneuron ship --run</code> in a terminal. Results are stored in <code>.agentneuron/ship/runs/</code>.</Empty></div>
{:else}
  <div class="layout">
    <section class="card side" aria-label="Runs">
      <ul class="rl">
        {#each runs as r (r.id)}
          <li>
            <button class="list-row" class:active={r.id === sel} onclick={() => navigate('ship', { tab: 'runs', run: r.id })} aria-current={r.id === sel ? 'true' : undefined}>
              <span class="dot {ok(r) ? 'ok' : 'err'}" aria-hidden="true"></span>
              <span class="col grow" style="gap:1px">
                <span class="row" style="gap:6px"><b class="ellipsis">{r.check || r.command}</b><span class="badge">{r.kind}</span></span>
                <span class="faint xs tnum">{ok(r) ? 'passed' : 'failed'} · {r.passed}✓ {r.failed}✗ · {timeAgo(r.endedAt)}</span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
    <section class="card main" aria-label="Run details">
      {#if !d}
        <div class="card-b" aria-busy="true"><div class="skel-rows"><div class="skel"></div><div class="skel"></div></div></div>
      {:else}
        <div class="card-h">
          <Icon name={ok(d) ? 'check' : 'error'} size={15} />
          <span class="mono ellipsis">{d.command}</span>
          <span class="spacer"></span>
          <span class="badge {ok(d) ? 'ok' : 'err'}">{ok(d) ? 'passed' : `exit ${d.exitCode ?? '?'}`}</span>
        </div>
        <div class="card-b col" style="gap:12px">
          <dl class="meta">
            <div><dt>Passed</dt><dd class="tnum">{d.passed}</dd></div>
            <div><dt>Failed</dt><dd class="tnum" class:bad={d.failed}>{d.failed}</dd></div>
            <div><dt>Skipped</dt><dd class="tnum">{d.skipped}</dd></div>
            <div><dt>Duration</dt><dd class="tnum">{duration(d.startedAt, d.endedAt)}</dd></div>
            <div><dt>When</dt><dd title={fmtDate(d.endedAt)}>{timeAgo(d.endedAt)}</dd></div>
            {#if d.head}<div><dt>Commit</dt><dd><EntityLink kind="commit" id={d.head} mono /></dd></div>{/if}
          </dl>
          {#if d.failures?.length}
            <ul class="fails">
              {#each d.failures as f, i (i)}
                <li>
                  <div class="row" style="gap:8px;flex-wrap:wrap"><b>{f.name}</b>{#if f.file}<EntityLink kind="file" id={f.file} label="{f.file}{f.line ? `:${f.line}` : ''}" mono />{/if}</div>
                  {#if f.message}<pre>{f.message}</pre>{/if}
                </li>
              {/each}
            </ul>
          {/if}
          {#if d.logHidden}
            <p class="faint xs"><Icon name="lock" size={12} /> The raw output is visible to admins only.</p>
          {:else if d.log}
            <details>
              <summary class="xs">Output <span class="faint">(secrets masked, last 128 KB)</span></summary>
              <pre class="log">{d.log}</pre>
            </details>
          {/if}
        </div>
      {/if}
    </section>
  </div>
{/if}

<style>
  .layout { display: grid; grid-template-columns: minmax(220px, 300px) minmax(0, 1fr); gap: 14px; align-items: start; }
  @media (max-width: 760px) { .layout { grid-template-columns: 1fr; } .side { max-height: 260px; overflow: auto; } }
  .side { padding: 6px; }
  .rl { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .dot.ok { background: var(--ok); }
  .dot.err { background: var(--err); }
  .xs { font-size: 11.5px; }
  .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 8px; margin: 0; }
  .meta > div { background: var(--inset); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 6px 10px; }
  dt { font-size: 10.5px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
  dd { margin: 2px 0 0; font-weight: 600; font-size: 13.5px; }
  dd.bad { color: var(--err); }
  .fails { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .fails li { padding: 9px 10px; border-radius: var(--radius-sm); background: var(--err-soft); display: flex; flex-direction: column; gap: 4px; font-size: 13px; min-width: 0; }
  .fails b { overflow-wrap: anywhere; }
  pre { margin: 0; font: 12px/1.45 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-2); }
  .log { max-height: 420px; overflow: auto; background: var(--inset); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px; margin-top: 8px; }
  summary { cursor: pointer; color: var(--text-2); }
  code { font-family: var(--mono); font-size: 0.92em; }
</style>
