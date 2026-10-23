<script>
  import Section from './Section.svelte';
  let { project } = $props();
  const CATS = ['testing', 'tool', 'ci'];
  const items = $derived((project.stacks || []).filter((s) => CATS.includes(s.category)));
  const pms = $derived(project.packageManagers || []);
  const cat = { testing: 'Testing', tool: 'Tooling & config', ci: 'CI' };
</script>

{#if items.length || pms.length}
  <Section id="tooling" title="Tooling" icon="settings" sub="detected from config files">
    {#if pms.length}
      <div class="grp">Package managers</div>
      <div class="chips">
        {#each pms as p (p.id)}
          <span class="pill" title={p.manifest}>
            <span class="dot" class:off={!p.available}></span>
            <b>{p.id}</b>
            <span class="faint mono">{p.lockfile || 'no lockfile'}</span>
            {#if !p.available}<span class="warn">not on PATH</span>{/if}
          </span>
        {/each}
      </div>
    {/if}
    {#each CATS as c (c)}
      {#if items.some((s) => s.category === c)}
        <div class="grp">{cat[c]}</div>
        <div class="chips">
          {#each items.filter((s) => s.category === c) as s (s.id)}
            <span class="pill" title={s.source}><b>{s.name}</b>{#if s.version}<span class="faint mono">{s.version}</span>{/if}<span class="faint src">{s.source}</span></span>
          {/each}
        </div>
      {/if}
    {/each}
  </Section>
{/if}

<style>
  .grp { font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-3); margin: 12px 0 6px; }
  .grp:first-child { margin-top: 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .pill { display: inline-flex; align-items: center; gap: 7px; padding: 4px 10px; border: 1px solid var(--border); border-radius: 99px; font-size: 12px; max-width: 100%; }
  .src { font-size: 11px; max-width: 22ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); } .dot.off { background: var(--warn); }
  .warn { color: var(--warn); font-size: 11px; }
</style>
