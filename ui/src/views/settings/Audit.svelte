<script>
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { fmtDate, fmtTime, timeAgo } from '../../lib/format.js';
  import Empty from '../../lib/Empty.svelte';
  import Icon from '../../lib/Icon.svelte';

  const PAGE = 20;
  const audit = resource(() => api('/api/audit', { limit: 1000 }), { live: false });
  let q = $state('');
  let kind = $state('all');
  let status = $state('all');
  let page = $state(0);
  let openRow = $state(null);

  const rows = $derived(Array.isArray(audit.data) ? audit.data : []);
  const label = (r) => r.action || r.route || '—';
  const okStatus = (s) => s === 'ok' || s === 200 || s === 'done' || (typeof s === 'number' && s < 400);
  const filtered = $derived(
    rows.filter((r) => {
      if (kind === 'action' && !r.action) return false;
      if (kind === 'route' && !r.route) return false;
      if (status === 'ok' && !okStatus(r.status)) return false;
      if (status === 'fail' && okStatus(r.status)) return false;
      if (q) {
        const hay = (label(r) + ' ' + (r.role || '') + ' ' + (r.ip || '') + ' ' + JSON.stringify(r.params || {})).toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    })
  );
  const pages = $derived(Math.max(1, Math.ceil(filtered.length / PAGE)));
  const slice = $derived(filtered.slice(page * PAGE, page * PAGE + PAGE));
  $effect(() => { void q; void kind; void status; page = 0; });
  const params = (p) => { try { return JSON.stringify(p ?? {}); } catch { return ''; } };
</script>

<section class="card">
  <div class="card-h">Audit log <span class="sub">{filtered.length} of {rows.length} entries</span><span class="spacer"></span>
    <button class="btn sm ghost icon" aria-label="Reload" onclick={() => audit.reload()}><Icon name="refresh" size={14} /></button>
  </div>
  {#if audit.error}
    <Empty icon="lock" title={audit.error.status === 403 ? 'Admin only' : 'Audit log unavailable'}>{audit.error.message}</Empty>
  {:else if !audit.data}
    <div class="card-b"><div class="skel" style="height:200px"></div></div>
  {:else}
    <div class="card-b filters">
      <input class="input grow" placeholder="Filter by action, role, ip, params…" bind:value={q} aria-label="Filter audit log" />
      <div class="segc" role="group" aria-label="Kind">
        {#each [['all', 'All'], ['action', 'Actions'], ['route', 'Routes']] as [v, l] (v)}<button class:on={kind === v} onclick={() => (kind = v)}>{l}</button>{/each}
      </div>
      <div class="segc" role="group" aria-label="Status">
        {#each [['all', 'Any'], ['ok', 'OK'], ['fail', 'Failed']] as [v, l] (v)}<button class:on={status === v} onclick={() => (status = v)}>{l}</button>{/each}
      </div>
    </div>
    <div class="scroll">
      <table class="tbl">
        <thead><tr><th>When</th><th>What</th><th>Role</th><th>Status</th><th class="hide">IP</th></tr></thead>
        <tbody>
          {#each slice as r, i (r.ts + label(r) + i)}
            <tr class="clk" onclick={() => (openRow = openRow === r ? null : r)}>
              <td class="nw" title={fmtDate(r.ts)}>{fmtTime(r.ts)} <span class="faint tiny">{timeAgo(r.ts)}</span></td>
              <td><span class="mono small">{label(r)}</span>{#if params(r.params) !== '{}'}<div class="faint tiny ellipsis pp">{params(r.params)}</div>{/if}</td>
              <td>{r.role || '—'}</td>
              <td><span class="badge {okStatus(r.status) ? 'ok' : 'err'}">{r.status}</span></td>
              <td class="hide mono faint small">{r.ip}</td>
            </tr>
            {#if openRow === r}
              <tr><td colspan="5"><pre class="det">{JSON.stringify(r, null, 2)}</pre></td></tr>
            {/if}
          {:else}
            <tr><td colspan="5" class="faint" style="padding:18px">No entries match.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="card-b pager">
      <button class="btn sm" disabled={page === 0} onclick={() => page--}>Previous</button>
      <span class="faint small">Page {page + 1} / {pages}</span>
      <button class="btn sm" disabled={page >= pages - 1} onclick={() => page++}>Next</button>
    </div>
  {/if}
</section>

<style>
  .filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .filters .input { min-width: 180px; }
  .scroll { overflow-x: auto; }
  .nw { white-space: nowrap; }
  .clk { cursor: pointer; }
  .pp { max-width: 420px; font-family: var(--mono); }
  .small { font-size: 12.5px; }
  .tiny { font-size: 11px; }
  .det { margin: 0; padding: 10px; font-family: var(--mono); font-size: 11.5px; background: var(--inset); border-radius: 8px; overflow-x: auto; }
  .pager { display: flex; justify-content: center; align-items: center; gap: 12px; }
  @media (max-width: 640px) { .hide { display: none; } }
</style>
