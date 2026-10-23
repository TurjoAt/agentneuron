<script>
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { runAction, actionEnabled } from '../../lib/actions.js';
  import { openFile } from '../../lib/store.svelte.js';
  import { timeAgo } from '../../lib/format.js';
  import Icon from '../../lib/Icon.svelte';
  import Section from './Section.svelte';

  let { project } = $props();
  const fw = $derived(Object.entries(project.framework || {}).filter(([, v]) => v && typeof v === 'object'));
  const laravel = $derived(project.framework?.laravel || null);

  const routes = resource(() => api('/api/project/routes').catch(() => []), { key: () => !!laravel, enabled: () => !!laravel, live: false });
  const migs = resource(() => api('/api/project/migrations').catch(() => []), { key: () => !!laravel, enabled: () => !!laravel, live: false });
  const rs = $derived(Array.isArray(routes.data) ? routes.data : []);
  const ms = $derived(Array.isArray(migs.data) ? migs.data : []);

  let q = $state('');
  let method = $state('ALL');
  let showAll = $state(false);
  let tab = $state('routes');
  const methods = $derived(['ALL', ...new Set(rs.map((r) => r.method))]);
  const fr = $derived.by(() => {
    const n = q.trim().toLowerCase();
    return rs.filter((r) => (method === 'ALL' || r.method === method) && (!n || `${r.uri} ${r.action} ${r.name || ''}`.toLowerCase().includes(n)));
  });
  const shown = $derived(showAll ? fr : fr.slice(0, 40));
  const art = (cmd) => actionEnabled('framework.artisan');
  const label = (k) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
  const facts = (o) => Object.entries(o).filter(([, v]) => v != null && v !== '' && typeof v !== 'object');
  const mcls = (m) => ({ GET: 'info', POST: 'ok', PUT: 'warn', PATCH: 'warn', DELETE: 'err' })[m] || '';
</script>

{#if fw.length}
  <Section id="frameworks" title="Frameworks" icon="layers" sub={fw.map(([k]) => k).join(' · ')}>
    <div class="cards">
      {#each fw as [name, o] (name)}
        <div class="fc">
          <div class="fn">{name}{#if o.version}<span class="faint mono"> {o.version}</span>{/if}</div>
          <dl>
            {#each facts(o).filter(([k]) => k !== 'version') as [k, v] (k)}<dt>{label(k)}</dt><dd class="mono">{v}</dd>{/each}
          </dl>
        </div>
      {/each}
    </div>

    {#if laravel}
      <div class="lh">
        <div class="segc">
          <button class:on={tab === 'routes'} onclick={() => (tab = 'routes')}>Routes {rs.length || ''}</button>
          <button class:on={tab === 'migrations'} onclick={() => (tab = 'migrations')}>Migrations {ms.length || ''}</button>
        </div>
        <span class="grow"></span>
        {#each [['route:list', 'Route list'], ['migrate:status', 'Migrate status'], ['about', 'About']] as [cmd, l] (cmd)}
          <button class="btn sm" disabled={!art().enabled} title={art().reason || `php artisan ${cmd}`} onclick={() => runAction('framework.artisan', { command: cmd })}><Icon name="terminal" size={12} /> {l}</button>
        {/each}
      </div>

      {#if tab === 'routes' && rs.length}
        <div class="bar">
          <input class="input" type="search" placeholder="Search URI, action, name…" bind:value={q} aria-label="Search routes" />
          <div class="segc">{#each methods as m (m)}<button class:on={method === m} onclick={() => (method = m)}>{m}</button>{/each}</div>
        </div>
        <div class="tw">
          <table class="tbl">
            <thead><tr><th>Method</th><th>URI</th><th>Action</th><th>Middleware</th></tr></thead>
            <tbody>
              {#each shown as r, i (r.method + r.uri + i)}
                <tr>
                  <td><span class="m {mcls(r.method)}">{r.method}</span></td>
                  <td class="mono">{r.uri}{#if r.name}<span class="faint"> · {r.name}</span>{/if}</td>
                  <td class="mono muted">{r.action}</td>
                  <td class="faint mw">{(r.middleware || []).join(', ')}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if fr.length > 40}<button class="btn sm ghost more" onclick={() => (showAll = !showAll)}>{showAll ? 'Show fewer' : `Show all ${fr.length}`}</button>{/if}
      {:else if tab === 'migrations' && ms.length}
        <div class="tw">
          <table class="tbl">
            <thead><tr><th>Table</th><th>Migration</th><th>Date</th></tr></thead>
            <tbody>
              {#each ms.slice().reverse() as m (m.file)}
                <tr><td class="mono">{m.table || '—'}</td><td class="mono muted">{m.file.split('/').pop()}</td><td class="faint">{m.ts ? timeAgo(m.ts) : ''}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/if}
  </Section>
{/if}

<style>
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
  .fc { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
  .fn { font-weight: 650; text-transform: capitalize; font-size: 13px; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; margin: 8px 0 0; font-size: 12px; }
  dt { color: var(--text-3); } dd { margin: 0; text-align: right; }
  .lh { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 16px 0 10px; }
  .grow { flex: 1; }
  .bar { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
  .bar .input { flex: 1; max-width: 300px; min-width: 150px; height: 30px; }
  .tw { max-height: 420px; overflow: auto; border: 1px solid var(--border); border-radius: 10px; }
  .m { font-size: 10.5px; font-weight: 700; padding: 2px 6px; border-radius: 5px; background: var(--panel-active); }
  .m.info { color: var(--info); background: var(--info-soft); } .m.ok { color: var(--ok); background: var(--ok-soft); }
  .m.warn { color: var(--warn); background: var(--warn-soft); } .m.err { color: var(--err); background: var(--err-soft); }
  .mw { font-size: 11.5px; }
  .more { margin-top: 8px; }
</style>
