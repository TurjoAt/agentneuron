<script>
  import { runAction, actionEnabled } from '../../lib/actions.js';
  import Icon from '../../lib/Icon.svelte';
  import Section from './Section.svelte';

  let { project } = $props();
  const RUNNERS = ['npm', 'pnpm', 'yarn', 'bun', 'composer'];
  let q = $state('');
  const scripts = $derived(project.scripts || []);
  const groups = $derived.by(() => {
    const needle = q.trim().toLowerCase(), g = new Map();
    for (const s of scripts) {
      if (needle && !(s.name + ' ' + s.command).toLowerCase().includes(needle)) continue;
      const k = s.source || s.manager;
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(s);
    }
    return [...g.entries()];
  });
  const en = $derived(actionEnabled('scripts.run'));
  const why = (s) => (!RUNNERS.includes(s.manager) ? `scripts.run does not support the "${s.manager}" runner` : en.enabled ? `Run ${s.manager} ${s.name}` : en.reason);
  const ok = (s) => RUNNERS.includes(s.manager) && en.enabled;
</script>

{#if scripts.length}
  <Section id="scripts" title="Scripts" icon="terminal" sub="{scripts.length} defined">
    {#snippet actions()}<input class="input" type="search" placeholder="Filter…" bind:value={q} aria-label="Filter scripts" style="height:28px;width:150px" />{/snippet}
    {#each groups as [src, list] (src)}
      <div class="src mono">{src}</div>
      <div class="list">
        {#each list as s (s.name)}
          <div class="row">
            <div class="nm"><b class="mono">{s.name}</b><code class="cmd mono" title={s.command}>{s.command}</code></div>
            <button class="btn sm" disabled={!ok(s)} title={why(s)} onclick={() => runAction('scripts.run', { manager: s.manager, name: s.name })}><Icon name="play" size={12} /> Run</button>
          </div>
        {/each}
      </div>
    {/each}
    {#if !groups.length}<p class="faint">No scripts match.</p>{/if}
    {#if !en.enabled}<p class="faint tiny">Run disabled: {en.reason}</p>{/if}
  </Section>
{/if}

<style>
  .src { font-size: 11px; color: var(--text-3); margin: 10px 0 4px; }
  .list { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  .row { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-bottom: 1px solid var(--border); }
  .row:last-child { border-bottom: 0; }
  .row:hover { background: var(--panel-hover); }
  .nm { flex: 1; min-width: 0; display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
  .nm b { font-size: 12.5px; }
  .cmd { font-size: 11.5px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .tiny { font-size: 11px; }
</style>
