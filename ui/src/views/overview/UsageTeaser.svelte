<script>
  // Overview card: cost today / 7 days with a sparkline, cache hit rate and the top anomaly, linking to Usage & cost.
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { fmtUsd, fmtPct } from '../../lib/statfmt.js';
  import Sparkline from '../../lib/viz/Sparkline.svelte';
  import Icon from '../../lib/Icon.svelte';

  const r = resource(() => api('/api/usage/summary', { range: '7d' }).catch(() => null), { live: false });
  const d = $derived.by(() => {
    const s = r.data;
    if (!s || typeof s !== 'object' || !s.kpis) return null;
    const series = Array.isArray(s.series) ? s.series.map((x) => Number(x?.usd) || 0) : [];
    const anomalies = Array.isArray(s.anomalies) ? s.anomalies.slice() : [];
    const rank = { high: 0, medium: 1, low: 2 };
    anomalies.sort((a, b) => (rank[a?.severity] ?? 3) - (rank[b?.severity] ?? 3));
    return {
      week: s.kpis.usd ?? null,
      today: s.budget?.todayUsd ?? (series.length ? series[series.length - 1] : null),
      over: !!s.budget?.over,
      cache: s.kpis.cacheHitRate ?? null,
      sessions: s.kpis.sessions ?? null,
      series,
      anomaly: anomalies[0] || null,
    };
  });
  const tone = $derived(!d ? '' : d.over || d.anomaly?.severity === 'high' ? 'err' : d.anomaly ? 'warn' : 'ok');
</script>

<a class="card teaser {tone}" href="#/usage" aria-label="Open Usage and cost">
  <span class="top">
    <span class="ic"><Icon name="activity" size={16} /></span>
    <span class="col" style="gap:2px;min-width:0">
      <span class="t">Usage &amp; cost</span>
      {#if r.data === undefined}
        <span class="faint small">loading…</span>
      {:else if !d}
        <span class="faint small">No usage data yet</span>
      {:else}
        <span class="small"><b class="tnum">{fmtUsd(d.today)}</b> today · <b class="tnum">{fmtUsd(d.week)}</b> 7d{#if d.cache != null} · cache <b class="tnum">{fmtPct(d.cache)}</b>{/if}</span>
      {/if}
    </span>
    <span class="spacer"></span>
    {#if d?.series?.length > 1}<span class="spark"><Sparkline values={d.series} height={26} label="Cost per day, last 7 days" color={tone === 'err' ? 'var(--err)' : 'var(--accent)'} /></span>{/if}
    <Icon name="chevron" size={14} />
  </span>
  {#if d?.anomaly}
    <span class="anom {d.anomaly.severity || ''}"><Icon name="alert" size={12} /><span class="ellipsis">{d.anomaly.message || d.anomaly.kind}</span></span>
  {:else if d?.over}
    <span class="anom high"><Icon name="alert" size={12} /><span class="ellipsis">Over today's budget</span></span>
  {/if}
</a>

<style>
  .teaser { display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; text-decoration: none; color: var(--text-2); }
  .teaser:hover { background: var(--panel-hover); text-decoration: none; }
  .top { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .ic { width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; background: var(--panel-hover); color: var(--text-3); flex-shrink: 0; }
  .ok .ic { background: var(--accent-soft); color: var(--accent); }
  .warn .ic { background: var(--warn-soft); color: var(--warn); }
  .err .ic { background: var(--err-soft); color: var(--err); }
  .t { font-weight: 600; color: var(--text); font-size: 13px; }
  .small { font-size: 12.5px; }
  b { color: var(--text); }
  .spacer { flex: 1; }
  .spark { width: 72px; flex-shrink: 0; }
  .anom { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 5px 9px; border-radius: 8px; background: var(--warn-soft); color: var(--warn); min-width: 0; }
  .anom.high { background: var(--err-soft); color: var(--err); }
  .anom.low { background: var(--info-soft); color: var(--info); }
  @media (max-width: 420px) { .spark { display: none; } }
</style>
