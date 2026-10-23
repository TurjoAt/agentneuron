<script>
  import { api } from '../lib/api.js';
  import { app, navigate, openFile } from '../lib/store.svelte.js';
  import { resource } from '../lib/resource.svelte.js';
  import { TOOLS, CONTEXT_TOOLS } from '../lib/tools.js';
  import { fmtNum } from '../lib/format.js';
  import Markdown from '../lib/Markdown.svelte';
  import Counter from '../lib/Counter.svelte';
  import TokenBar from '../lib/TokenBar.svelte';
  import Tabs from '../lib/Tabs.svelte';
  import Icon from '../lib/Icon.svelte';
  import Empty from '../lib/Empty.svelte';

  let { params = {} } = $props();

  const dir = $derived(params.dir ?? '');
  const tool = $derived(CONTEXT_TOOLS.includes(params.tool) ? params.tool : 'claude');
  let budget = $state(10000);
  let mode = $state('preview');

  const dirs = resource(() => api('/api/context/dirs'), { live: false });
  const ctx = resource((k) => api('/api/context', k), { key: () => ({ dir, tool }) });

  const dirList = $derived(Array.isArray(dirs.data) ? [...new Set(['', ...dirs.data])].sort() : ['']);
  const chain = $derived(ctx.data?.chain || []);
  const total = $derived(ctx.data?.tokens ?? chain.reduce((a, c) => a + (c.tokens || 0), 0));
  const maxTok = $derived(Math.max(1, ...chain.map((c) => c.tokens || 0)));
  const pct = $derived(Math.min(100, (total / budget) * 100));
  const level = $derived(total > budget ? 'err' : total > budget * 0.6 ? 'warn' : 'ok');

  const REASON = { root: 'root', ancestor: 'ancestor', import: '@import', rule: 'rule' };
  const set = (p) => navigate('context', { dir, tool, ...p });
</script>

<div class="page">
  <div class="page-h">
    <div>
      <h1>Effective context</h1>
      <p>What an agent actually loads when it starts in a folder — merged chain, imports and token budget.</p>
    </div>
  </div>

  <div class="layout">
    <aside class="card dirs">
      <div class="card-h">Folder</div>
      <div class="dl">
        {#each dirList as d (d)}
          <button class="list-row drow" class:active={d === dir} onclick={() => set({ dir: d })} style="--d:{d ? d.split('/').length : 0}">
            <Icon name="folder" size={14} />
            <span class="mono ellipsis">{d ? d.split('/').pop() : '(project root)'}</span>
          </button>
        {/each}
      </div>
    </aside>

    <div class="main col" style="gap:16px">
      <div class="toolbar">
        {#each CONTEXT_TOOLS as t (t)}
          <button class="chip" class:on={t === tool} style="--c:var(--tool-{t})" onclick={() => set({ tool: t })}>
            <span class="tool-dot"></span>{TOOLS[t].label}
          </button>
        {/each}
      </div>

      <section class="card meter {level}">
        <div class="mh">
          <div>
            <div class="eyebrow">{TOOLS[tool].label} · <span class="mono">{dir || '/'}</span></div>
            <div class="tot"><Counter value={total} /> <span>tokens loaded before the first prompt</span></div>
          </div>
          <span class="spacer"></span>
          <label class="row small muted">
            Budget
            <select class="input sm" bind:value={budget}>
              {#each [2000, 5000, 10000, 25000, 50000] as b (b)}<option value={b}>{fmtNum(b)}</option>{/each}
            </select>
          </label>
        </div>
        <div class="bar" role="meter" aria-valuemin="0" aria-valuemax={budget} aria-valuenow={total} aria-label="Token budget">
          {#each chain as c, i (c.path)}
            <span
              class="seg"
              style="width:{Math.min(100, ((c.tokens || 0) / Math.max(budget, total)) * 100)}%;--c:var(--tool-{tool})"
              title="{c.path}: {c.tokens} tokens"
            ></span>
          {/each}
          {#if total <= budget}<span class="mark" style="left:{(budget / Math.max(budget, total)) * 100}%"></span>{/if}
        </div>
        <div class="row small faint">
          <span>{pct.toFixed(0)}% of budget</span>
          <span>·</span>
          <span>{((total / 200000) * 100).toFixed(1)}% of a 200k window</span>
          {#if level === 'err'}<span class="spacer"></span><span class="badge err">over budget</span>{/if}
        </div>
      </section>

      <section class="card">
        <div class="card-h">Load chain <span class="sub">{chain.length} files, in load order</span></div>
        <div class="card-b">
          {#if ctx.error}
            <Empty icon="alert" title="Could not compute context">{ctx.error.message}</Empty>
          {:else if !ctx.data}
            <div class="skel" style="height:120px"></div>
          {:else if !chain.length}
            <Empty icon="layers" title="Nothing loaded">No {TOOLS[tool].label} context files apply to this folder.</Empty>
          {:else}
            <ol class="chain">
              {#each chain as c, i (c.path)}
                <li class="fade-up" style="animation-delay:{i * 40}ms">
                  <span class="idx tnum">{i + 1}</span>
                  <div class="grow col" style="gap:5px">
                    <div class="row">
                      <button class="lnk mono ellipsis" onclick={() => openFile(c.path, { drawer: true })}>{c.path}</button>
                      <span class="badge {c.reason === 'import' ? 'accent' : ''}">{REASON[c.reason] || c.reason}</span>
                      <span class="spacer"></span>
                      <b class="tnum small">{fmtNum(c.tokens)}</b>
                    </div>
                    <TokenBar value={c.tokens} max={maxTok} {tool} height={5} />
                  </div>
                </li>
              {/each}
            </ol>
          {/if}
        </div>
      </section>

      {#if ctx.data?.text}
        <section class="card">
          <div class="card-h">
            Merged context
            <span class="spacer"></span>
            <Tabs tabs={[{ id: 'preview', label: 'Preview' }, { id: 'raw', label: 'Raw' }]} bind:active={mode} />
          </div>
          <div class="card-b">
            {#if mode === 'preview'}
              <Markdown source={ctx.data.text} path={dir ? dir + '/_' : '_'} />
            {:else}
              <pre class="raw mono">{ctx.data.text}</pre>
            {/if}
          </div>
        </section>
      {/if}
    </div>
  </div>
</div>

<style>
  .layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 16px; align-items: start; }
  .dirs { position: sticky; top: calc(var(--topbar-h) + 16px); }
  .dl { padding: 0 8px 10px; display: flex; flex-direction: column; gap: 1px; max-height: 60vh; overflow: auto; }
  .drow { padding-left: calc(10px + var(--d) * 12px); font-size: 12.5px; color: var(--text-2); }
  .drow.active { color: var(--text); box-shadow: inset 2px 0 0 var(--accent); }
  .toolbar { display: flex; gap: 6px; flex-wrap: wrap; }
  .meter { padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
  .mh { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
  .tot { font-size: 30px; font-weight: 700; letter-spacing: -0.03em; }
  .tot span { font-size: 13px; font-weight: 500; color: var(--text-3); letter-spacing: 0; }
  .input.sm { height: 28px; font-size: 12px; }
  .bar { position: relative; display: flex; gap: 2px; height: 14px; border-radius: 99px; background: var(--panel-active); overflow: hidden; }
  .seg { height: 100%; background: var(--c); opacity: 0.85; transition: width 0.7s var(--ease); }
  .seg:nth-child(even) { opacity: 0.6; }
  .meter.warn .seg { background: linear-gradient(90deg, var(--c), var(--warn)); }
  .meter.err .seg { background: linear-gradient(90deg, var(--c), var(--err)); }
  .mark { position: absolute; top: -2px; bottom: -2px; width: 2px; background: var(--text-2); border-radius: 2px; }
  .small { font-size: 12px; }
  .chain { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
  .chain li { display: flex; gap: 12px; align-items: flex-start; }
  .idx { width: 24px; height: 24px; border-radius: 8px; display: grid; place-items: center; background: var(--panel-active); font-size: 11.5px; font-weight: 700; color: var(--text-2); flex-shrink: 0; }
  .lnk { border: 0; background: none; padding: 0; color: var(--text); cursor: pointer; font-size: 12.5px; font-weight: 600; text-align: left; }
  .lnk:hover { color: var(--accent); }
  .raw { white-space: pre-wrap; font-size: 12.5px; line-height: 1.6; margin: 0; max-height: 70vh; overflow: auto; }
  @media (max-width: 860px) {
    .layout { grid-template-columns: 1fr; }
    .dirs { position: static; }
    .dl { flex-direction: row; overflow-x: auto; max-height: none; }
    .drow { padding-left: 10px; width: auto; flex-shrink: 0; }
  }
</style>
