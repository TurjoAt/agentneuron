<script>
  import { openFile } from '../../lib/store.svelte.js';
  import { fmtBytes, fmtNum } from '../../lib/format.js';
  import Donut from '../../lib/viz/Donut.svelte';
  import Section from './Section.svelte';
  let { stats } = $props();
  let metric = $state('lines');
  const langs = $derived(stats?.languages || []);
  const items = $derived(langs.map((l) => ({ key: l.lang, label: l.lang, value: l[metric] || 0 })));
  const fmt = $derived(metric === 'bytes' ? fmtBytes : fmtNum);
  const largest = $derived((stats?.largest || []).slice(0, 10));
  const dirs = $derived((stats?.dirs || []).slice().sort((a, b) => b.bytes - a.bytes).slice(0, 10));
  const maxDir = $derived(Math.max(1, ...dirs.map((d) => d.bytes)));
  const maxFile = $derived(Math.max(1, ...largest.map((d) => d.bytes)));
  const isMd = (p) => /\.(md|mdx|mdc|markdown)$/i.test(p);
</script>

{#if langs.length}
  <Section id="stats" title="Code stats" icon="code" sub="{fmtNum(stats.totalFiles)} files · {fmtNum(stats.totalLines)} lines">
    {#snippet actions()}
      <div class="segc">{#each [['lines', 'Lines'], ['files', 'Files'], ['bytes', 'Size']] as [v, l] (v)}<button class:on={metric === v} onclick={() => (metric = v)}>{l}</button>{/each}</div>
    {/snippet}
    <div class="g">
      <div class="dn"><Donut {items} format={fmt} centerLabel={metric} max={8} /></div>
      <div class="col">
        {#if largest.length}
          <div class="grp">Largest files</div>
          {#each largest as f (f.path)}
            <div class="br">
              {#if isMd(f.path)}<button class="p mono lk" onclick={() => openFile(f.path, { drawer: true })}>{f.path}</button>{:else}<span class="p mono" title={f.path}>{f.path}</span>{/if}
              <span class="faint tnum">{fmtBytes(f.bytes)}</span>
              <span class="bar"><span style="width:{(f.bytes / maxFile) * 100}%"></span></span>
            </div>
          {/each}
        {/if}
      </div>
      <div class="col">
        {#if dirs.length}
          <div class="grp">Folder sizes</div>
          {#each dirs as f (f.path)}
            <div class="br">
              <span class="p mono" title={f.path}>{f.path}</span>
              <span class="faint tnum">{fmtBytes(f.bytes)} · {fmtNum(f.files)}f</span>
              <span class="bar"><span style="width:{(f.bytes / maxDir) * 100}%"></span></span>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </Section>
{/if}

<style>
  .g { display: grid; grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: start; }
  .grp { font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-3); margin-bottom: 8px; }
  .br { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; margin-bottom: 9px; font-size: 12px; }
  .p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lk { border: 0; background: none; color: var(--text); padding: 0; text-align: left; cursor: pointer; font-size: 12px; } .lk:hover { color: var(--accent); }
  .bar { grid-column: 1 / -1; height: 3px; background: var(--panel-active); border-radius: 3px; overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--accent); opacity: 0.75; }
  @media (max-width: 1000px) { .g { grid-template-columns: minmax(0, 1fr); } .dn { display: flex; justify-content: center; } }
</style>
