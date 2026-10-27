<script>
  // Warnings: test a command / paths / task against the active rules (live), and list the rules with sources.
  import { untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';
  import Evidence from './Evidence.svelte';

  let { params = {} } = $props();
  let command = $state(untrack(() => params.command || ''));
  let paths = $state(untrack(() => params.paths || ''));
  let task = $state('');
  let q = $state(untrack(() => ({ command: params.command || '', paths: params.paths || '', task: '' })));
  let timer;
  $effect(() => {
    const v = { command: command.trim(), paths: paths.trim(), task: task.trim() };
    clearTimeout(timer);
    timer = setTimeout(() => (q = v), 300);
    return () => clearTimeout(timer);
  });
  const empty = $derived(!q.command && !q.paths && !q.task);
  const check = resource(([c, p, t]) => api('/api/brief/warnings', { command: c || undefined, paths: p || undefined, task: t || undefined }), { key: () => [q.command, q.paths, q.task], live: false, enabled: () => !empty });
  const rules = resource(() => api('/api/brief/rules'));
  const warnings = $derived(empty ? [] : check.data?.warnings || []);
  const ruleList = $derived(rules.data?.rules || []);
  let filter = $state('all');
  const KINDS = [['all', 'All'], ['fact', 'Repo facts'], ['rule', 'Context rules'], ['lesson', 'Accepted lessons'], ['history', 'History'], ['builtin', 'Built-in']];
  const shown = $derived(ruleList.filter((r) => filter === 'all' || r.source?.kind === filter));
  const SEV = { block: ['err', 'Blocks'], warn: ['warn', 'Warns'], info: ['info', 'Info'] };
  const EXAMPLES = [['npm install lodash', ''], ['', '.env,dist/app.js'], ['git push --force origin main', '']];
  const setEx = ([c, p]) => { command = c; paths = p; task = ''; };
  const srcLabel = (s) => ({ fact: 'repo fact', rule: 'context rule', lesson: 'accepted lesson', history: 'session history', builtin: 'built-in' }[s?.kind] || s?.kind || '');
</script>

<div class="grid">
  <section class="card tester" aria-label="Test an action">
    <div class="card-h">Test an action<span class="sub">what an agent is about to do</span></div>
    <div class="card-b form">
      <label class="fl"><span>Command</span><input class="input mono" placeholder="e.g. npm install lodash" bind:value={command} spellcheck="false" autocomplete="off" /></label>
      <label class="fl"><span>Paths <em class="muted">(comma separated)</em></span><input class="input mono" placeholder="e.g. src/gen/schema.ts,.env" bind:value={paths} spellcheck="false" autocomplete="off" /></label>
      <label class="fl"><span>Task <em class="muted">(optional)</em></span><input class="input" placeholder="e.g. upgrade the test runner" bind:value={task} /></label>
      <div class="ex">
        <span class="muted">Try:</span>
        {#each EXAMPLES as e, i (i)}<button class="chip" onclick={() => setEx(e)}>{e[0] || e[1]}</button>{/each}
      </div>

      <div class="result" aria-live="polite">
        {#if empty}
          <p class="muted small">Type a command or paths: matching warnings appear here. Agents get the same check through the <code>preflight_check</code> MCP tool or <code>agentneuron preflight</code>.</p>
        {:else if check.error}
          <Empty compact icon="alert" title="Check failed">{check.error.message}</Empty>
        {:else if check.data === undefined}
          <div class="skel-rows"><div class="skel"></div><div class="skel"></div></div>
        {:else if !warnings.length}
          <div class="verdict ok"><Icon name="check" size={16} />No warnings for this action.</div>
        {:else}
          <div class="verdict {check.data.blocking ? 'err' : 'warn'}"><Icon name={check.data.blocking ? 'stop' : 'alert'} size={16} />{check.data.blocking ? 'Blocked: preflight exits with code 2' : `${warnings.length} warning${warnings.length === 1 ? '' : 's'}`}</div>
          <ul class="warns">
            {#each warnings as w, i (w.id + i)}
              <li class="warn-card {SEV[w.severity]?.[0]}">
                <div class="wh"><span class="badge {SEV[w.severity]?.[0]}">{SEV[w.severity]?.[1]}</span><strong>{w.title}</strong></div>
                <p class="why">{w.why}</p>
                {#if w.fix}<p class="fix"><Icon name="wand" size={12} />{w.fix}</p>{/if}
                <div class="src"><span class="muted">{srcLabel(w.source)}</span>{#if w.source?.file}<EntityLink kind="file" id={w.source.file} label={`${w.source.file}${w.source.line ? `:${w.source.line}` : ''}`} mono />{/if}<Evidence evidence={w.evidence} /></div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </section>

  <section class="card" aria-label="Active warning rules">
    <div class="card-h">Active rules<span class="sub">{ruleList.length} rule{ruleList.length === 1 ? '' : 's'}</span></div>
    <div class="card-b">
      <div class="chips" role="group" aria-label="Rule source">
        {#each KINDS as [k, l] (k)}<button class="chip" class:on={filter === k} aria-pressed={filter === k} onclick={() => (filter = k)}>{l}<span class="n">{k === 'all' ? ruleList.length : ruleList.filter((r) => r.source?.kind === k).length}</span></button>{/each}
      </div>
      {#if rules.error && !rules.data}
        <Empty compact icon="alert" title="Could not load rules">{rules.error.message}</Empty>
      {:else if rules.data === undefined}
        <div class="skel-rows"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>
      {:else if !shown.length}
        <Empty compact icon="shield" title="No rules here">Add "Never edit …" or "Use pnpm, not npm" rules to CLAUDE.md / AGENTS.md, or accept lessons in <a href="#/insights?tab=lessons">Insights</a>.</Empty>
      {:else}
        <ul class="rules">
          {#each shown as r (r.id)}
            <li>
              <span class="badge {SEV[r.severity]?.[0]}">{r.severity}</span>
              <div class="rt">
                <div class="rtt">{r.title}</div>
                <div class="rmeta"><span class="muted">{srcLabel(r.source)} · applies to {r.applies}</span>{#if r.source?.file}<EntityLink kind="file" id={r.source.file} label={`${r.source.file}${r.source.line ? `:${r.source.line}` : ''}`} mono />{/if}<Evidence evidence={r.evidence} max={2} /></div>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
      <details class="hook">
        <summary>Block mistakes automatically (Claude Code hook)</summary>
        <p class="small muted">Add this to <code>.claude/settings.json</code> yourself; AgentNeuron never installs hooks. A blocking warning exits with code 2, which stops the tool call and shows the reason to the agent. Details in <code>docs/brief.md</code>.</p>
        <pre class="code">{`{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash|Edit|Write|MultiEdit",
        "hooks": [{ "type": "command", "command": "npx agentneuron preflight" }] }
    ]
  }
}`}</pre>
      </details>
    </div>
  </section>
</div>

<style>
  .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: start; }
  @media (max-width: 980px) { .grid { grid-template-columns: minmax(0, 1fr); } }
  .form { display: flex; flex-direction: column; gap: 10px; }
  .fl { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 550; color: var(--text-2); }
  .fl em { font-style: normal; font-weight: 400; }
  .fl .input { width: 100%; }
  .ex { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12px; }
  .ex .chip { font-family: var(--mono); font-size: 11px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .result { margin-top: 4px; min-height: 60px; }
  .verdict { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: var(--radius-xs); font-weight: 600; font-size: 13px; margin-bottom: 8px; }
  .verdict.ok { background: var(--ok-soft); color: var(--ok); }
  .verdict.warn { background: var(--warn-soft); color: var(--warn); }
  .verdict.err { background: var(--err-soft); color: var(--err); }
  .warns, .rules { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .warn-card { padding: 10px 12px; border-radius: var(--radius-xs); border: 1px solid var(--border); border-left: 3px solid var(--border-strong); background: var(--inset); min-width: 0; }
  .warn-card.err { border-left-color: var(--err); }
  .warn-card.warn { border-left-color: var(--warn); }
  .warn-card.info { border-left-color: var(--info); }
  .wh { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; font-size: 13px; overflow-wrap: anywhere; }
  .why, .fix { margin: 4px 0 0; font-size: 12px; color: var(--text-2); overflow-wrap: anywhere; }
  .fix { display: flex; gap: 6px; align-items: baseline; color: var(--text); }
  .src, .rmeta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; font-size: 12px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .rules li { display: flex; gap: 8px; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid var(--border); }
  .rules li:last-child { border-bottom: 0; }
  .rt { min-width: 0; flex: 1; }
  .rtt { font-size: 13px; overflow-wrap: anywhere; }
  .hook { margin-top: 12px; font-size: 13px; }
  .hook summary { cursor: pointer; font-weight: 550; }
  .code { margin: 8px 0 0; padding: 10px; border-radius: var(--radius-xs); background: var(--inset); border: 1px solid var(--border); font-family: var(--mono); font-size: 11.5px; overflow-x: auto; white-space: pre; }
  .small { font-size: 12px; margin: 6px 0 0; }
</style>
