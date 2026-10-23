<script>
  import Section from './Section.svelte';
  let { project } = $props();
  const env = $derived(project.env);
  const ex = $derived(env?.exampleKeys || []);
  const present = $derived(new Set(env?.presentKeys || []));
  const missing = $derived(new Set(env?.missing || []));
  const extra = $derived(env?.extra || []);
  const has = $derived(env && (ex.length || present.size || env.files?.length));
</script>

{#if has}
  <Section id="env" title="Environment" icon="key" sub="key names only — values are never read">
    {#if env.files?.length}<div class="faint mono small files">{env.files.join(' · ')}</div>{/if}
    {#if ex.length}
      <div class="sum">
        {#if missing.size}<span class="warn"><b>{missing.size}</b> missing</span>{:else}<span class="ok">All example keys are set</span>{/if}
        <span class="faint">{ex.length - missing.size}/{ex.length} set</span>
      </div>
      <div class="keys">
        {#each ex as k (k)}
          <span class="key mono" class:miss={missing.has(k) || !present.has(k)}>
            <span class="ic">{missing.has(k) || !present.has(k) ? '✕' : '✓'}</span>{k}
          </span>
        {/each}
      </div>
    {/if}
    {#if extra.length}
      <div class="grp">Not in example file</div>
      <div class="keys">{#each extra as k (k)}<span class="key mono extra">{k}</span>{/each}</div>
    {/if}
  </Section>
{/if}

<style>
  .small { font-size: 11.5px; } .files { margin-bottom: 10px; }
  .sum { display: flex; gap: 12px; font-size: 13px; margin-bottom: 8px; }
  .warn { color: var(--warn); } .ok { color: var(--ok); }
  .keys { display: flex; flex-wrap: wrap; gap: 6px; }
  .key { display: inline-flex; gap: 6px; align-items: center; font-size: 11.5px; padding: 3px 9px; border-radius: 7px; border: 1px solid var(--border); background: var(--ok-soft); }
  .key .ic { color: var(--ok); font-size: 10px; }
  .key.miss { background: var(--warn-soft); border-color: color-mix(in srgb, var(--warn) 40%, transparent); }
  .key.miss .ic { color: var(--warn); }
  .key.extra { background: transparent; color: var(--text-2); }
  .grp { font-size: 12px; color: var(--text-3); margin: 14px 0 6px; }
</style>
