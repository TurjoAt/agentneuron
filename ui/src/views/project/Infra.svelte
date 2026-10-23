<script>
  import { openFile } from '../../lib/store.svelte.js';
  import Section from './Section.svelte';
  let { project } = $props();
  const d = $derived(project.docker || { files: [], services: [] });
  const ci = $derived(project.ci || []);
  const deploy = $derived((project.stacks || []).filter((s) => s.category === 'infra' && !/docker/i.test(s.id + s.name)));
  const has = $derived(d.services?.length || d.files?.length || ci.length || deploy.length);
</script>

{#if has}
  <Section id="infra" title="Infrastructure" icon="server" sub="Docker · CI · deploy">
    {#if d.services?.length}
      <div class="grp">Docker services <span class="faint">{(d.files || []).join(', ')}</span></div>
      <div class="cards">
        {#each d.services as s (s.name)}
          <div class="fc">
            <div class="fn mono">{s.name}</div>
            <div class="faint mono small">{s.image || (s.build ? `build: ${s.build}` : '—')}</div>
            {#if s.ports?.length}<div class="ports">{#each s.ports as p (p)}<span class="port mono">{p}</span>{/each}</div>{/if}
          </div>
        {/each}
      </div>
    {:else if d.files?.length}
      <div class="grp">Docker files</div>
      <div class="faint mono small">{d.files.join(', ')}</div>
    {/if}
    {#if ci.length}
      <div class="grp">CI workflows</div>
      <div class="cards">
        {#each ci as c (c.path)}
          <button class="fc btn-like" onclick={() => openFile(c.path, { drawer: true })} title="Open {c.path}">
            <div class="fn">{c.name || c.path}<span class="faint small"> · {c.provider}</span></div>
            {#if c.triggers?.length}<div class="faint small">on: {c.triggers.join(', ')}</div>{/if}
            {#if c.jobs?.length}<div class="ports">{#each c.jobs as j (j)}<span class="port">{j}</span>{/each}</div>{/if}
          </button>
        {/each}
      </div>
    {/if}
    {#if deploy.length}
      <div class="grp">Deploy targets</div>
      <div class="ports">{#each deploy as s (s.id)}<span class="port" title={s.source}>{s.name}{s.version ? ` ${s.version}` : ''}</span>{/each}</div>
    {/if}
  </Section>
{/if}

<style>
  .grp { font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-3); margin: 14px 0 6px; display: flex; gap: 8px; flex-wrap: wrap; text-transform: none; letter-spacing: 0; }
  .grp:first-child { margin-top: 0; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; }
  .fc { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; text-align: left; background: transparent; color: inherit; font: inherit; }
  .btn-like { cursor: pointer; } .btn-like:hover { background: var(--panel-hover); }
  .fn { font-weight: 650; font-size: 13px; }
  .small { font-size: 11.5px; }
  .ports { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 6px; }
  .port { font-size: 11px; padding: 1px 7px; border-radius: 6px; background: var(--panel-active); color: var(--text-2); }
</style>
