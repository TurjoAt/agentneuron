<script>
  // Detected checks with their last result and Run buttons (exec level; disabled with how-to-enable otherwise).
  import Icon from '../../lib/Icon.svelte';
  import { runAction } from '../../lib/actions.js';
  import { timeAgo } from '../../lib/format.js';
  import { navigate } from '../../lib/store.svelte.js';

  let { checks = [], run = null, onran } = $props();
  let busy = $state(null); // check id or 'all'
  const enabled = $derived(!!run?.enabled);
  const reason = $derived(run?.reason || '');

  async function start(ids, key) {
    if (!enabled || busy) return;
    busy = key;
    try {
      await runAction('ship.verify.run', { checks: ids }, { title: ids.length === 1 ? `Run ${checks.find((c) => c.id === ids[0])?.label || ids[0]}` : 'Run all checks', description: 'Runs the command without a shell (CI=1) and stores the parsed result.' });
    } finally {
      busy = null;
      onran?.();
    }
  }
  const tone = (c) => (c.status === 'failed' ? 'err' : c.status === 'passed' ? (c.stale ? 'warn' : 'ok') : '');
</script>

<section class="card" aria-labelledby="ship-checks">
  <div class="card-h" id="ship-checks">
    <Icon name="play" size={14} /> Checks
    <span class="sub">{checks.length ? `${checks.length} detected` : ''}</span>
    <span class="spacer"></span>
    {#if checks.length > 1}
      <button class="btn sm" disabled={!enabled || !!busy} title={enabled ? 'Run every detected check' : reason} onclick={() => start(checks.map((c) => c.id), 'all')}>
        <Icon name={busy === 'all' ? 'refresh' : 'play'} size={12} /> Run all
      </button>
    {/if}
  </div>
  <div class="card-b">
    {#if !checks.length}
      <p class="faint small">No <code>test</code>, <code>build</code>, <code>lint</code> or <code>typecheck</code> script, pytest, go or cargo project found. Add a script to package.json (or composer.json) and it shows up here.</p>
    {:else}
      <ul class="list">
        {#each checks as c (c.id)}
          <li class={tone(c)}>
            <span class="kind badge">{c.kind}</span>
            <div class="col grow body">
              <div class="row top">
                <b class="ellipsis">{c.label}</b>
                {#if c.status === 'passed'}<span class="badge {c.stale ? 'warn' : 'ok'}">{c.stale ? 'stale' : 'passed'}</span>
                {:else if c.status === 'failed'}<span class="badge err">failed</span>
                {:else}<span class="badge">never run</span>{/if}
              </div>
              <span class="mono faint ellipsis" title={c.script || c.command}>{c.source}{c.script ? ` · ${c.script}` : ''}</span>
              {#if c.last}
                <button class="last" onclick={() => navigate('ship', { tab: 'runs', run: c.last.id })} title="Open this run">
                  <span class="tnum">{c.last.passed} passed</span>{#if c.last.failed}<span class="tnum bad">&nbsp;· {c.last.failed} failed</span>{/if}{#if c.last.skipped}<span class="tnum">&nbsp;· {c.last.skipped} skipped</span>{/if}
                  <span class="faint">&nbsp;· {timeAgo(c.last.endedAt)}</span>
                </button>
              {/if}
            </div>
            <button class="btn sm" disabled={!enabled || !!busy} title={enabled ? `Run ${c.label}` : reason} aria-label="Run {c.label}" onclick={() => start([c.id], c.id)}>
              <Icon name={busy === c.id ? 'refresh' : 'play'} size={12} /><span class="rl">Run</span>
            </button>
          </li>
        {/each}
      </ul>
      {#if !enabled && reason}
        <p class="hint"><Icon name="lock" size={12} /> Running checks is off: {reason}. <span class="faint">Or run <code>agentneuron ship --run</code> in a terminal.</span></p>
      {/if}
    {/if}
  </div>
</section>

<style>
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  li { display: flex; align-items: flex-start; gap: 10px; padding: 9px 10px; border-radius: var(--radius-sm); background: var(--inset); border: 1px solid var(--border); border-left: 3px solid var(--border-strong); min-width: 0; }
  li.ok { border-left-color: var(--ok); }
  li.err { border-left-color: var(--err); }
  li.warn { border-left-color: var(--warn); }
  .kind { text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; margin-top: 1px; }
  .body { gap: 2px; }
  .top { gap: 8px; }
  .mono { font-size: 11.5px; }
  .last { all: unset; cursor: pointer; font-size: 12px; color: var(--text-2); }
  .last:hover { color: var(--accent); }
  .last:focus-visible { outline: 2px solid var(--accent); border-radius: 4px; }
  .bad { color: var(--err); }
  .hint { margin: 10px 0 0; font-size: 12px; color: var(--text-2); display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
  .small { font-size: 12.5px; }
  code { font-family: var(--mono); font-size: 0.92em; }
  @media (max-width: 420px) { .rl { display: none; } }
</style>
