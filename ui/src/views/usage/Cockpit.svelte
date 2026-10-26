<script>
  // Usage cockpit: KPIs, cost/tokens over time, breakdowns, budget, anomalies, tips.
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { app, navigate } from '../../lib/store.svelte.js';
  import { fmtNum, timeAgo } from '../../lib/format.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';
  import ToolBadge from '../../lib/ToolBadge.svelte';
  import LineChart from '../../lib/viz/LineChart.svelte';
  import BarChart from '../../lib/viz/BarChart.svelte';
  import Donut from '../../lib/viz/Donut.svelte';
  import HBars from '../../lib/viz/HBars.svelte';
  import Skeleton from '../../lib/viz/Skeleton.svelte';
  import Kpi from './Kpi.svelte';
  import { usageQuery, money, fmtMs, pct, tokTotal, dayMs, modelLabel, SEVERITY, ANOMALY, ANOMALY_ICON } from './shared.js';

  let { params = {}, range = '30d', agent = 'all' } = $props();

  const sum = resource(() => api('/api/usage/summary', usageQuery(range, agent)), { key: () => [range, agent] });
  const d = $derived(sum.data);
  const k = $derived(d?.kpis || {});
  const series = $derived(Array.isArray(d?.series) ? d.series : []);
  const buckets = $derived(series.map((s) => dayMs(s.date)));
  const col = (key) => series.map((s) => s[key] ?? 0);
  const model = $derived(params.model || '');

  let metric = $state('usd');
  const METRICS = [['usd', 'Cost'], ['tokens', 'Tokens'], ['sessions', 'Sessions'], ['toolCalls', 'Tool calls']];
  const chartSeries = $derived.by(() => {
    if (metric === 'toolCalls') {
      const calls = col('toolCalls');
      const errs = col('errors');
      return [{ key: 'ok', label: 'Succeeded', values: calls.map((c, i) => Math.max(0, c - errs[i])), color: 'var(--accent)' }, { key: 'errors', label: 'Errors', values: errs, color: 'var(--err)' }];
    }
    const label = METRICS.find((m) => m[0] === metric)[1];
    return [{ key: metric, label, values: col(metric) }];
  });
  const yFmt = $derived(metric === 'usd' ? (v) => money(v, { digits: v >= 10 ? 0 : 2 }) : fmtNum);

  // honesty: exact vs estimated split
  const exactUsd = $derived(k.usdExact ?? null);
  const estUsd = $derived(k.usd != null && exactUsd != null ? Math.max(0, k.usd - exactUsd) : null);
  const allExact = $derived(k.usd != null && exactUsd != null && estUsd < 0.005);
  const errRate = $derived(k.toolCalls ? (k.toolErrors || 0) / k.toolCalls : null);
  const cov = $derived(d?.coverage || {});
  const tokens = $derived(tokTotal(k.tokens));

  const models = $derived((d?.byModel || []).map((m) => ({ key: m.model || 'unknown', label: modelLabel(m.model), value: m.usd ?? 0, sub: m.tokens != null ? `${fmtNum(m.tokens)} tok` : null })));
  const branches = $derived((d?.byBranch || []).map((b) => ({ key: b.branch || '(none)', value: b.usd ?? 0, sub: b.sessions != null ? `${b.sessions} sess` : null })));
  const agents = $derived((d?.byAgent || []).filter((a) => a.usd > 0).map((a) => ({ key: a.tool, label: a.tool === 'codex' ? 'Codex' : 'Claude', value: a.usd })));
  const projects = $derived((d?.byProject || []).map((p) => ({ key: p.project, value: p.usd ?? 0, sub: `${p.sessions} sess` })));
  const anomalies = $derived((d?.anomalies || []).slice().sort((a, b) => ['high', 'medium', 'low'].indexOf(a.severity) - ['high', 'medium', 'low'].indexOf(b.severity) || (b.ts || 0) - (a.ts || 0)));
  const b = $derived(d?.budget || null);
  const TIP_ICON = { cache: 'zap', model: 'sparkles', context: 'layers', tools: 'terminal' };

  const replay = (a) => navigate('sessions', { id: a.session, ts: a.ts || undefined });
  const setModel = (m) => navigate('usage', { ...params, tab: 'overview', model: m && m !== model ? m : undefined });
  const empty = $derived(d && !k.sessions);
</script>

{#if sum.error && !d}
  <div class="card"><Empty icon="alert" title="Usage data unavailable">{sum.error.message}<div class="mt"><button class="btn sm" onclick={() => sum.reload()}><Icon name="refresh" size={13} /> Retry</button></div></Empty></div>
{:else if !d}
  <Skeleton kind="kpis" count={8} label="Loading usage" />
  <div class="grid"><section class="card wide"><div class="card-h">Cost over time</div><div class="cb"><Skeleton kind="chart" height={230} /></div></section>
    <section class="card"><div class="card-h">By model</div><div class="cb"><Skeleton kind="bars" count={4} /></div></section>
    <section class="card"><div class="card-h">Anomalies</div><div class="cb"><Skeleton kind="bars" count={4} /></div></section></div>
{:else if empty}
  <div class="card"><Empty icon="activity" title="No agent sessions in this range">Nothing from {agent === 'all' ? 'Claude Code or Codex' : agent === 'codex' ? 'Codex' : 'Claude Code'} in the last {range === 'all' ? 'while' : range}. Try a longer range{agent !== 'all' ? ' or all agents' : ''}.</Empty></div>
{:else}
  {#if model}
    <div class="filter">
      <span class="badge accent">Model <b>{modelLabel(model)}</b> highlighted</span>
      <span class="faint tiny">Totals cover every model; the breakdown marks this one.</span>
      <button class="btn ghost sm" onclick={() => setModel('')}><Icon name="x" size={12} /> Clear</button>
    </div>
  {/if}

  <div class="kpis stagger">
    <Kpi label="Cost" value={k.usd != null ? Math.round(k.usd * 100) : null} format={(c) => money(c / 100, { est: !allExact && exactUsd == null })} spark={col('usd')} invert color="var(--accent-2)"
      hint="Exact cost comes from Claude Code's cost-state; the rest is estimated from token usage at list prices.">
      {#snippet badge()}{#if allExact}<span class="badge ok tiny-b" title="All cost in this range is exact">exact</span>{:else}<span class="badge warn tiny-b" title="Part of this cost is estimated from token usage">incl. estimate</span>{/if}{/snippet}
      {#snippet detail()}
        {#if exactUsd == null}<span>exact/estimated split unknown</span>
        {:else}<span title="From cost-state"><b class="ok-t">{money(exactUsd)}</b> exact</span><span>·</span><span title="Token usage × list price"><b>{money(estUsd, { est: true })}</b> est.</span>{/if}
      {/snippet}
    </Kpi>
    <Kpi label="Sessions" value={k.sessions} format={fmtNum} spark={col('sessions')}>
      {#snippet detail()}<span>{fmtMs(k.activeMs)} active</span>{/snippet}
    </Kpi>
    <Kpi label="Prompts" value={k.prompts} format={fmtNum} trend={false}>
      {#snippet detail()}{#if k.sessions && k.prompts != null}<span>{(k.prompts / k.sessions).toFixed(1)} per session</span>{/if}{/snippet}
    </Kpi>
    <Kpi label="Tool calls" value={k.toolCalls} format={fmtNum} spark={col('toolCalls')}>
      {#snippet detail()}
        {#if errRate != null}<span class:err-t={errRate > 0.08}><Icon name={errRate > 0.08 ? 'alert' : 'check'} size={11} /> {pct(errRate)} errors</span><span>· {fmtNum(k.toolErrors)} failed</span>{/if}
      {/snippet}
    </Kpi>
    <Kpi label="Cache hit rate" value={k.cacheHitRate != null ? Math.round(k.cacheHitRate * 1000) : null} format={(v) => `${(v / 10).toFixed(1)}%`} trend={false} color="var(--ok)">
      {#snippet detail()}{#if k.cacheSavedUsd != null}<span><b class="ok-t">{money(k.cacheSavedUsd, { est: true })}</b> saved by cache</span>{/if}{/snippet}
    </Kpi>
    <Kpi label="Tokens" value={tokens} format={fmtNum} spark={col('tokens')}>
      {#snippet detail()}{#if k.tokens}<span title="input / output">{fmtNum(k.tokens.input)} in · {fmtNum(k.tokens.output)} out</span>{/if}{/snippet}
    </Kpi>
    <Kpi label="Lines changed" value={k.linesAdded != null || k.linesRemoved != null ? (k.linesAdded || 0) + (k.linesRemoved || 0) : null} format={fmtNum} trend={false} color="var(--ok)">
      {#snippet detail()}<span class="ok-t">+{fmtNum(k.linesAdded)}</span><span class="err-t">−{fmtNum(k.linesRemoved)}</span>{/snippet}
    </Kpi>
    <Kpi label="Turn time (median)" value={k.medianTurnMs} format={fmtMs} trend={false} color="var(--info)">
      {#snippet detail()}{#if k.p90TurnMs != null}<span>p90 {fmtMs(k.p90TurnMs)}</span>{/if}{/snippet}
    </Kpi>
  </div>

  <div class="grid">
    <section class="card wide">
      <div class="card-h">
        Over time <span class="sub">{range === 'all' ? 'all time' : `last ${range}`} · daily</span>
        <span class="spacer"></span>
        <div class="segc" role="group" aria-label="Metric">
          {#each METRICS as [id, l] (id)}<button class:on={metric === id} aria-pressed={metric === id} onclick={() => (metric = id)}>{l}</button>{/each}
        </div>
      </div>
      <div class="cb">
        {#if buckets.length > 1}
          {#if metric === 'toolCalls'}
            <BarChart {buckets} series={chartSeries} bucket="day" height={230} label="Tool calls and errors per day" />
          {:else}
            <LineChart {buckets} series={chartSeries} mode="area" bucket="day" height={230} yFormat={yFmt} legend={false} label="{METRICS.find((m) => m[0] === metric)[1]} per day" />
          {/if}
        {:else}<div class="ph faint">Not enough days in this range for a trend.</div>{/if}
      </div>
    </section>

    <section class="card">
      <div class="card-h">By model <span class="sub">cost</span></div>
      <div class="cb">
        {#if models.length}
          <HBars items={models} format={(v) => money(v)} highlight={model} title="Cost by model">
            {#snippet label(it)}<EntityLink kind="model" id={it.key} label={it.label} />{/snippet}
          </HBars>
        {:else}<div class="faint small">No model data.</div>{/if}
      </div>
    </section>

    <section class="card">
      <div class="card-h">Budget <span class="sub">today</span>{#if b?.over}<span class="badge err"><Icon name="alert" size={11} /> over budget</span>{/if}</div>
      <div class="cb">
        {#if b?.dailyUsd}
          {@const ratio = (b.todayUsd || 0) / b.dailyUsd}
          {@const projOver = b.projectedTodayUsd != null && b.projectedTodayUsd > b.dailyUsd}
          <div class="bud">
            <div><span class="bigv tnum">{money(b.todayUsd)}</span><span class="faint">&nbsp;of {money(b.dailyUsd)} daily budget</span></div>
            <div class="track" role="meter" aria-valuemin="0" aria-valuemax={b.dailyUsd} aria-valuenow={b.todayUsd || 0} aria-label="Spent today {money(b.todayUsd)} of {money(b.dailyUsd)}">
              <div class="fill" class:warn={ratio > 0.8} class:err={ratio > 1} style="width:{Math.min(100, ratio * 100)}%"></div>
              {#if b.projectedTodayUsd != null}<div class="proj" style="left:{Math.min(100, (b.projectedTodayUsd / b.dailyUsd) * 100)}%" title="Projected by end of day"></div>{/if}
            </div>
            <div class="bstats">
              <div><div class="eyebrow">Burn rate</div><b class="tnum">{money(b.burnPerHourUsd)}</b><span class="faint">/h</span></div>
              <div><div class="eyebrow">Projected today</div><b class="tnum" class:err-t={projOver}>{money(b.projectedTodayUsd, { est: true })}</b>{#if projOver}<span class="err-t tiny"> over</span>{/if}</div>
              <div><div class="eyebrow">Left</div><b class="tnum">{money(Math.max(0, b.dailyUsd - (b.todayUsd || 0)))}</b></div>
            </div>
          </div>
        {:else}
          <div class="nob">
            <div><span class="bigv tnum">{money(b?.todayUsd)}</span><span class="faint">&nbsp;spent today</span></div>
            {#if b?.burnPerHourUsd != null}<div class="faint small">Burn rate {money(b.burnPerHourUsd)}/h · projected {money(b.projectedTodayUsd, { est: true })}</div>{/if}
            <div class="faint small">No daily budget set. Add <code>"usage": {'{'} "dailyBudgetUsd": 20 {'}'}</code> to <code>.agentneuron/config.json</code> to track it.</div>
          </div>
        {/if}
      </div>
    </section>

    <section class="card">
      <div class="card-h">By agent</div>
      <div class="cb dn">
        {#if agents.length}
          <Donut items={agents} size={132} thickness={16} format={(v) => money(v)} centerLabel="cost" legend={false} onselect={(it) => navigate('usage', { tab: 'overview', range: range === '30d' ? undefined : range, agent: it.key === agent ? undefined : it.key })} />
          <div class="alist">
            {#each d.byAgent || [] as a (a.tool)}
              <div class="arow"><ToolBadge tool={a.tool} /><span class="spacer"></span><span class="tnum">{money(a.usd)}</span><span class="faint tiny">{a.sessions} sess</span></div>
            {/each}
          </div>
        {:else}<div class="faint small">No agent data.</div>{/if}
      </div>
    </section>

    <section class="card">
      <div class="card-h">By branch <span class="sub">cost</span></div>
      <div class="cb">
        {#if branches.length}<HBars items={branches} format={(v) => money(v)} max={6} title="Cost by branch" />{:else}<div class="faint small">No branch data.</div>{/if}
      </div>
    </section>

    {#if projects.length}
      <section class="card">
        <div class="card-h">By project</div>
        <div class="cb"><HBars items={projects} format={(v) => money(v)} title="Cost by project" /></div>
      </section>
    {/if}

    <section class="card wide2">
      <div class="card-h">Anomalies <span class="sub">{anomalies.length || 'none'}</span></div>
      {#if anomalies.length}
        <ul class="anoms">
          {#each anomalies as a (a.id)}
            {@const sv = SEVERITY[a.severity] || SEVERITY.low}
            <li class="anom sev-{sv.cls}">
              <span class="aic"><Icon name={ANOMALY_ICON[a.kind] || 'alert'} size={14} /></span>
              <div class="abody">
                <div class="ah"><span class="badge {sv.cls}">{sv.label}</span><b>{ANOMALY[a.kind] || a.kind}</b><span class="faint tiny">{timeAgo(a.ts, app.now)}</span></div>
                <div class="am">{a.message}</div>
                {#if a.session}<div class="as faint tiny">in <EntityLink kind="session" id={a.session} label={a.session.slice(0, 8)} /></div>{/if}
              </div>
              {#if a.session}<button class="btn sm" onclick={() => replay(a)} aria-label="Replay session at this anomaly"><Icon name="play" size={12} /> Replay</button>{/if}
            </li>
          {/each}
        </ul>
      {:else}
        <Empty icon="check" title="Nothing unusual" compact>No cost spikes, error loops or slow turns in this range.</Empty>
      {/if}
    </section>

    {#if d.tips?.length}
      <section class="tips wide">
        {#each d.tips as t (t.id)}
          <div class="card tip lift">
            <span class="tic"><Icon name={TIP_ICON[t.kind] || 'sparkles'} size={14} /></span>
            <div><div class="eyebrow">{t.kind || 'tip'}</div><div class="tm">{t.message}</div></div>
          </div>
        {/each}
      </section>
    {/if}
  </div>

  <p class="cov faint">
    <Icon name="info" size={12} />
    Based on {fmtNum(cov.transcripts ?? cov.sessions)} transcript{(cov.transcripts ?? cov.sessions) === 1 ? '' : 's'}.
    {#if cov.sessions != null && cov.exactCostSessions != null}
      Exact cost for {cov.exactCostSessions} of {cov.sessions} sessions ({pct(cov.sessions ? cov.exactCostSessions / cov.sessions : null, 0)}); the rest is estimated from tokens at list prices.
    {/if}
    {#if cov.durationTurns != null}Turn times from {fmtNum(cov.durationTurns)} timed turns.{/if}
    Trend pills compare the second half of the range with the first.
  </p>
{/if}

<style>
  .mt { margin-top: 10px; }
  .card-h { flex-wrap: wrap; row-gap: 8px; }
  .filter { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
  .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
  .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }
  .wide { grid-column: 1 / -1; }
  .wide2 { grid-column: span 2; }
  .cb { padding: 2px 16px 14px; min-width: 0; }
  .ph { height: 200px; display: grid; place-items: center; font-size: 13px; }
  .small { font-size: 12.5px; }
  .tiny { font-size: 11px; }
  .tiny-b { font-size: 10px; height: 17px; padding: 0 6px; }
  .ok-t { color: var(--ok); }
  .err-t { color: var(--err); }
  .err-t :global(svg), .dt :global(svg) { vertical-align: -1px; }
  code { font-family: var(--mono); font-size: 11.5px; background: var(--inset); padding: 1px 4px; border-radius: 4px; }
  .bud, .nob { display: flex; flex-direction: column; gap: 10px; }
  .bigv { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
  .track { position: relative; height: 10px; border-radius: 99px; background: var(--panel-active); }
  .fill { height: 100%; border-radius: inherit; background: linear-gradient(90deg, color-mix(in srgb, var(--ok) 50%, transparent), var(--ok)); transition: width 0.9s var(--ease); }
  .fill.warn { background: linear-gradient(90deg, color-mix(in srgb, var(--warn) 50%, transparent), var(--warn)); }
  .fill.err { background: linear-gradient(90deg, color-mix(in srgb, var(--err) 50%, transparent), var(--err)); }
  .proj { position: absolute; top: -4px; bottom: -4px; width: 2px; margin-left: -1px; background: var(--text-2); border-radius: 2px; }
  .proj::after { content: ''; position: absolute; top: -4px; left: -3px; border: 4px solid transparent; border-top-color: var(--text-2); }
  .bstats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; font-size: 13px; }
  .dn { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .dn :global(.dn) { flex: none; }
  .alist { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 140px; font-size: 12.5px; }
  .arow { display: flex; align-items: center; gap: 8px; }
  .anoms { list-style: none; margin: 0; padding: 0 10px 10px; display: flex; flex-direction: column; gap: 4px; }
  .anom { display: flex; gap: 12px; align-items: flex-start; padding: 10px 8px; border-radius: 10px; border-left: 3px solid var(--c); background: color-mix(in srgb, var(--c) 5%, transparent); }
  .sev-err { --c: var(--err); }
  .sev-warn { --c: var(--warn); }
  .sev-info { --c: var(--info); }
  .aic { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; flex: none; color: var(--c); background: color-mix(in srgb, var(--c) 14%, transparent); }
  .abody { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .ah { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 12.5px; }
  .am { font-size: 13px; color: var(--text-2); overflow-wrap: anywhere; }
  .tips { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
  .tip { display: flex; gap: 10px; padding: 13px 14px; align-items: flex-start; }
  .tic { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; flex: none; color: var(--accent); background: var(--accent-soft); }
  .tm { font-size: 12.5px; color: var(--text-2); margin-top: 3px; line-height: 1.5; }
  .cov { font-size: 11.5px; margin: 16px 2px 0; display: flex; gap: 6px; flex-wrap: wrap; align-items: baseline; line-height: 1.5; }
  .cov :global(svg) { vertical-align: -2px; }
  @media (max-width: 1100px) {
    .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .wide2 { grid-column: 1 / -1; }
  }
  @media (max-width: 720px) {
    .grid { grid-template-columns: minmax(0, 1fr); }
    .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .anom { flex-wrap: wrap; }
    .card-h .segc { width: 100%; }
    .card-h .segc button { flex: 1; justify-content: center; padding: 0 4px; }
  }
</style>
