<script>
  // Overview card: false instructions + agent-config risk, linking to the Verify view.
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import Icon from '../../lib/Icon.svelte';

  const r = resource(async () => {
    const [v, a] = await Promise.all([api('/api/verify', { status: 'false' }).catch(() => null), api('/api/audit/config').catch(() => null)]);
    return { falses: v?.summary?.false ?? null, total: v?.summary?.total ?? 0, risk: a?.score ?? null, level: a?.level || 'none', high: a?.counts?.high ?? 0 };
  });
  const d = $derived(r.data);
  const tone = $derived(!d ? '' : d.high || d.falses > 0 ? (d.high ? 'err' : 'warn') : 'ok');
</script>

<a class="card teaser {tone}" href="#/verify" aria-label="Open Truth and safety">
  <span class="ic"><Icon name="shield" size={16} /></span>
  <span class="col" style="gap:2px;min-width:0">
    <span class="t">Truth &amp; safety</span>
    {#if !d}
      <span class="faint small">checking…</span>
    {:else}
      <span class="small">
        <b class="tnum">{d.falses ?? '–'}</b> false instruction{d.falses === 1 ? '' : 's'} · risk <b class="tnum">{d.risk ?? '–'}</b>
      </span>
    {/if}
  </span>
  <span class="spacer"></span>
  <Icon name="chevron" size={14} />
</a>

<style>
  .teaser { display: flex; align-items: center; gap: 12px; padding: 12px 16px; text-decoration: none; color: var(--text-2); }
  .teaser:hover { background: var(--panel-hover); text-decoration: none; }
  .ic { width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; background: var(--panel-hover); color: var(--text-3); flex-shrink: 0; }
  .ok .ic { background: var(--ok-soft); color: var(--ok); }
  .warn .ic { background: var(--warn-soft); color: var(--warn); }
  .err .ic { background: var(--err-soft); color: var(--err); }
  .t { font-weight: 600; color: var(--text); font-size: 13px; }
  .small { font-size: 12.5px; }
  b { color: var(--text); }
  .spacer { flex: 1; }
</style>
