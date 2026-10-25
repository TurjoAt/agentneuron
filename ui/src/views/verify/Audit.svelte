<script>
  import { openFile, app } from '../../lib/store.svelte.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import RiskGauge from './RiskGauge.svelte';

  let { res } = $props();

  const SEV = { high: { label: 'High', cls: 'err', icon: 'error' }, medium: { label: 'Medium', cls: 'warn', icon: 'alert' }, low: { label: 'Low', cls: 'info', icon: 'info' }, info: { label: 'Info', cls: 'muted', icon: 'info' } };
  const data = $derived(res.data);
  const tracked = $derived(new Set((app.files || []).map((f) => f.path)));
</script>

{#if res.error}
  <Empty icon="alert" title="Could not run the security audit">{res.error.message}</Empty>
{:else if !data}
  <div class="skel" style="height:280px"></div>
{:else}
  <div class="top">
    <section class="card score">
      <RiskGauge score={data.score} level={data.level} />
      <div class="col" style="gap:6px">
        {#each ['high', 'medium', 'low'] as k (k)}
          <div class="sevrow"><span class="si {SEV[k].cls}"><Icon name={SEV[k].icon} size={13} /></span><span class="grow">{SEV[k].label}</span><b class="tnum">{data.counts[k]}</b></div>
        {/each}
      </div>
    </section>
    <section class="card">
      <div class="card-h">Scanned <span class="sub">project-local agent config</span><span class="spacer"></span><button class="btn sm ghost" onclick={() => res.reload()} aria-label="Re-run the audit"><Icon name="refresh" size={13} /></button></div>
      <div class="card-b scanned">
        {#each data.scanned as f (f)}<span class="chip mono">{f}</span>{:else}<span class="faint small">No MCP, settings or Codex config files found.</span>{/each}
        <p class="faint small">MCP servers (.mcp.json, .cursor, .vscode, .gemini, .roo…), Claude settings, Codex config, hooks, file modes and secrets in context files. Values are always masked.</p>
      </div>
    </section>
  </div>

  {#if !data.findings.length}
    <div class="card"><Empty icon="shield" title="No findings">Nothing risky found in the agent configuration.</Empty></div>
  {:else}
    <div class="col" style="gap:10px">
      {#each data.findings as f (f.id)}
        <section class="card finding">
          <span class="si {SEV[f.severity].cls}"><Icon name={SEV[f.severity].icon} size={14} /></span>
          <div class="col" style="gap:4px;flex:1;min-width:0">
            <div class="row" style="gap:8px;flex-wrap:wrap">
              <b class="title">{f.title}</b>
              {#if tracked.has(f.file)}
                <button class="loc mono" onclick={() => openFile(f.file, f.line ? { line: f.line, tab: 'raw' } : {})}>{f.file}{f.line ? `:${f.line}` : ''}</button>
              {:else}
                <span class="loc mono">{f.file}{f.line ? `:${f.line}` : ''}</span>
              {/if}
            </div>
            <span class="small">{f.why}</span>
            <span class="small fix"><Icon name="wand" size={12} /> {f.fix}</span>
          </div>
        </section>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .top { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 16px; margin-bottom: 16px; }
  .score { display: flex; align-items: center; gap: 28px; padding: 18px 24px; flex-wrap: wrap; }
  .sevrow { display: flex; align-items: center; gap: 10px; min-width: 150px; font-size: 13px; color: var(--text-2); }
  .sevrow b { color: var(--text); }
  .scanned { display: flex; flex-wrap: wrap; gap: 6px; align-items: flex-start; }
  .scanned p { flex-basis: 100%; margin: 6px 0 0; }
  .finding { display: flex; gap: 12px; padding: 14px 16px; align-items: flex-start; }
  .si { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; flex-shrink: 0; }
  .err { background: var(--err-soft); color: var(--err); }
  .warn { background: var(--warn-soft); color: var(--warn); }
  .info { background: var(--info-soft); color: var(--info); }
  .muted { background: var(--panel-hover); color: var(--text-3); }
  .title { font-size: 13.5px; font-weight: 600; word-break: break-word; }
  .loc { border: 0; background: transparent; padding: 0; font-size: 11.5px; color: var(--text-3); }
  button.loc { cursor: pointer; }
  button.loc:hover { color: var(--accent); }
  .small { font-size: 12.5px; color: var(--text-2); }
  .fix { color: var(--accent); display: flex; gap: 6px; align-items: baseline; }
  @media (max-width: 900px) { .top { grid-template-columns: 1fr; } }
</style>
