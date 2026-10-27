<script>
  // Overview: four equal tiles answering "is everything OK?" - cost, ship readiness, change risk, truth & safety.
  // Each tile loads on its own and degrades to a quiet "no data" state; every tile links to its page.
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { fmtUsd, fmtPct } from '../../lib/statfmt.js';
  import Sparkline from '../../lib/viz/Sparkline.svelte';
  import Icon from '../../lib/Icon.svelte';

  const usage = resource(() => api('/api/usage/summary', { range: '7d' }).catch(() => null), { live: false });
  const ship = resource(() => api('/api/ship/summary').catch(() => null), { live: false });
  const review = resource(() => api('/api/changes/review').catch(() => null), { live: false });
  const truth = resource(async () => {
    const [v, a] = await Promise.all([api('/api/verify', { status: 'false' }).catch(() => null), api('/api/audit/config').catch(() => null)]);
    return v || a ? { falses: v?.summary?.false ?? 0, risk: a?.score ?? null, high: a?.counts?.high ?? 0 } : null;
  });

  // a cold usage summary can be partial (server still indexing): refresh until complete
  $effect(() => {
    if (!usage.data?.coverage?.partial) return;
    const t = setTimeout(() => usage.reload(), 3000);
    return () => clearTimeout(t);
  });

  const VERDICT = {
    verified: { label: 'Verified', tone: 'ok' },
    partial: { label: 'Partly verified', tone: 'warn' },
    failing: { label: 'Failing', tone: 'err' },
    unverified: { label: 'Unverified', tone: 'muted' },
  };

  const tiles = $derived.by(() => {
    const out = [];
    // ---- usage & cost
    {
      const s = usage.data;
      const series = Array.isArray(s?.series) ? s.series.map((x) => Number(x?.usd) || 0) : [];
      const anomaly = (s?.anomalies || []).find((a) => a?.severity === 'high') || (s?.anomalies || [])[0];
      out.push({
        id: 'usage', href: '#/usage', icon: 'activity', title: 'Usage & cost', loading: usage.data === undefined,
        empty: !s?.kpis, emptyText: 'No agent sessions yet',
        value: s?.kpis ? fmtUsd(s.kpis.usd) : '', unit: '7 days',
        sub: s?.kpis ? `${fmtUsd(s.budget?.todayUsd ?? 0)} today${s.kpis.cacheHitRate != null ? ` · cache ${fmtPct(s.kpis.cacheHitRate)}` : ''}${s.coverage?.partial ? ' · indexing…' : ''}` : '',
        tone: s?.budget?.over || anomaly?.severity === 'high' ? 'err' : anomaly ? 'warn' : 'accent',
        spark: series.length > 1 ? series : null,
        note: anomaly ? anomaly.message || anomaly.kind : s?.budget?.over ? "Over today's budget" : '',
      });
    }
    // ---- ship check
    {
      const s = ship.data;
      const v = VERDICT[s?.verdict] || VERDICT.unverified;
      const sc = s?.scope || {};
      const crit = (sc.verified || 0) + (sc.incomplete || 0) + (sc.untested || 0) + (sc.failed || 0);
      out.push({
        id: 'ship', href: '#/ship', icon: 'check', title: 'Ship check', loading: ship.data === undefined,
        empty: !s, emptyText: 'Not available',
        value: v.label, unit: '',
        sub: s ? `${s.readiness?.ready ? 'Ready to deploy' : `${s.readiness?.blockers || 0} blocker${s.readiness?.blockers === 1 ? '' : 's'}`}${crit ? ` · ${sc.verified || 0}/${crit} criteria` : ''}` : '',
        tone: v.tone,
        note: s && !s.readiness?.ready ? 'Production blockers found' : (s?.reasons || []).find((r) => r.level === 'error' || r.level === 'warn')?.text || '',
      });
    }
    // ---- change review
    {
      const s = review.data;
      const sm = s?.summary;
      out.push({
        id: 'changes', href: '#/changes', icon: 'merge', title: 'Change review', loading: review.data === undefined,
        empty: !s || s.available === false, emptyText: s?.available === false ? 'Not a git repository' : 'Not available',
        value: sm ? `${sm.files}` : '', unit: sm?.files === 1 ? 'changed file' : 'changed files',
        sub: sm ? (sm.files ? `+${sm.added} −${sm.removed}${sm.missingTests ? ` · ${sm.missingTests} without tests` : ''}` : 'Working tree is clean') : '',
        tone: sm?.high ? 'err' : sm?.medium ? 'warn' : 'ok',
        risk: sm && sm.files ? [sm.high || 0, sm.medium || 0, sm.low || 0] : null,
        note: sm?.high ? `${sm.high} high-risk file${sm.high === 1 ? '' : 's'} to review first` : '',
      });
    }
    // ---- truth & safety
    {
      const s = truth.data;
      out.push({
        id: 'verify', href: '#/verify', icon: 'shield', title: 'Truth & safety', loading: truth.data === undefined,
        empty: !s, emptyText: 'Not available',
        value: s ? `${s.falses}` : '', unit: s?.falses === 1 ? 'false instruction' : 'false instructions',
        sub: s ? `config risk ${s.risk ?? '–'}${s.high ? ` · ${s.high} high` : ''}` : '',
        tone: s?.high ? 'err' : s?.falses ? 'warn' : 'ok',
        note: s?.falses ? 'Context files claim things the repo contradicts' : '',
      });
    }
    return out;
  });
</script>

<section class="strip stagger" aria-label="Status">
  {#each tiles as t (t.id)}
    <a class="card tile {t.tone}" href={t.href} aria-label="Open {t.title}">
      <span class="head">
        <span class="ic"><Icon name={t.icon} size={15} /></span>
        <span class="t">{t.title}</span>
        <span class="spacer"></span>
        <span class="go"><Icon name="chevron" size={13} /></span>
      </span>
      {#if t.loading}
        <span class="skel sk-v"></span><span class="skel sk-s"></span>
      {:else if t.empty}
        <span class="none">{t.emptyText}</span>
      {:else}
        <span class="vrow">
          <span class="v tnum">{t.value}</span>{#if t.unit}<span class="u">{t.unit}</span>{/if}
          {#if t.spark}<span class="spark"><Sparkline values={t.spark} height={24} label="Cost per day, last 7 days" color={t.tone === 'err' ? 'var(--err)' : 'var(--accent)'} /></span>{/if}
        </span>
        <span class="sub">{t.sub}</span>
        {#if t.risk}
          {@const tot = t.risk[0] + t.risk[1] + t.risk[2] || 1}
          <span class="risk" aria-label="{t.risk[0]} high, {t.risk[1]} medium, {t.risk[2]} low risk">
            <span class="h" style="flex:{t.risk[0] / tot}"></span><span class="m" style="flex:{t.risk[1] / tot}"></span><span class="l" style="flex:{t.risk[2] / tot}"></span>
          </span>
        {/if}
        {#if t.note}<span class="note"><span class="ellipsis">{t.note}</span></span>{/if}
      {/if}
    </a>
  {/each}
</section>

<style>
  .strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
  .tile { --tc: var(--text-3); --ts: var(--panel-hover); position: relative; display: flex; flex-direction: column; gap: 6px; padding: 14px 16px 14px; min-height: 132px; color: var(--text-2); text-decoration: none; overflow: hidden; transition: border-color 0.2s, background 0.2s, transform 0.2s var(--ease); }
  .tile::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 2px; background: var(--tc); opacity: 0.85; }
  .tile:hover { text-decoration: none; background: var(--panel-hover); border-color: var(--border-strong); transform: translateY(-1px); }
  .ok { --tc: var(--ok); --ts: var(--ok-soft); }
  .warn { --tc: var(--warn); --ts: var(--warn-soft); }
  .err { --tc: var(--err); --ts: var(--err-soft); }
  .accent { --tc: var(--accent); --ts: var(--accent-soft); }
  .head { display: flex; align-items: center; gap: 9px; }
  .ic { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--ts); color: var(--tc); flex-shrink: 0; }
  .t { font-size: 12px; font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase; color: var(--text-3); }
  .spacer { flex: 1; }
  .go { color: var(--text-3); opacity: 0; transition: opacity 0.2s, transform 0.2s; }
  .tile:hover .go { opacity: 1; transform: translateX(2px); }
  .vrow { display: flex; align-items: baseline; gap: 7px; min-width: 0; margin-top: 4px; }
  .v { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; color: var(--text); line-height: 1.1; white-space: nowrap; }
  .u { font-size: 12px; color: var(--text-3); white-space: nowrap; }
  .spark { margin-left: auto; width: 76px; align-self: center; }
  .sub { font-size: 12.5px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .risk { display: flex; gap: 2px; height: 5px; border-radius: 99px; overflow: hidden; background: var(--panel-active); }
  .risk .h { background: var(--err); } .risk .m { background: var(--warn); } .risk .l { background: var(--ok); }
  .note { margin-top: auto; display: flex; font-size: 11.5px; color: var(--tc); background: var(--ts); padding: 4px 8px; border-radius: 7px; min-width: 0; }
  .none { font-size: 12.5px; color: var(--text-3); margin-top: 6px; }
  .sk-v { height: 26px; width: 60%; border-radius: 6px; margin-top: 6px; }
  .sk-s { height: 12px; width: 80%; border-radius: 5px; }
  @media (max-width: 1180px) { .strip { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 520px) { .strip { grid-template-columns: 1fr; } .tile { min-height: 0; } }
</style>
