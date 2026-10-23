<script>
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { runAction, actionEnabled } from '../../lib/actions.js';
  import { toast } from '../../lib/store.svelte.js';
  import Icon from '../../lib/Icon.svelte';
  import Section from './Section.svelte';

  let { project } = $props();

  const manifests = $derived(project.manifests || []);
  let sel = $state(0);
  let q = $state('');
  let kind = $state('all');
  let onlyOutdated = $state(false);
  const m = $derived(manifests[Math.min(sel, manifests.length - 1)]);

  const outdated = resource(() => api('/api/project/outdated').catch(() => null), { key: () => 'o' });
  // normalise real ({managers:{npm:{items}}}) and mock ({results:{npm:[]}}) shapes
  const outMap = $derived.by(() => {
    const o = outdated.data, map = new Map();
    const src = o?.managers ? Object.entries(o.managers).map(([k, v]) => [k, v?.items || []]) : Object.entries(o?.results || {});
    for (const [mgr, items] of src) for (const it of items || []) map.set(`${mgr}:${it.name}`, it);
    return map;
  });
  const audit = $derived(outdated.data?.audit || null);
  const outTs = $derived(outdated.data?.ts || Math.max(0, ...Object.values(outdated.data?.managers || {}).map((v) => v?.ts || 0)));

  const NPM = ['npm', 'pnpm', 'yarn', 'bun'];
  function mgrFor(man) {
    if (!man) return null;
    if (man.type === 'npm') return (project.packageManagers || []).find((p) => NPM.includes(p.id))?.id || 'npm';
    if (man.type === 'composer') return 'composer';
    if (man.type === 'python') return (project.packageManagers || []).find((p) => ['poetry', 'pip'].includes(p.id))?.id || 'pip';
    return null;
  }
  const mgr = $derived(mgrFor(m));
  const noMgr = $derived(!mgr ? `No package actions for ${m?.type || 'this'} manifests yet` : '');
  const can = (id) => {
    if (noMgr) return { enabled: false, reason: noMgr };
    return actionEnabled(id);
  };
  const lookup = (d) => outMap.get(`${d.manager}:${d.name}`) || outMap.get(`${mgr}:${d.name}`) || (d.outdated ? d : null);

  const rows = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    return (m?.deps || [])
      .map((d) => ({ ...d, o: lookup(d) }))
      .filter((d) => (kind === 'all' || (kind === 'dev') === !!d.dev) && (!needle || d.name.toLowerCase().includes(needle)) && (!onlyOutdated || d.o))
      .sort((a, b) => (!!b.o - !!a.o) || a.name.localeCompare(b.name));
  });
  const outCount = $derived((m?.deps || []).filter((d) => lookup(d)).length);

  async function act(id, params) {
    const job = await runAction(id, { manager: mgr, ...params });
    if (job && id === 'packages.outdated') outdated.reload();
    if (job?.status === 'error') toast(`${id} failed`, 'error');
    return job;
  }
  const checkOutdated = () => act('packages.outdated', {});
  async function runAudit() {
    const job = await act('packages.audit', {});
    const v = job?.result?.vulnerabilities;
    if (v) toast(`Audit: ${v.critical || 0} critical, ${v.high || 0} high, ${v.moderate || 0} moderate, ${v.low || 0} low`, v.critical || v.high ? 'warn' : 'info');
  }
  const sevCls = (s) => (s === 'critical' || s === 'high' ? 'err' : s === 'moderate' ? 'warn' : 'info');
  const bump = (cur, latest) => {
    const a = String(cur || '').replace(/^[^\d]*/, '').split('.')[0], b = String(latest || '').replace(/^[^\d]*/, '').split('.')[0];
    return a && b && a !== b ? 'major' : 'minor';
  };
</script>

{#if manifests.length}
  <Section id="deps" title="Dependencies" icon="archive" sub="{m?.deps?.length || 0} in {m?.path}">
    {#snippet actions()}
      <button class="btn sm" disabled={!can('packages.outdated').enabled} title={can('packages.outdated').reason || 'Check for newer versions'} onclick={checkOutdated}><Icon name="refresh" size={12} /> Check outdated</button>
      <button class="btn sm" disabled={!can('packages.audit').enabled} title={can('packages.audit').reason || 'Security audit'} onclick={runAudit}><Icon name="shield" size={12} /> Audit</button>
      <button class="btn sm" disabled={!can('packages.install').enabled} title={can('packages.install').reason || 'Install all dependencies'} onclick={() => act('packages.install', {})}><Icon name="download" size={12} /> Install</button>
      <button class="btn sm primary" disabled={!can('packages.add').enabled} title={can('packages.add').reason || 'Add a package'} onclick={() => act('packages.add', {})}><Icon name="plus" size={12} /> Add</button>
    {/snippet}

    {#if manifests.length > 1}
      <div class="mt">
        {#each manifests as man, i (man.path)}
          <button class="chip" class:on={sel === i} onclick={() => (sel = i)}>{man.path} <span class="n">{man.deps?.length || 0}</span></button>
        {/each}
      </div>
    {/if}

    <div class="bar">
      <input class="input" type="search" placeholder="Search packages…" bind:value={q} aria-label="Search packages" />
      <div class="segc">
        {#each [['all', 'All'], ['prod', 'Prod'], ['dev', 'Dev']] as [v, l] (v)}<button class:on={kind === v} onclick={() => (kind = v)}>{l}</button>{/each}
      </div>
      <label class="chk"><input type="checkbox" class="sw sm" bind:checked={onlyOutdated} /> Outdated only{outCount ? ` (${outCount})` : ''}</label>
      {#if outTs}<span class="faint tiny">checked {new Date(outTs).toLocaleString()}</span>{:else}<span class="faint tiny">outdated info not checked yet</span>{/if}
    </div>

    {#if audit}
      <div class="aud">
        <b>Audit</b>
        {#each Object.entries(audit) as [pm, a] (pm)}
          <span class="chip">{pm}: <b class="err">{a.critical || 0}c</b> <b class="err">{a.high || 0}h</b> <b class="warn">{a.moderate || 0}m</b> {a.low || 0}l</span>
        {/each}
      </div>
    {/if}

    <div class="tw">
      <table class="tbl">
        <thead><tr><th>Package</th><th>Range</th><th>Installed</th><th>Latest</th><th></th></tr></thead>
        <tbody>
          {#each rows as d (d.name + d.dev)}
            <tr>
              <td><span class="mono">{d.name}</span> {#if d.dev}<span class="tag">dev</span>{/if}</td>
              <td class="mono muted">{d.version}</td>
              <td class="mono">{d.o?.current ?? '—'}</td>
              <td class="mono">{#if d.o}<span class={bump(d.o.current, d.o.latest) === 'major' ? 'warn' : 'ok'}>{d.o.latest}</span>{:else}<span class="faint">—</span>{/if}</td>
              <td class="act">
                <button class="btn sm ghost" disabled={!can('packages.update').enabled} title={can('packages.update').reason || `Update ${d.name}`} onclick={() => act('packages.update', { name: d.name })}>Update</button>
                <button class="btn sm ghost" disabled={!can('packages.remove').enabled} title={can('packages.remove').reason || `Remove ${d.name}`} onclick={() => act('packages.remove', { name: d.name })}>Remove</button>
              </td>
            </tr>
          {:else}
            <tr><td colspan="5" class="faint c">No packages match.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if !can('packages.add').enabled}<p class="faint tiny why">Package actions disabled: {can('packages.add').reason}</p>{/if}
  </Section>
{/if}

<style>
  .mt { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
  .bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
  .bar .input { flex: 1; min-width: 160px; max-width: 280px; height: 30px; }
  .chk { display: inline-flex; gap: 8px; align-items: center; font-size: 12.5px; color: var(--text-2); }
  .tiny { font-size: 11px; }
  .tw { max-height: 420px; overflow: auto; border: 1px solid var(--border); border-radius: 10px; }
  .act { text-align: right; white-space: nowrap; }
  .c { text-align: center; padding: 18px; }
  .tag { font-size: 10px; padding: 1px 6px; border-radius: 99px; background: var(--panel-active); color: var(--text-3); margin-left: 4px; }
  .aud { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; font-size: 12.5px; }
  .err { color: var(--err); } .warn { color: var(--warn); } .ok { color: var(--ok); }
  .why { margin: 8px 0 0; }
</style>
