<script>
  import { api, apiUrl, isMock } from '../lib/api.js';
  import { resource } from '../lib/resource.svelte.js';
  import { navigate, toast } from '../lib/store.svelte.js';
  import { fmtNum } from '../lib/format.js';
  import { TOOLS } from '../lib/tools.js';
  import Icon from '../lib/Icon.svelte';
  import Empty from '../lib/Empty.svelte';
  import LineChart from '../lib/viz/LineChart.svelte';
  import BarChart from '../lib/viz/BarChart.svelte';
  import CalendarHeatmap from '../lib/viz/CalendarHeatmap.svelte';
  import KpiTile from './reports/KpiTile.svelte';
  import TopTables from './reports/TopTables.svelte';

  let { params = {} } = $props();

  const DAY = 86_400_000;
  const PRESETS = [['24h', DAY], ['7d', 7 * DAY], ['30d', 30 * DAY], ['90d', 90 * DAY]];
  const dstr = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // ---- range lives in route params: range=24h|7d|30d|90d|custom, from/to=YYYY-MM-DD, cmp=0|1, split, by
  const preset = $derived(['24h', '7d', '30d', '90d', 'custom'].includes(params.range) ? params.range : '7d');
  const cmp = $derived(params.cmp !== '0');
  const split = $derived(['none', 'tool', 'kind', 'author'].includes(params.split) ? params.split : 'tool');
  let by = $state(params.by || 'churn');

  const range = $derived.by(() => {
    if (preset === 'custom') {
      const f = Date.parse(`${params.from || dstr(Date.now() - 7 * DAY)}T00:00:00`);
      const t = Date.parse(`${params.to || dstr(Date.now())}T23:59:59`);
      if (Number.isFinite(f) && Number.isFinite(t)) return f <= t ? { from: f, to: Math.min(t, Date.now() + 60_000) } : { from: t, to: f };
    }
    const ms = PRESETS.find((p) => p[0] === preset)?.[1] ?? 7 * DAY;
    const to = Math.floor(Date.now() / 60_000) * 60_000;
    return { from: to - ms, to };
  });
  const span = $derived(range.to - range.from);
  const bucket = $derived(span <= 2 * DAY + 1000 ? 'hour' : span > 150 * DAY ? 'week' : 'day');
  const prevRange = $derived({ from: range.from - span, to: range.from });

  function set(patch) {
    navigate('reports', { range: preset, from: params.from, to: params.to, cmp: cmp ? undefined : '0', split, ...patch });
  }
  function pickCustom(k, v) {
    set({ range: 'custom', from: params.from || dstr(range.from), to: params.to || dstr(range.to), [k]: v });
  }

  // ---- data
  const summary = resource(() => api('/api/reports/summary', { from: range.from, to: range.to }), { key: () => range });
  const S = (metric, rg, sp = 'none') => api('/api/reports/series', { from: rg.from, to: rg.to, bucket, metric, split: sp });
  const main = resource(async () => {
    const [cur, prev] = await Promise.all([S('changes', range, split), cmp ? S('changes', prevRange, 'none').catch(() => null) : null]);
    return { cur, prev };
  }, { key: () => ({ range, split, cmp, bucket }) });
  const others = resource(async () => {
    const m = ['lines', 'tokens', 'health', 'tasks', 'agents', 'commits'];
    const r = await Promise.all(m.map((x) => S(x, range).catch(() => null)));
    return Object.fromEntries(m.map((x, i) => [x, r[i]]));
  }, { key: () => ({ range, bucket }) });
  const heat = resource(() => api('/api/reports/heatmap', { days: 365 }), { key: () => 'h', live: false });

  // ---- helpers
  const kp = $derived(summary.data?.kpis);
  const pv = $derived(summary.data?.prev);
  const sumAt = (s, n) => Array.from({ length: n }, (_, i) => (s?.series || []).reduce((a, x) => a + (x.values?.[i] || 0), 0));
  const nameOf = (k) => TOOLS[k]?.label || (k === 'all' ? 'All' : k);
  const lab = (arr) => arr.map((s) => ({ ...s, label: s.label || nameOf(s.key) }));
  const fill = (vals) => {
    let last = vals.find((v) => v != null) ?? 0;
    return vals.map((v) => (v == null ? last : (last = v)));
  };

  const cur = $derived(main.data?.cur);
  const chSeries = $derived(lab(cur?.series || []));
  const chCompare = $derived.by(() => {
    const p = main.data?.prev;
    if (!cmp || !p || !cur) return null;
    return { label: 'Previous period', values: sumAt(p, cur.buckets.length) };
  });
  const O = $derived(others.data || {});
  const linesS = $derived.by(() => {
    const s = O.lines?.series || [];
    const nm = { added: 'Added', removed: 'Removed', all: 'Lines changed' };
    return s.map((x) => ({ ...x, label: nm[x.key] || x.key }));
  });
  const tokS = $derived(O.tokens?.series?.length ? [{ key: 'tokens', label: 'Tokens', values: fill(O.tokens.series[0].values) }] : []);
  const healthS = $derived(O.health?.series?.length ? [{ key: 'health', label: 'Health', values: fill(O.health.series[0].values) }] : []);
  const burn = $derived.by(() => {
    const s = O.tasks?.series || [];
    if (!s.length) return [];
    const by = Object.fromEntries(s.map((x) => [x.key, x.values]));
    const cum = (a) => { let t = 0; return a.map((v) => (t += v || 0)); };
    if (by.done) { // level series: open + done = total opened so far
      const done = fill(by.done), open = fill(by.open || []);
      return [{ key: 'opened', label: 'Opened (total)', values: done.map((d, i) => d + (open[i] || 0)) }, { key: 'closed', label: 'Closed', values: done }];
    }
    return [{ key: 'opened', label: 'Opened (total)', values: cum(by.opened || []) }, { key: 'closed', label: 'Closed', values: cum(by.closed || []) }];
  });
  const agentsS = $derived(lab(O.agents?.series || []));
  const commitsS = $derived(lab(O.commits?.series || []));
  const hasData = (s) => s.some((x) => x.values?.some((v) => v));

  const sp = (s) => sumAt(s, s?.buckets?.length || 0);
  const sparks = $derived({
    changes: cur ? sumAt(main.data?.cur, cur.buckets.length) : null,
    commits: O.commits ? sp(O.commits) : null,
    agentEdits: O.agents ? sp(O.agents) : null,
    linesAdded: O.lines?.series?.length ? (O.lines.series.find((x) => x.key === 'added') || O.lines.series[0]).values : null,
    linesRemoved: O.lines?.series?.find((x) => x.key === 'removed')?.values ?? null,
    tokensNow: tokS[0]?.values ?? null,
    healthNow: healthS[0]?.values ?? null,
    tasksClosed: burn[1]?.values ?? null,
  });
  const sparkPrev = $derived(chCompare && cur ? chCompare.values : null);

  const KPIS = [
    ['changes', 'Changes'], ['filesTouched', 'Files touched'], ['commits', 'Commits'], ['agentEdits', 'Agent edits'],
    ['linesAdded', 'Lines added'], ['linesRemoved', 'Lines removed'], ['tokensNow', 'Context tokens'], ['healthNow', 'Health score'],
    ['tasksOpened', 'Tasks opened'], ['tasksClosed', 'Tasks closed'], ['activeSessions', 'Agent sessions'],
  ];
  const kColor = { linesAdded: 'var(--ok)', linesRemoved: 'var(--err)', healthNow: 'var(--ok)', tasksClosed: 'var(--ok)' };
  const rangeLabel = $derived(`${new Date(range.from).toLocaleDateString()} – ${new Date(range.to).toLocaleDateString()}`);

  // ---- export
  async function exportAs(format) {
    try {
      if (isMock()) {
        const r = await api('/api/reports/export', { from: range.from, to: range.to, format });
        const url = URL.createObjectURL(new Blob([r.content], { type: r.mime }));
        dl(url, r.filename);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      } else {
        dl(apiUrl('/api/reports/export', { from: range.from, to: range.to, format }), '');
      }
    } catch (e) {
      toast(`Export failed: ${e.message}`, 'error');
    }
  }
  function dl(href, name) {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  const allEmpty = $derived(summary.data && !kp?.changes && !kp?.commits && !hasData(chSeries));
</script>

<div class="page">
  <div class="page-h">
    <div>
      <h1>Reports</h1>
      <p>{rangeLabel} · {bucket === 'hour' ? 'hourly' : bucket === 'week' ? 'weekly' : 'daily'} buckets</p>
    </div>
    <span class="grow"></span>
    <div class="ctl">
      <div class="segc" role="group" aria-label="Time range">
        {#each ['24h', '7d', '30d', '90d', 'custom'] as p (p)}
          <button class:on={preset === p} onclick={() => set(p === 'custom' ? { range: 'custom', from: dstr(range.from), to: dstr(range.to) } : { range: p, from: undefined, to: undefined })}>{p === 'custom' ? 'Custom' : p}</button>
        {/each}
      </div>
      {#if preset === 'custom'}
        <div class="dates">
          <input class="input sm" type="date" aria-label="From" value={params.from || dstr(range.from)} max={dstr(Date.now())} onchange={(e) => pickCustom('from', e.currentTarget.value)} />
          <span class="faint">→</span>
          <input class="input sm" type="date" aria-label="To" value={params.to || dstr(range.to)} max={dstr(Date.now())} onchange={(e) => pickCustom('to', e.currentTarget.value)} />
        </div>
      {/if}
      <label class="sw-l"><input type="checkbox" class="sw sm" checked={cmp} onchange={(e) => set({ cmp: e.currentTarget.checked ? undefined : '0' })} /> Compare to previous</label>
      <div class="exp">
        {#each [['csv', 'CSV'], ['md', 'MD'], ['html', 'HTML']] as [f, l] (f)}
          <button class="btn sm" onclick={() => exportAs(f)} title="Download report as {l}"><Icon name="download" size={13} /> {l}</button>
        {/each}
      </div>
    </div>
  </div>

  {#if summary.error && !summary.data}
    <div class="card"><Empty icon="alert" title="Reports unavailable">{summary.error.message}</Empty></div>
  {:else}
    <div class="kpis">
      {#each KPIS as [k, label] (k)}
        {#if kp && kp[k] != null}
          <KpiTile {label} value={kp[k]} prev={pv?.[k] ?? null} compare={cmp} spark={sparks[k]} sparkPrev={k === 'changes' ? sparkPrev : null}
            invert={k === 'linesRemoved'} color={kColor[k] || 'var(--accent)'} />
        {/if}
      {/each}
    </div>

    {#if allEmpty}
      <div class="card" style="margin-top:16px"><Empty icon="activity" title="No activity in this period">Try a longer range.</Empty></div>
    {/if}

    <div class="grid">
      <section class="card wide">
        <div class="card-h">
          Changes over time
          <span class="grow"></span>
          <div class="segc" role="group" aria-label="Split by">
            {#each [['none', 'Total'], ['tool', 'By tool'], ['kind', 'By kind'], ['author', 'By author']] as [v, l] (v)}
              <button class:on={split === v} onclick={() => set({ split: v })}>{l}</button>
            {/each}
          </div>
        </div>
        <div class="cb">
          {#if cur}
            <LineChart buckets={cur.buckets} series={chSeries} mode={split === 'none' ? 'area' : 'stacked'} compare={split === 'none' ? chCompare : null} {bucket} height={240} label="Changes over time" />
          {:else}<div class="ph">Loading…</div>{/if}
        </div>
      </section>

      {#if linesS.length && hasData(linesS)}
        <section class="card">
          <div class="card-h">Lines added / removed</div>
          <div class="cb"><BarChart buckets={O.lines.buckets} series={linesS} {bucket} height={190} label="Lines" /></div>
        </section>
      {/if}
      {#if tokS.length}
        <section class="card">
          <div class="card-h">Context tokens <span class="sub">growth</span></div>
          <div class="cb"><LineChart buckets={O.tokens.buckets} series={tokS} mode="area" {bucket} height={190} yFormat={fmtNum} label="Tokens" legend={false} /></div>
        </section>
      {/if}
      {#if healthS.length}
        <section class="card">
          <div class="card-h">Health trend</div>
          <div class="cb"><LineChart buckets={O.health.buckets} series={healthS} mode="line" {bucket} height={190} yMin={0} yMax={100} label="Health" legend={false} /></div>
        </section>
      {/if}
      {#if burn.length && hasData(burn)}
        <section class="card">
          <div class="card-h">Tasks <span class="sub">opened vs closed (burnup)</span></div>
          <div class="cb"><LineChart buckets={O.tasks.buckets} series={burn} mode="line" {bucket} height={190} label="Tasks burnup" /></div>
        </section>
      {/if}
      {#if hasData(agentsS)}
        <section class="card">
          <div class="card-h">Agent activity <span class="sub">edits by agents</span></div>
          <div class="cb"><BarChart buckets={O.agents.buckets} series={agentsS} {bucket} height={190} label="Agent activity" /></div>
        </section>
      {/if}
      {#if hasData(commitsS)}
        <section class="card">
          <div class="card-h">Commits</div>
          <div class="cb"><BarChart buckets={O.commits.buckets} series={commitsS} {bucket} height={190} label="Commits" /></div>
        </section>
      {/if}
    </div>

    <div class="tt"><TopTables from={range.from} to={range.to} bind:by onby={(v) => set({ by: v })} /></div>

    {#if Array.isArray(heat.data) && heat.data.length}
      <section class="card tt">
        <div class="card-h">Activity <span class="sub">past year · changes + commits</span></div>
        <div class="cb hm">
          <CalendarHeatmap data={heat.data} days={365} onselect={(c) => c?.date && set({ range: 'custom', from: String(c.date).slice(0, 10), to: String(c.date).slice(0, 10) })} />
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  .grow { flex: 1; }
  .ctl { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .dates { display: flex; align-items: center; gap: 6px; }
  .input.sm { height: 28px; font-size: 12px; padding: 0 8px; width: 140px; }
  .sw-l { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-2); cursor: pointer; white-space: nowrap; }
  .exp { display: flex; gap: 6px; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 16px; }
  .wide { grid-column: 1 / -1; }
  .card-h { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .cb { padding: 4px 16px 14px; min-width: 0; }
  .ph { height: 200px; display: grid; place-items: center; color: var(--text-3); font-size: 13px; }
  .tt { margin-top: 16px; }
  .hm { overflow-x: auto; padding-bottom: 16px; }
  @media (max-width: 900px) {
    .grid { grid-template-columns: minmax(0, 1fr); }
    .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .ctl { width: 100%; }
  }
</style>
