<script>
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { openFile } from '../../lib/store.svelte.js';
  import { fmtNum, timeAgo } from '../../lib/format.js';
  import Tabs from '../../lib/Tabs.svelte';
  import Empty from '../../lib/Empty.svelte';
  import ToolBadge from '../../lib/ToolBadge.svelte';

  let { from, to, by = $bindable('churn'), onby } = $props();

  const tabs = [
    { id: 'churn', label: 'Most changed' },
    { id: 'links', label: 'Most linked' },
    { id: 'stale', label: 'Stalest' },
    { id: 'tokens', label: 'Heaviest' },
  ];
  const rows = resource(() => api('/api/reports/top', { from, to, by }), { key: () => ({ from, to, by }) });
  const list = $derived(Array.isArray(rows.data) ? rows.data : []);
  const maxOf = (k) => Math.max(1, ...list.map((r) => r[k] || 0));
  const main = $derived({ churn: 'changes', links: 'inbound', stale: 'ageDays', tokens: 'tokens' }[by]);
</script>

<section class="card">
  <div class="card-h">
    Top files <span class="sub">click a row to open</span>
    <span class="grow"></span>
    <Tabs {tabs} bind:active={by} onchange={onby} />
  </div>
  <div class="wrap">
    {#if !list.length}
      <Empty icon="files" title={rows.loading ? 'Loading…' : 'No files for this period'} />
    {:else}
      <table class="tbl">
        <thead>
          <tr>
            <th>File</th>
            {#if by === 'churn'}<th class="r">Changes</th><th class="r">+ lines</th><th class="r">− lines</th><th class="r">Last</th>
            {:else if by === 'links'}<th class="r">Inbound</th><th class="r">Outbound</th>
            {:else if by === 'stale'}<th class="r">Age</th><th class="r">Modified</th>
            {:else}<th class="r">Tokens</th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each list as r (r.path)}
            <tr class="click" tabindex="0" onclick={() => openFile(r.path, { drawer: true })} onkeydown={(e) => e.key === 'Enter' && openFile(r.path, { drawer: true })}>
              <td>
                <div class="pc">
                  {#if r.tool}<ToolBadge tool={r.tool} compact />{/if}
                  <span class="mono path">{r.path}</span>
                </div>
                <span class="bar"><span style="width:{Math.round(((r[main] || 0) / maxOf(main)) * 100)}%"></span></span>
              </td>
              {#if by === 'churn'}
                <td class="r tnum">{r.changes}</td><td class="r tnum ok">+{fmtNum(r.added)}</td><td class="r tnum err">−{fmtNum(r.removed)}</td>
                <td class="r faint">{timeAgo(r.lastTs ?? r.last)}</td>
              {:else if by === 'links'}
                <td class="r tnum">{r.inbound}</td><td class="r tnum">{r.outbound}</td>
              {:else if by === 'stale'}
                <td class="r tnum">{r.ageDays}d</td><td class="r faint">{timeAgo(r.mtime)}</td>
              {:else}
                <td class="r tnum">{fmtNum(r.tokens)}</td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</section>

<style>
  .card-h { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .grow { flex: 1; }
  .wrap { max-height: 480px; overflow: auto; }
  .r { text-align: right; white-space: nowrap; }
  tr.click { cursor: pointer; }
  tr.click:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .pc { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .path { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 46ch; }
  .bar { display: block; height: 2px; margin-top: 5px; background: var(--panel-active); border-radius: 2px; overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--accent); opacity: 0.7; }
  .ok { color: var(--ok); }
  .err { color: var(--err); }
</style>
