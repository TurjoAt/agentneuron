<script>
  import { api } from '../lib/api.js';
  import { resource } from '../lib/resource.svelte.js';
  import Empty from '../lib/Empty.svelte';
  import Deps from './project/Deps.svelte';
  import Scripts from './project/Scripts.svelte';
  import Frameworks from './project/Frameworks.svelte';
  import Tooling from './project/Tooling.svelte';
  import Infra from './project/Infra.svelte';
  import EnvCheck from './project/EnvCheck.svelte';
  import Dotfolders from './project/Dotfolders.svelte';
  import CodeStats from './project/CodeStats.svelte';
  import Drift from './project/Drift.svelte';

  let { params: _params } = $props();

  const proj = resource(() => api('/api/project'), { key: () => 'p', debounce: 1500 });
  const p = $derived(proj.data);

  const CAT = { language: 'Languages', runtime: 'Runtime', framework: 'Frameworks', db: 'Data', testing: 'Testing', tool: 'Tools', infra: 'Infra', ci: 'CI', ai: 'AI' };
  const CAT_ORDER = ['language', 'runtime', 'framework', 'db', 'testing', 'tool', 'infra', 'ci', 'ai'];
  let allBadges = $state(false);
  const stacks = $derived((p?.stacks || []).slice().sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category)));
  const badges = $derived(allBadges ? stacks : stacks.filter((s) => ['language', 'runtime', 'framework', 'db'].includes(s.category)).concat(stacks.filter((s) => !['language', 'runtime', 'framework', 'db'].includes(s.category)).slice(0, 4)));

  const sections = $derived.by(() => {
    if (!p) return [];
    const has = (x) => (Array.isArray(x) ? x.length : !!x);
    return [
      ['deps', 'Dependencies', has((p.manifests || []).length)],
      ['scripts', 'Scripts', has(p.scripts)],
      ['frameworks', 'Frameworks', Object.values(p.framework || {}).some((v) => v && typeof v === 'object')],
      ['tooling', 'Tooling', has(p.stacks?.filter((s) => ['tool', 'testing', 'ci'].includes(s.category))) || has(p.packageManagers)],
      ['infra', 'Infra', has(p.docker?.services) || has(p.docker?.files) || has(p.ci)],
      ['env', 'Env', has(p.env?.exampleKeys) || has(p.env?.presentKeys)],
      ['dotfolders', 'Dot-folders', has(p.dotfolders)],
      ['stats', 'Code stats', has(p.stats?.languages)],
      ['drift', 'Doc drift', true],
    ].filter((s) => s[2]);
  });

  function jump(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
</script>

<div class="page">
  {#if proj.error && !p}
    <div class="card"><Empty icon="project" title="Project info unavailable">{proj.error.message}</Empty></div>
  {:else if !p}
    <div class="card"><Empty icon="project" title="Detecting project…" /></div>
  {:else}
    <header class="hd">
      <div class="t">
        <h1>{p.name}</h1>
        {#if p.version}<span class="ver mono">v{p.version}</span>{/if}
      </div>
      {#if p.description}<p class="desc">{p.description}</p>{/if}
      <div class="badges">
        {#each badges as s (s.id)}
          <span class="badge {s.category}" title="{CAT[s.category] || s.category} · {s.source}">{s.name}{#if s.version}<span class="v mono">{s.version}</span>{/if}</span>
        {/each}
        {#if stacks.length > badges.length || allBadges}
          <button class="btn sm ghost" onclick={() => (allBadges = !allBadges)}>{allBadges ? 'Fewer' : `+${stacks.length - badges.length} more`}</button>
        {/if}
      </div>
    </header>

    <nav class="snav" aria-label="Sections">
      {#each sections as [id, label] (id)}<button class="chip" onclick={() => jump(id)}>{label}</button>{/each}
    </nav>

    <div class="stack">
      <Deps project={p} />
      <Scripts project={p} />
      <Frameworks project={p} />
      <Tooling project={p} />
      <Infra project={p} />
      <EnvCheck project={p} />
      <Dotfolders project={p} />
      <CodeStats stats={p.stats} />
      <Drift />
    </div>
  {/if}
</div>

<style>
  .hd { margin-bottom: 14px; }
  .t { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  h1 { margin: 0; font-size: 24px; letter-spacing: -0.02em; font-weight: 650; }
  .ver { font-size: 12px; color: var(--text-2); padding: 2px 8px; border-radius: 99px; background: var(--panel-active); }
  .desc { margin: 6px 0 0; color: var(--text-2); font-size: 13.5px; max-width: 80ch; }
  .badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; align-items: center; }
  .badge { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border-radius: 99px; font-size: 12px; font-weight: 550; border: 1px solid var(--border); background: var(--panel); }
  .badge .v { font-size: 11px; color: var(--text-3); font-weight: 450; }
  .badge.framework { border-color: color-mix(in srgb, var(--accent) 45%, transparent); background: var(--accent-soft); }
  .badge.language { border-color: color-mix(in srgb, var(--info) 40%, transparent); }
  .badge.testing { border-color: color-mix(in srgb, var(--ok) 40%, transparent); }
  .badge.infra, .badge.ci { border-color: color-mix(in srgb, var(--warn) 40%, transparent); }
  .snav { position: sticky; top: 0; z-index: 5; display: flex; gap: 6px; padding: 8px 0; margin-bottom: 8px; overflow-x: auto; scrollbar-width: none; background: linear-gradient(var(--bg, transparent) 75%, transparent); backdrop-filter: blur(6px); }
  .snav::-webkit-scrollbar { display: none; }
  .snav .chip { flex-shrink: 0; cursor: pointer; }
  .stack { display: flex; flex-direction: column; gap: 16px; }
</style>
