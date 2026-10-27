<script>
  // Fake functionality / placeholder code in app code (tests, mocks, fixtures and docs are skipped).
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import Empty from '../../lib/Empty.svelte';
  import FindingsList from './FindingsList.svelte';
  import { RULE, plural } from './shared.js';

  const res = resource(() => api('/api/ship/placeholders'));
  const d = $derived(res.data);
</script>

{#if res.error && !d}
  <div class="card"><Empty icon="alert" title="Could not scan the project">{res.error.message}</Empty></div>
{:else if !d}
  <div class="card card-b" aria-busy="true"><div class="skel-rows"><div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div></div></div>
{:else if !d.findings.length}
  <!-- ship-ignore: names the patterns -->
  <div class="card"><Empty icon="check" title="No placeholder code found">No empty handlers, "coming soon" alerts, not-implemented stubs, placeholder API calls, mock auth, lorem ipsum or demo data in app code. Tests, mocks, fixtures and docs are not scanned.</Empty></div>
{:else}
  <p class="lead muted">{plural(d.count, 'spot')} where the app only looks finished. Tests, mocks, fixtures, stories and docs are skipped; add <code>ship-ignore</code> on a line to accept it.</p>
  <FindingsList findings={d.findings} groupKey="rule" labels={RULE} emptyText="No findings at this severity." />
{/if}

<style>
  .lead { margin: 0 0 10px; font-size: 13px; }
  code { font-family: var(--mono); font-size: 0.92em; }
</style>
