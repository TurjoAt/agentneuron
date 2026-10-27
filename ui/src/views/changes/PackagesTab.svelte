<script>
  // Package guard: findings for the project's dependencies and a single-package checker (before installing).
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';
  import Skeleton from '../../lib/viz/Skeleton.svelte';
  import { SEV_TONE, VERDICT, MANAGERS, plural } from './shared.js';

  const res = resource(() => api('/api/changes/packages'), { live: false });
  const d = $derived(res.data);
  const findings = $derived(Array.isArray(d?.findings) ? d.findings : []);
  let sev = $state('all');
  let shown = $state(50);
  const filtered = $derived(findings.filter((f) => sev === 'all' || f.severity === sev));
  const count = (s) => findings.filter((f) => f.severity === s).length;

  let manager = $state('npm');
  let name = $state('');
  let version = $state('');
  let checking = $state(false);
  let result = $state(null);
  let error = $state('');
  async function check(e) {
    e.preventDefault();
    if (!name.trim()) return;
    checking = true; error = ''; result = null;
    try { result = await api('/api/changes/package', { manager, name: name.trim(), ...(version.trim() ? { version: version.trim() } : {}) }); } catch (err) { error = err.message; }
    checking = false;
  }
  const fmtDay = (iso) => (iso ? String(iso).slice(0, 10) : '—');
</script>

<section class="card checker">
  <div class="card-h"><Icon name="shield" size={14} /> Check a package before installing <span class="sub">{d?.online ? 'registry lookups on' : 'offline'}</span></div>
  <form class="form" onsubmit={check}>
    <select class="input mgr" bind:value={manager} aria-label="Package manager">
      {#each MANAGERS as m (m)}<option value={m}>{m}</option>{/each}
    </select>
    <input class="input mono nm" placeholder={manager === 'composer' ? 'vendor/package' : 'package name'} bind:value={name} aria-label="Package name" spellcheck="false" autocomplete="off" />
    <input class="input mono ver" placeholder="version (optional)" bind:value={version} aria-label="Version" spellcheck="false" autocomplete="off" />
    <button class="btn primary sm" type="submit" disabled={checking || !name.trim()}>{checking ? 'Checking…' : 'Check'}</button>
  </form>
  {#if error}<p class="errmsg small pad">{error}</p>{/if}
  {#if result}
    {@const v = VERDICT[result.verdict] || VERDICT.unknown}
    <div class="verdict {v.tone}">
      <div class="vh"><Icon name={v.icon} size={16} /><b>{v.label}</b><span class="mono">{result.name}{result.version ? `@${result.version}` : ''}</span><span class="faint tiny">{result.manager}</span></div>
      <ul class="reasons">
        {#each result.reasons as r, i (i)}
          <li><span class="dot {SEV_TONE[r.severity]}"></span><span class="grow">{r.message}{#if r.fix}<span class="faint"> · {r.fix}</span>{/if}</span></li>
        {/each}
      </ul>
      {#if result.registry && !result.registry.error}
        <div class="reg faint tiny">
          <span>registry: {result.registry.exists === false ? 'not found' : 'found'}</span>
          {#if result.registry.latest}<span>latest {result.registry.latest}</span>{/if}
          {#if result.registry.createdAt}<span>first published {fmtDay(result.registry.createdAt)}</span>{/if}
          {#if result.registry.maintainers != null}<span>{plural(result.registry.maintainers, 'maintainer')}</span>{/if}
          {#if result.registry.advisories?.length}<span>{plural(result.registry.advisories.length, 'advisory', 'advisories')}</span>{/if}
        </div>
      {:else if !result.online}
        <p class="faint tiny note">Registry and advisory lookups are off. An admin can enable them with <code>"packages": {'{'} "online": true {'}'}</code> in .agentneuron/config.json.</p>
      {/if}
    </div>
  {/if}
</section>

{#if res.error && !d}
  <div class="card gap"><Empty icon="alert" title="Could not check dependencies">{res.error.message}</Empty></div>
{:else if !d}
  <section class="card gap"><div class="card-b pad"><Skeleton kind="table" label="Reading manifests and lockfiles" /></div></section>
{:else}
  <section class="card gap">
    <div class="card-h">
      Dependency findings <span class="sub">{plural(d.deps, 'dependency', 'dependencies')}{d.lockfiles?.length ? ` · ${d.lockfiles.join(', ')}` : ' · no lockfile'}</span>
      <span class="grow"></span>
      <button class="btn ghost sm icon" onclick={() => res.reload()} aria-label="Re-check" title="Re-check"><Icon name="refresh" size={13} /></button>
    </div>
    {#if !findings.length}
      <Empty compact icon="check" title={d.deps ? 'No findings' : 'No dependencies found'}>{d.deps ? 'Every dependency is locked, pinned and not a look-alike of a popular package.' : 'Add a package.json, composer.json, pyproject.toml or requirements.txt and it is checked here.'}</Empty>
    {:else}
      <div class="filters">
        {#each ['all', 'high', 'medium', 'low'] as s (s)}
          <button class="chip" class:on={sev === s} onclick={() => (sev = s)}>{s === 'all' ? 'All' : s}{#if s !== 'all'} <span class="n">{count(s)}</span>{/if}</button>
        {/each}
      </div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Severity</th><th>Package</th><th>Finding</th><th class="hide-s">Where</th></tr></thead>
          <tbody>
            {#each filtered.slice(0, shown) as f (f.id)}
              <tr>
                <td><span class="badge {SEV_TONE[f.severity]} xs">{f.severity}</span></td>
                <td class="pk"><span class="mono">{f.name}</span>{#if f.version}<div class="faint tiny mono">{f.version}</div>{/if}<div class="faint tiny">{f.manager}</div></td>
                <td class="msg">{f.message}{#if f.fix}<div class="faint tiny">{f.fix}</div>{/if}<div class="tiny mono faint">{f.code}</div></td>
                <td class="hide-s">{#if f.manifest}<EntityLink kind="file" id={f.manifest} mono />{/if}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if filtered.length > shown}<div class="card-b"><button class="btn sm" onclick={() => (shown += 100)}>Show more</button></div>{/if}
    {/if}
  </section>
{/if}

<style>
  .gap { margin-top: 14px; }
  .pad { padding: 0 16px; }
  .tiny { font-size: 11px; }
  .form { display: flex; gap: 8px; padding: 0 16px 14px; flex-wrap: wrap; }
  .form .input { height: 30px; font-size: 12.5px; }
  .mgr { width: 110px; }
  .nm { flex: 2; min-width: 160px; }
  .ver { flex: 1; min-width: 120px; }
  .errmsg { color: var(--err); }
  .verdict { margin: 0 16px 16px; padding: 12px 14px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--inset); }
  .verdict.ok { border-color: color-mix(in srgb, var(--ok) 40%, transparent); }
  .verdict.warn { border-color: color-mix(in srgb, var(--warn) 45%, transparent); }
  .verdict.err { border-color: color-mix(in srgb, var(--err) 45%, transparent); background: var(--err-soft); }
  .vh { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .ok .vh { color: var(--ok); } .warn .vh { color: var(--warn); } .err .vh { color: var(--err); } .info .vh { color: var(--info); }
  .vh .mono, .vh .faint { color: var(--text); }
  .reasons { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; }
  .reasons li { display: flex; gap: 8px; align-items: baseline; }
  .dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex: none; background: var(--text-3); }
  .dot.err { background: var(--err); } .dot.warn { background: var(--warn); } .dot.info { background: var(--info); }
  .reg { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 8px; }
  .note { margin: 8px 0 0; }
  .filters { display: flex; gap: 5px; padding: 0 14px 10px; flex-wrap: wrap; }
  .filters .chip { height: 26px; font-size: 12px; }
  .pk { overflow-wrap: anywhere; }
  .msg { min-width: 200px; }
  @media (max-width: 640px) { .hide-s { display: none; } .msg { min-width: 0; } .mgr { width: 100%; } .nm, .ver { flex: 1 1 100%; } }
</style>
