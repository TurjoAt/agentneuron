<script>
  // Usage › Activity: when you work with agents. Calendar, weekday×hour punch card, hourly bars,
  // turn times, focus time and per-session bands (each links to the session).
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { fmtDur, fmtUsd } from '../../lib/statfmt.js';
  import { fmtNum } from '../../lib/format.js';
  import CalendarHeatmap from '../../lib/viz/CalendarHeatmap.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';
  import Empty from '../../lib/Empty.svelte';
  import Icon from '../../lib/Icon.svelte';

  let { params = {}, range = '30d' } = $props();
  const res = resource((k) => api('/api/usage/activity', { range: k.range, tool: k.tool }), { key: () => ({ range, tool: params.tool || undefined }), live: false });
  const d = $derived(res.data);

  let metric = $state('sessions');
  const METRICS = [
    { k: 'sessions', label: 'Sessions' },
    { k: 'prompts', label: 'Prompts' },
    { k: 'usd', label: 'Cost' },
  ];
  const heat = $derived((Array.isArray(d?.heatmap) ? d.heatmap : []).map((h) => ({ date: h.date, count: Number(h[metric]) || 0 })));
  // short ranges still get a readable calendar: at least 13 weeks, cells sized to fill the card
  const heatDays = $derived(Math.max(91, Math.min(371, heat.length || 30)));
  let calW = $state(0);
  const heatCell = $derived(Math.max(10, Math.min(20, Math.floor((calW - 62) / Math.ceil((heatDays + 6) / 7)) - 3)));

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weekHour = $derived(Array.isArray(d?.weekHour) && d.weekHour.length === 7 ? d.weekHour.map((r) => (Array.isArray(r) ? r : [])) : null);
  const whMax = $derived(weekHour ? Math.max(1, ...weekHour.flat().map((v) => Number(v) || 0)) : 1);
  const hourly = $derived(Array.isArray(d?.hourly) && d.hourly.length ? d.hourly.map((v) => Number(v) || 0) : null);
  const hMax = $derived(hourly ? Math.max(1, ...hourly) : 1);
  const peak = $derived(hourly ? hourly.indexOf(Math.max(...hourly)) : -1);
  const busiestDay = $derived.by(() => {
    if (!weekHour) return null;
    const sums = weekHour.map((r) => r.reduce((a, v) => a + (Number(v) || 0), 0));
    const i = sums.indexOf(Math.max(...sums));
    return sums[i] ? DAYS[i] : null;
  });
  const hh = (h) => `${String(h).padStart(2, '0')}:00`;

  const turns = $derived(d?.turns || {});
  const tMax = $derived(Math.max(1, Number(turns.maxMs) || 0, Number(turns.p90Ms) || 0));
  const tPos = (v) => (v == null ? null : Math.max(0, Math.min(100, (Math.log10(1 + v / 1000) / Math.log10(1 + tMax / 1000)) * 100)));

  const totals = $derived.by(() => {
    const h = Array.isArray(d?.heatmap) ? d.heatmap : [];
    return { sessions: h.reduce((a, x) => a + (x.sessions || 0), 0), prompts: h.reduce((a, x) => a + (x.prompts || 0), 0), usd: h.reduce((a, x) => a + (x.usd || 0), 0), active: h.filter((x) => x.sessions || x.prompts).length, days: h.length };
  });

  // session bands: each row is a session drawn on a 24h axis of the day it started
  const bands = $derived.by(() => {
    const list = (Array.isArray(d?.sessions) ? d.sessions : []).filter((s) => s && s.startedAt).slice().sort((a, b) => b.startedAt - a.startedAt).slice(0, 14);
    return list.map((s) => {
      const st = new Date(s.startedAt);
      const day0 = new Date(st).setHours(0, 0, 0, 0);
      const a = ((s.startedAt - day0) / 3_600_000 / 24) * 100;
      const end = s.endedAt && s.endedAt > s.startedAt ? s.endedAt : s.startedAt + 60_000;
      const b = Math.min(100, ((end - day0) / 3_600_000 / 24) * 100);
      const activePct = s.activeMs && end > s.startedAt ? Math.min(1, s.activeMs / (end - s.startedAt)) : null;
      return { ...s, left: a, width: Math.max(0.8, b - a), activePct, day: `${st.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${st.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, overflow: end - day0 > 86_400_000 };
    });
  });
</script>

{#if res.error && !d}
  <div class="card"><Empty icon="alert" title="Could not load activity">{res.error.message}</Empty></div>
{:else if d === undefined}
  <div class="grid" aria-busy="true">
    {#each [0, 1, 2, 3] as i (i)}<div class="card card-b sk"><div class="skel-rows"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div></div>{/each}
  </div>
{:else if !totals.days && !bands.length}
  <div class="card"><Empty icon="calendar" title="No activity in this range">Run a Claude Code or Codex session in this project and it shows up here.</Empty></div>
{:else}
  <div class="kpis">
    <div class="card kpi"><span class="eyebrow">Active days</span><b class="tnum">{totals.active}<span class="of">/{totals.days}</span></b></div>
    <div class="card kpi"><span class="eyebrow">Focus time</span><b class="tnum">{fmtDur(d.focusMs)}</b><span class="faint">{d.awayCount != null ? `${d.awayCount} breaks` : ''}</span></div>
    <div class="card kpi"><span class="eyebrow">Median turn</span><b class="tnum">{fmtDur(turns.medianMs)}</b><span class="faint">p90 {fmtDur(turns.p90Ms)}</span></div>
    <div class="card kpi"><span class="eyebrow">Peak hour</span><b class="tnum">{peak >= 0 && hMax > 0 ? hh(peak) : '—'}</b><span class="faint">{busiestDay ? `busiest on ${busiestDay}` : ''}</span></div>
  </div>

  <section class="card" aria-labelledby="act-cal">
    <div class="card-h" id="act-cal">
      <Icon name="calendar" size={14} /> Calendar
      <span class="sub">{fmtNum(totals.sessions)} sessions · {fmtNum(totals.prompts)} prompts · {fmtUsd(totals.usd)}</span>
      <span class="spacer"></span>
      <div class="segc" role="group" aria-label="Calendar metric">
        {#each METRICS as m (m.k)}<button class:on={metric === m.k} aria-pressed={metric === m.k} onclick={() => (metric = m.k)}>{m.label}</button>{/each}
      </div>
    </div>
    <div class="card-b" bind:clientWidth={calW}><CalendarHeatmap data={heat} days={heatDays} cell={heatCell} unit={metric === 'usd' ? 'USD' : metric} /></div>
  </section>

  <div class="grid">
    <section class="card" aria-labelledby="act-punch">
      <div class="card-h" id="act-punch">Weekday × hour <span class="sub">prompts</span></div>
      <div class="card-b">
        {#if weekHour}
          <div class="punch-wrap">
            <svg class="punch" viewBox="0 0 {30 + 24 * 14} {7 * 16 + 16}" role="img" aria-label="Prompts by weekday and hour. Busiest day {busiestDay || 'none'}, peak hour {peak >= 0 ? hh(peak) : 'none'}">
              {#each weekHour as row, di (di)}
                <text class="lb" x="0" y={di * 16 + 11}>{DAYS[di]}</text>
                {#each row as v, h (h)}
                  {@const r = (Number(v) || 0) > 0 ? 1.5 + Math.sqrt((Number(v) || 0) / whMax) * 5.2 : 0}
                  {#if r}<circle cx={30 + h * 14 + 7} cy={di * 16 + 7} {r} style="opacity:{0.35 + 0.65 * ((Number(v) || 0) / whMax)}"><title>{DAYS[di]} {hh(h)}: {v}</title></circle>
                  {:else}<circle class="z" cx={30 + h * 14 + 7} cy={di * 16 + 7} r="1" />{/if}
                {/each}
              {/each}
              {#each [0, 6, 12, 18, 23] as h (h)}<text class="lb" x={30 + h * 14 + 7} y={7 * 16 + 10} text-anchor="middle">{h}</text>{/each}
            </svg>
          </div>
        {:else}<span class="faint small">No hourly data.</span>{/if}
      </div>
    </section>

    <section class="card" aria-labelledby="act-hour">
      <div class="card-h" id="act-hour">By hour of day</div>
      <div class="card-b">
        {#if hourly}
          <div class="bars" role="img" aria-label="Activity by hour of day, peak at {hh(peak)}">
            {#each hourly as v, h (h)}
              <div class="bc" title="{hh(h)}: {v}"><span class="b" class:pk={h === peak} style="height:{Math.max(v ? 4 : 0, (v / hMax) * 100)}%"></span></div>
            {/each}
          </div>
          <div class="axis faint"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
        {:else}<span class="faint small">No hourly data.</span>{/if}
      </div>
    </section>

    <section class="card" aria-labelledby="act-turn">
      <div class="card-h" id="act-turn">Turn time <span class="sub">{fmtNum(turns.count || 0)} turns</span></div>
      <div class="card-b col">
        {#if turns.count}
          <div class="tscale" role="img" aria-label="Median {fmtDur(turns.medianMs)}, p90 {fmtDur(turns.p90Ms)}, longest {fmtDur(turns.maxMs)}">
            <span class="track"></span>
            {#if tPos(turns.medianMs) != null}<span class="fill" style="width:{tPos(turns.medianMs)}%"></span>{/if}
            {#if tPos(turns.p90Ms) != null}<span class="fill p90" style="left:{tPos(turns.medianMs) || 0}%;width:{tPos(turns.p90Ms) - (tPos(turns.medianMs) || 0)}%"></span>{/if}
            {#each [['median', turns.medianMs], ['p90', turns.p90Ms], ['max', turns.maxMs]] as [k, v] (k)}
              {#if tPos(v) != null}<span class="mk {k}" style="left:{tPos(v)}%"></span>{/if}
            {/each}
          </div>
          <dl class="tl">
            <div><dt>Median</dt><dd class="tnum">{fmtDur(turns.medianMs)}</dd></div>
            <div><dt>p90</dt><dd class="tnum">{fmtDur(turns.p90Ms)}</dd></div>
            <div><dt>Longest</dt><dd class="tnum">{fmtDur(turns.maxMs)}</dd></div>
          </dl>
          <span class="faint small">Log scale. Half your turns finish within the median; 1 in 10 takes longer than p90.</span>
        {:else}<span class="faint small">No turn timings in this range.</span>{/if}
      </div>
    </section>
  </div>

  <section class="card" aria-labelledby="act-bands">
    <div class="card-h" id="act-bands">Sessions through the day <span class="sub">latest {bands.length}</span></div>
    <div class="card-b">
      {#if !bands.length}
        <span class="faint small">No sessions in this range.</span>
      {:else}
        <div class="bandaxis faint" aria-hidden="true"><span></span><span class="ticks"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></span></div>
        <ul class="bands">
          {#each bands as s (s.sessionId)}
            <li>
              <span class="who"><EntityLink kind="session" id={s.sessionId} label={s.day} /><span class="faint sid mono ellipsis">{s.sessionId}</span></span>
              <span class="lane">
                <span class="band" class:ov={s.overflow} style="left:{s.left}%;width:{s.width}%" title="{new Date(s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · active {fmtDur(s.activeMs)} · {s.prompts ?? '—'} prompts">
                  {#if s.activePct != null}<span class="act" style="width:{s.activePct * 100}%"></span>{/if}
                </span>
              </span>
              <span class="meta faint tnum">{fmtDur(s.activeMs)}</span>
            </li>
          {/each}
        </ul>
        <div class="faint small legend"><span class="sw full"></span> session span <span class="sw part"></span> active share</div>
      {/if}
    </div>
  </section>
{/if}

<style>
  .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
  .kpi { padding: 12px 14px; display: flex; flex-direction: column; gap: 3px; }
  .kpi b { font-size: 21px; font-weight: 650; letter-spacing: -0.02em; color: var(--text); }
  .kpi .of { font-size: 13px; color: var(--text-3); font-weight: 500; }
  .kpi .faint { font-size: 11.5px; min-height: 1em; }
  .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin: 16px 0; }
  .sk { padding-top: 16px; }
  .small { font-size: 12.5px; }
  .card-h { flex-wrap: wrap; }
  .punch-wrap { overflow-x: auto; }
  .punch { width: 100%; min-width: 300px; height: auto; display: block; }
  .punch circle { fill: var(--accent); }
  .punch circle.z { fill: var(--border-strong); }
  .lb { fill: var(--text-3); font-size: 8.5px; }
  .bars { display: flex; align-items: flex-end; gap: 2px; height: 120px; }
  .bc { flex: 1; height: 100%; display: flex; align-items: flex-end; }
  .b { width: 100%; border-radius: 3px 3px 0 0; background: color-mix(in srgb, var(--accent) 55%, transparent); transition: height 0.5s var(--ease); }
  .b.pk { background: var(--accent); }
  .axis { display: flex; justify-content: space-between; font-size: 10.5px; margin-top: 4px; }
  .tscale { position: relative; height: 26px; margin: 6px 4px 2px; }
  .track { position: absolute; left: 0; right: 0; top: 11px; height: 4px; border-radius: 99px; background: var(--inset); }
  .fill { position: absolute; left: 0; top: 11px; height: 4px; border-radius: 99px; background: var(--ok); }
  .fill.p90 { background: var(--warn); opacity: 0.8; }
  .mk { position: absolute; top: 5px; width: 2px; height: 16px; margin-left: -1px; border-radius: 2px; background: var(--text-2); }
  .mk.max { background: var(--err); }
  .tl { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 0; }
  .tl dt { font-size: 11px; color: var(--text-3); }
  .tl dd { margin: 0; font-weight: 650; font-size: 15px; }
  .bandaxis, .bands li { display: grid; grid-template-columns: minmax(110px, 200px) minmax(0, 1fr) 54px; gap: 12px; align-items: center; }
  .ticks { display: flex; justify-content: space-between; font-size: 10.5px; }
  .bands { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .who { display: flex; flex-direction: column; gap: 0; font-size: 12.5px; min-width: 0; }
  .who :global(.elink) { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sid { font-size: 10.5px; }
  .lane { position: relative; height: 14px; border-radius: 4px; background: repeating-linear-gradient(90deg, var(--inset) 0 calc(25% - 1px), var(--border) calc(25% - 1px) 25%); }
  .band { position: absolute; top: 2px; bottom: 2px; border-radius: 4px; background: color-mix(in srgb, var(--accent) 30%, transparent); overflow: hidden; min-width: 3px; }
  .band.ov { border-top-right-radius: 0; border-bottom-right-radius: 0; }
  .act { display: block; height: 100%; background: var(--accent); border-radius: 4px; }
  .meta { font-size: 11.5px; text-align: right; }
  .legend { display: flex; align-items: center; gap: 6px; margin-top: 10px; }
  .sw { width: 14px; height: 8px; border-radius: 3px; display: inline-block; }
  .sw.full { background: color-mix(in srgb, var(--accent) 30%, transparent); }
  .sw.part { background: var(--accent); margin-left: 8px; }
  @media (max-width: 1100px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 760px) {
    .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .grid { grid-template-columns: minmax(0, 1fr); }
    .bandaxis, .bands li { grid-template-columns: 96px minmax(0, 1fr) 40px; gap: 8px; }
  }
  @media (prefers-reduced-motion: reduce) { .b { transition: none; } }
</style>
