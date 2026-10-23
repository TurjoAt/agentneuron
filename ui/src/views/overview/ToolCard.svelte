<script>
  import { navigate, openFile } from '../../lib/store.svelte.js';
  import { fmtNum } from '../../lib/format.js';
  import Meter from '../../lib/viz/Meter.svelte';
  import Icon from '../../lib/Icon.svelte';
  import { CAPS, toolKey, itemPath } from '../agents/shared.js';

  let { tool, tokens = 0, budget = 12000, issues = { error: 0, warn: 0 } } = $props();
  const c = $derived(`var(--tool-${toolKey(tool.id)})`);
  const have = $derived(CAPS.filter((k) => tool.capabilities?.[k.id]?.count > 0));
  const state = $derived(issues.error ? 'err' : issues.warn ? 'warn' : 'ok');

  function pip(e, cap) {
    e.stopPropagation();
    const first = tool.capabilities?.[cap.id]?.items?.[0];
    const p = itemPath(first);
    if (p && !p.startsWith('~')) openFile(p, { drawer: true });
    else navigate('agents', { tab: 'tools', tool: tool.id });
  }
  const open = () => navigate('agents', { tab: 'tools', tool: tool.id });
</script>

<div class="tc card" role="link" tabindex="0" style="--c:{c}" onclick={open} onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open())}>
  <div class="h">
    <span class="dot"></span>
    <b class="nm">{tool.name}</b>
    <span class="spacer"></span>
    <span class="hl {state}" title="{issues.error} errors · {issues.warn} warnings in this tool's files">
      <Icon name={state === 'ok' ? 'check' : 'alert'} size={12} />
      {state === 'ok' ? 'healthy' : issues.error ? `${issues.error} err` : `${issues.warn} warn`}
    </span>
  </div>
  <div class="pips" role="group" aria-label="Capabilities">
    {#each CAPS as cap (cap.id)}
      {@const n = tool.capabilities?.[cap.id]?.count || 0}
      <button class="pip" class:on={n > 0} disabled={!n} title={n ? `${cap.label}: ${n}` : `${cap.label}: none`} aria-label="{cap.label}: {n}" onclick={(e) => pip(e, cap)}>
        <Icon name={cap.icon} size={13} />
        {#if n > 1}<i class="tnum">{n}</i>{/if}
      </button>
    {/each}
  </div>
  <div class="meta small">
    <span class="muted"><b class="tnum">{tool.files?.length || 0}</b> files</span>
    <span class="faint">·</span>
    <span class="muted">{have.length}/{CAPS.length} capabilities</span>
  </div>
  <Meter value={tokens} {budget} color={c} />
</div>

<style>
  .tc { padding: 14px 16px; display: flex; flex-direction: column; gap: 11px; cursor: pointer; min-width: 0; transition: border-color 0.2s, transform 0.2s var(--ease); }
  .tc:hover { border-color: color-mix(in srgb, var(--c) 45%, var(--border)); transform: translateY(-1px); }
  .tc:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .h { display: flex; align-items: center; gap: 8px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--c); box-shadow: 0 0 10px color-mix(in srgb, var(--c) 60%, transparent); }
  .nm { font-size: 14px; letter-spacing: -0.01em; }
  .hl { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; }
  .hl.ok { color: var(--ok); }
  .hl.warn { color: var(--warn); }
  .hl.err { color: var(--err); }
  .pips { display: flex; flex-wrap: wrap; gap: 5px; }
  .pip { position: relative; width: 26px; height: 26px; border-radius: 8px; border: 1px solid var(--border); background: transparent; color: var(--text-3); opacity: 0.45; display: grid; place-items: center; cursor: default; padding: 0; }
  .pip.on { opacity: 1; color: var(--c); background: color-mix(in srgb, var(--c) 12%, transparent); border-color: color-mix(in srgb, var(--c) 30%, transparent); cursor: pointer; }
  .pip.on:hover { background: color-mix(in srgb, var(--c) 22%, transparent); }
  .pip i { position: absolute; top: -5px; right: -4px; font-style: normal; font-size: 9.5px; font-weight: 700; min-width: 14px; height: 14px; border-radius: 7px; background: var(--panel-solid); border: 1px solid var(--border-strong); color: var(--text); display: grid; place-items: center; }
  .meta { display: flex; gap: 6px; align-items: center; }
  .small { font-size: 12px; }
</style>
