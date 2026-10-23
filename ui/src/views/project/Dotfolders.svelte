<script>
  import { fmtBytes, fmtNum } from '../../lib/format.js';
  import ToolBadge from '../../lib/ToolBadge.svelte';
  import Section from './Section.svelte';
  let { project } = $props();
  const list = $derived((project.dotfolders || []).slice().sort((a, b) => (!!a.tool === !!b.tool ? a.name.localeCompare(b.name) : a.tool ? -1 : 1)));
  const gen = (d) => /generated|cache|build output/i.test(d.purpose || '');
</script>

{#if list.length}
  <Section id="dotfolders" title="Dot-folders" icon="folder" sub="{list.length} found">
    <div class="cards">
      {#each list as d (d.name)}
        <div class="fc" class:gen={gen(d)}>
          <div class="fn"><span class="mono">{d.name}</span>{#if d.tool}<ToolBadge tool={d.tool} compact />{/if}{#if gen(d)}<span class="tag">generated</span>{/if}</div>
          <div class="pp">{d.purpose || ''}</div>
          <div class="faint small">{fmtNum(d.files)} files · {fmtBytes(d.bytes)}</div>
        </div>
      {/each}
    </div>
  </Section>
{/if}

<style>
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
  .fc { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
  .fc.gen { opacity: 0.7; }
  .fn { font-weight: 650; font-size: 13px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .pp { font-size: 12px; color: var(--text-2); flex: 1; }
  .small { font-size: 11.5px; }
  .tag { font-size: 10px; padding: 1px 6px; border-radius: 99px; background: var(--panel-active); color: var(--text-3); font-weight: 500; }
</style>
