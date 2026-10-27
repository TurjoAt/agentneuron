<script>
  // Change impact: graph of changed symbols and what may depend on them, plus the flat "possibly affected" list.
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { openFile } from '../../lib/store.svelte.js';
  import { basename, dirname } from '../../lib/format.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';
  import Skeleton from '../../lib/viz/Skeleton.svelte';
  import ImpactGraph from './ImpactGraph.svelte';
  import { CONF_TONE, plural } from './shared.js';

  let { params = {}, go } = $props();
  const paths = $derived(params.paths || '');
  const base = $derived(params.base || '');
  const res = resource((k) => api('/api/changes/impact', { ...(k.paths ? { paths: k.paths } : {}), ...(k.base ? { base: k.base } : {}) }), { key: () => ({ paths, base }) });
  const d = $derived(res.data);
  let pathsInput = $state('');
  $effect(() => { pathsInput = paths; });
  let conf = $state('all');
  let kind = $state('all');
  let shown = $state(40);
  const affected = $derived(Array.isArray(d?.affected) ? d.affected : []);
  const filtered = $derived(affected.filter((a) => (conf === 'all' || a.confidence === conf) && (kind === 'all' || a.kind === kind)));
  const count = (k, v) => affected.filter((a) => a[k] === v).length;
  const KINDS = [['all', 'All'], ['file', 'Files'], ['test', 'Tests'], ['route', 'Routes'], ['contract', 'Contracts']];
  const ICON = { file: 'file', test: 'check', route: 'globe', contract: 'paperclip' };
  const symbolCount = $derived((d?.changed || []).reduce((n, c) => n + c.symbols.length, 0));
  function apply(e) {
    e.preventDefault();
    go({ paths: pathsInput.trim() || undefined });
  }
</script>

<form class="bar" onsubmit={apply}>
  <label class="faint small" for="im-paths">Files</label>
  <input id="im-paths" class="input mono" placeholder="changed files (or: src/a.ts, src/b.ts)" bind:value={pathsInput} spellcheck="false" autocomplete="off" />
  <button class="btn sm" type="submit">Analyse</button>
  {#if paths}<button class="btn sm ghost" type="button" onclick={() => go({ paths: undefined })}>Use the diff</button>{/if}
</form>

{#if res.error && !d}
  <div class="card"><Empty icon="alert" title="Could not analyse the impact">{res.error.message}</Empty></div>
{:else if !d}
  <section class="card"><div class="card-b pad"><Skeleton kind="chart" height={260} label="Building the import graph" /></div></section>
  <section class="card gap"><div class="card-b pad"><Skeleton kind="table" /></div></section>
{:else if d.available === false}
  <div class="card"><Empty icon="git" title="No git repository">{d.reason}. Pass files explicitly above to analyse them anyway.</Empty></div>
{:else if !d.changed?.length}
  <div class="card"><Empty icon="layers" title="No changed files">Nothing differs from HEAD. Type file paths above to see what depends on them.</Empty></div>
{:else}
  <div class="chips">
    <span class="badge">{plural(d.changed.length, 'changed file')}</span>
    <span class="badge">{plural(symbolCount, 'changed symbol')}</span>
    <span class="badge err">{count('confidence', 'high')} high</span>
    <span class="badge warn">{count('confidence', 'medium')} medium</span>
    <span class="badge info">{count('confidence', 'low')} low confidence</span>
    {#if d.truncated}<span class="badge warn" title="File, node or edge limits were reached">partial</span>{/if}
  </div>

  <section class="card gap">
    <div class="card-h">Impact graph <span class="sub">static imports and name matches; hover a node</span></div>
    <div class="card-b">
      {#if d.nodes.length > 1}
        <ImpactGraph nodes={d.nodes} edges={d.edges} />
      {:else}
        <p class="faint small">No dependents found: nothing imports or mentions the changed code.</p>
      {/if}
    </div>
  </section>

  <div class="two">
    <section class="card gap">
      <div class="card-h">Possibly affected <span class="sub">{filtered.length}</span></div>
      <div class="filters">
        {#each KINDS as [k, label] (k)}
          <button class="chip" class:on={kind === k} onclick={() => (kind = k)}>{label}{#if k !== 'all'} <span class="n">{count('kind', k)}</span>{/if}</button>
        {/each}
        <span class="sep"></span>
        {#each ['all', 'high', 'medium', 'low'] as c (c)}
          <button class="chip" class:on={conf === c} onclick={() => (conf = c)}>{c === 'all' ? 'Any confidence' : c}</button>
        {/each}
      </div>
      {#if !filtered.length}
        <div class="card-b"><p class="faint small">Nothing in this filter.</p></div>
      {:else}
        <ul class="aff">
          {#each filtered.slice(0, shown) as a (a.kind + a.label)}
            <li>
              <span class="badge {CONF_TONE[a.confidence]} xs cf">{a.confidence}</span>
              <span class="ic"><Icon name={ICON[a.kind] || 'dot'} size={13} /></span>
              <div class="grow">
                {#if (a.kind === 'file' || a.kind === 'test') && a.path}
                  <EntityLink kind="file" id={a.path} title={a.path}><span class="bn">{basename(a.path)}</span>{#if dirname(a.path)}<span class="dn faint"> {dirname(a.path)}/</span>{/if}</EntityLink>
                {:else}
                  <span class="mono lbl">{a.label}</span>
                  {#if a.path}<span class="faint tiny"> · <EntityLink kind="file" id={a.path} mono /></span>{/if}
                {/if}
                <div class="faint tiny">{a.via}</div>
              </div>
            </li>
          {/each}
        </ul>
        {#if filtered.length > shown}<div class="card-b"><button class="btn sm" onclick={() => (shown += 60)}>Show {Math.min(60, filtered.length - shown)} more</button></div>{/if}
      {/if}
    </section>

    <section class="card gap side">
      <div class="card-h">Changed symbols</div>
      <ul class="chg">
        {#each d.changed as c (c.path)}
          <li>
            <EntityLink kind="file" id={c.path} title={c.path}><span class="bn">{basename(c.path)}</span></EntityLink>
            <div class="syms">
              {#each c.symbols.slice(0, 14) as s (s.name + s.line)}
                {#if s.removed}
                  <span class="sym removed mono" title="Removed ({s.kind})">{s.name}</span>
                {:else}
                  <button class="sym mono" onclick={() => openFile(c.path, { line: s.line })} title="{s.kind}{s.exported ? ', exported' : ''} at line {s.line}">{s.name}</button>
                {/if}
              {:else}
                <span class="faint tiny">no symbols detected</span>
              {/each}
            </div>
          </li>
        {/each}
      </ul>
    </section>
  </div>
{/if}

<style>
  .bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
  .bar .input { width: 340px; max-width: 100%; height: 30px; font-size: 12.5px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .gap { margin-top: 14px; }
  .pad { padding-top: 14px; }
  .tiny { font-size: 11px; }
  .two { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 14px; align-items: start; }
  .filters { display: flex; flex-wrap: wrap; gap: 5px; padding: 0 14px 10px; align-items: center; }
  .filters .chip { height: 26px; font-size: 12px; }
  .sep { width: 1px; height: 18px; background: var(--border); margin: 0 3px; }
  .aff, .chg { list-style: none; margin: 0; padding: 0 0 8px; }
  .aff li { display: flex; align-items: flex-start; gap: 8px; padding: 7px 14px; border-top: 1px solid var(--border); min-width: 0; }
  .cf { min-width: 56px; justify-content: center; margin-top: 1px; }
  .ic { color: var(--text-3); margin-top: 2px; }
  .bn { font-weight: 600; }
  .dn { font-size: 11.5px; margin-left: 4px; }
  .lbl { overflow-wrap: anywhere; }
  .grow { overflow-wrap: anywhere; }
  .chg li { padding: 8px 14px; border-top: 1px solid var(--border); }
  .syms { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
  .sym { font-size: 11.5px; padding: 1px 7px; border-radius: 6px; background: var(--accent-soft); color: var(--accent); border: 0; cursor: pointer; }
  .sym:hover { text-decoration: underline; }
  .sym.removed { background: var(--err-soft); color: var(--err); text-decoration: line-through; cursor: default; }
  @media (max-width: 900px) { .two { grid-template-columns: minmax(0, 1fr); } .side { order: -1; } }
  @media (max-width: 640px) { .bar .input { flex: 1; width: auto; min-width: 0; } .cf { min-width: 0; } }
</style>
