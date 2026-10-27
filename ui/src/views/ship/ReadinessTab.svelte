<script>
  // Production readiness: ready / not-ready banner and findings grouped by category.
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import FindingsList from './FindingsList.svelte';
  import { CATEGORY, plural } from './shared.js';

  const res = resource(() => api('/api/ship/readiness'));
  const d = $derived(res.data);
</script>

{#if res.error && !d}
  <div class="card"><Empty icon="alert" title="Could not scan the project">{res.error.message}</Empty></div>
{:else if !d}
  <div class="col" style="gap:12px" aria-busy="true"><div class="card skel" style="height:96px"></div><div class="card card-b"><div class="skel-rows"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div></div></div>
{:else}
  <div class="col" style="gap:14px">
    <section class="card banner {d.ready ? 'ok' : 'err'}" aria-live="polite">
      <span class="ic"><Icon name={d.ready ? 'check' : 'shield'} size={22} /></span>
      <div class="col" style="gap:2px;min-width:0">
        <b class="t">{d.ready ? 'Ready to deploy' : 'Not ready to deploy'}</b>
        <span class="muted s">
          {#if d.ready}No high-severity blockers.{:else}{plural(d.blockers, 'blocker')} must be fixed first.{/if}
          {#if d.counts.medium || d.counts.low} {d.counts.medium} medium and {d.counts.low} low findings to review.{/if}
        </span>
      </div>
      <span class="spacer"></span>
      <span class="faint xs">{d.scanned.scanned} files scanned{d.scanned.truncated ? ' (capped)' : ''} · static, nothing is run</span>
    </section>
    {#if !d.findings.length}
      <div class="card"><Empty icon="check" title="No findings">Env vars, committed env files, debug flags, secrets, lockfiles, scripts, CORS, default credentials, migrations and release TODOs all look fine.</Empty></div>
    {:else}
      <FindingsList findings={d.findings} groupKey="category" labels={CATEGORY} emptyText="No findings at this severity." />
    {/if}
  </div>
{/if}

<style>
  .banner { display: flex; align-items: center; gap: 14px; padding: 16px 18px; flex-wrap: wrap; border-left: 4px solid var(--tone); --tone: var(--ok); --soft: var(--ok-soft); }
  .banner.err { --tone: var(--err); --soft: var(--err-soft); }
  .ic { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; background: var(--soft); color: var(--tone); flex-shrink: 0; }
  .t { font-size: 17px; color: var(--tone); }
  .s { font-size: 13px; }
  .xs { font-size: 11.5px; }
</style>
