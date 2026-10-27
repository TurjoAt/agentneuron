<script>
  // Review guardian: summary strip, "read these first", files grouped by kind with risk chips and expandable reasons.
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { openFile } from '../../lib/store.svelte.js';
  import { fmtNum, basename, dirname } from '../../lib/format.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';
  import Skeleton from '../../lib/viz/Skeleton.svelte';
  import { RISK_TONE, SEV_TONE, GROUP_LABEL, STATUS_LABEL, plural } from './shared.js';

  let { params = {}, go } = $props();
  const base = $derived(params.base || '');
  const res = resource((k) => api('/api/changes/review', k.base ? { base: k.base } : {}), { key: () => ({ base }) });
  const d = $derived(res.data);
  const files = $derived(Array.isArray(d?.files) ? d.files : []);
  const byPath = $derived(new Map(files.map((f) => [f.path, f])));
  let filter = $state('all');
  let open = $state(new Set());
  let baseInput = $state('');
  $effect(() => { baseInput = base; });

  const shown = (f) => filter === 'all' || f.risk === filter || (filter === 'tests' && f.missingTest);
  const groups = $derived((d?.groups || []).map((g) => ({ ...g, rows: g.files.map((p) => byPath.get(p)).filter((f) => f && shown(f)) })).filter((g) => g.rows.length));
  const toggle = (p) => { const s = new Set(open); s.has(p) ? s.delete(p) : s.add(p); open = s; };
  const topReason = (f) => f.reasons.find((r) => r.severity === f.risk) || f.reasons[0];
  function apply(e) {
    e.preventDefault();
    go({ base: baseInput.trim() || undefined });
  }
</script>

<form class="bar" onsubmit={apply}>
  <label class="faint small" for="rv-base">Compare against</label>
  <input id="rv-base" class="input mono" placeholder="HEAD (uncommitted changes)" bind:value={baseInput} spellcheck="false" autocomplete="off" />
  <button class="btn sm" type="submit">Review</button>
  <span class="grow"></span>
  <button class="btn sm ghost" type="button" onclick={() => res.reload()} title="Re-read the diff" aria-label="Refresh"><Icon name="refresh" size={13} /></button>
</form>

{#if res.error && !d}
  <div class="card"><Empty icon="alert" title="Could not review the changes">{res.error.message}</Empty></div>
{:else if !d}
  <Skeleton kind="kpis" count={4} label="Reviewing the diff" />
  <section class="card gap"><div class="card-b pad"><Skeleton kind="table" /></div></section>
{:else if d.available === false}
  <div class="card"><Empty icon="git" title="No git repository">{d.reason}. The review reads the diff from git.</Empty></div>
{:else if !files.length}
  <div class="card"><Empty icon="check" title="Nothing to review">No changes {d.base ? `against ${d.base}` : 'in the working tree'}. Edit files (or pick an older base like <code>HEAD~3</code>) and the risk review appears here.</Empty></div>
{:else}
  <div class="strip">
    <div class="card stat"><div class="eyebrow">Files</div><div class="big tnum">{fmtNum(d.summary.files)}</div><div class="faint tiny">{d.base ? `vs ${d.base}${d.head ? `..${d.head}` : ''}` : 'vs empty tree'}</div></div>
    <div class="card stat"><div class="eyebrow">Lines</div><div class="big tnum"><span class="add">+{fmtNum(d.summary.added)}</span> <span class="del">−{fmtNum(d.summary.removed)}</span></div></div>
    <div class="card stat">
      <div class="eyebrow">Risk</div>
      <div class="risks">
        <button class="chip" class:on={filter === 'high'} onclick={() => (filter = filter === 'high' ? 'all' : 'high')}><span class="dot err"></span>{d.summary.high} high</button>
        <button class="chip" class:on={filter === 'medium'} onclick={() => (filter = filter === 'medium' ? 'all' : 'medium')}><span class="dot warn"></span>{d.summary.medium} med</button>
        <button class="chip" class:on={filter === 'low'} onclick={() => (filter = filter === 'low' ? 'all' : 'low')}><span class="dot ok"></span>{d.summary.low} low</button>
      </div>
    </div>
    <div class="card stat">
      <div class="eyebrow">Missing tests</div>
      <button class="big tnum linkish" class:warnc={d.summary.missingTests > 0} onclick={() => (filter = filter === 'tests' ? 'all' : 'tests')} title="Show source files without a test file">{fmtNum(d.summary.missingTests)}</button>
    </div>
  </div>
  {#if d.truncated}<p class="faint small note"><Icon name="info" size={12} /> Large diff: only the first files and part of the patch were analysed.</p>{/if}

  {#if d.readFirst?.length}
    <section class="card gap">
      <div class="card-h"><Icon name="flag" size={14} /> Read these first <span class="sub">highest risk first</span></div>
      <ol class="first">
        {#each d.readFirst as p, i (p)}
          {@const f = byPath.get(p)}
          <li>
            <span class="n tnum">{i + 1}</span>
            {#if f}<span class="badge {RISK_TONE[f.risk]} xs">{f.risk}</span>{/if}
            <div class="grow">
              <EntityLink kind="file" id={p} title={p}><span class="bn">{basename(p)}</span>{#if dirname(p)}<span class="dn faint"> {dirname(p)}/</span>{/if}</EntityLink>
              {#if f && topReason(f)}<div class="faint tiny ellipsis">{topReason(f).message}</div>{/if}
            </div>
          </li>
        {/each}
      </ol>
    </section>
  {/if}

  {#if filter !== 'all'}
    <p class="small faint note">Showing {filter === 'tests' ? 'files without tests' : `${filter}-risk files`}. <button class="linkish" onclick={() => (filter = 'all')}>Show all</button></p>
  {/if}
  {#each groups as g (g.kind)}
    <section class="card gap">
      <div class="card-h">{GROUP_LABEL[g.kind] || g.kind} <span class="sub">{plural(g.rows.length, 'file')}</span></div>
      <ul class="files">
        {#each g.rows as f (f.path)}
          {@const isOpen = open.has(f.path)}
          <li class="file" class:open={isOpen}>
            <div class="row fr">
              <button class="exp" onclick={() => toggle(f.path)} aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} reasons for ${f.path}`}>
                <span class="chev" class:rot={isOpen}><Icon name="chevron" size={12} /></span>
              </button>
              <span class="badge {RISK_TONE[f.risk]} xs rk">{f.risk}</span>
              <div class="grow pth">
                <EntityLink kind="file" id={f.path} title={f.path}><span class="bn">{basename(f.path)}</span>{#if dirname(f.path)}<span class="dn faint"> {dirname(f.path)}/</span>{/if}</EntityLink>
                <div class="meta faint tiny">
                  <span>{f.untracked ? 'new, untracked' : STATUS_LABEL[f.status] || f.status}{f.from ? ` from ${f.from}` : ''}</span>
                  {#if f.reasons.length}<span>· {plural(f.reasons.length, 'reason')}</span>{/if}
                  {#if f.missingTest}<span class="badge warn xs">no tests</span>{:else if f.tests?.length}<span class="badge xs" title={f.tests.join('\n')}>{plural(f.tests.length, 'test')}</span>{/if}
                </div>
              </div>
              <span class="tnum lines">{#if f.binary}<span class="faint tiny">binary</span>{:else}<span class="add">+{f.added}</span> <span class="del">−{f.removed}</span>{/if}</span>
            </div>
            {#if isOpen}
              <div class="why">
                {#if !f.reasons.length}<p class="faint small">No risk signals: a plain change.</p>{/if}
                <ul class="reasons">
                  {#each f.reasons as r, i (i)}
                    <li>
                      <span class="dot {SEV_TONE[r.severity]}" title={r.severity}></span>
                      <span class="grow">{r.message}</span>
                      {#if r.line && r.side !== 'old'}
                        <button class="linkish tiny mono" onclick={() => openFile(f.path, { line: r.line })} title="Open at line {r.line}">L{r.line}</button>
                      {:else if r.line}
                        <span class="faint tiny mono" title="Line in the old version (removed)">old L{r.line}</span>
                      {/if}
                    </li>
                  {/each}
                </ul>
                {#if f.hunks?.length > 1}
                  <div class="hunks faint tiny">
                    {#each f.hunks as h, i (i)}
                      <span class="hk {h.risk}" title={h.codes.join(', ') || 'no signals'}>@{h.newStart} <span class="add">+{h.added}</span><span class="del">−{h.removed}</span></span>
                    {/each}
                  </div>
                {/if}
                {#if f.tests?.length}<div class="faint tiny">Tests: {#each f.tests as t, i (t)}{#if i}, {/if}<EntityLink kind="file" id={t} mono />{/each}</div>{/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {:else}
    <div class="card gap"><Empty compact icon="filter" title="No files match this filter"><button class="btn sm" onclick={() => (filter = 'all')}>Show all files</button></Empty></div>
  {/each}
{/if}

<style>
  .bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
  .bar .input { width: 240px; max-width: 100%; height: 30px; font-size: 12.5px; }
  .strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
  .stat { padding: 13px 15px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .big { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
  .add { color: var(--ok); }
  .del { color: var(--err); }
  .tiny { font-size: 11px; }
  .gap { margin-top: 14px; }
  .pad { padding-top: 14px; }
  .note { margin: 10px 0 0; display: flex; align-items: center; gap: 6px; }
  .risks { display: flex; gap: 5px; flex-wrap: wrap; }
  .risks .chip { height: 24px; font-size: 12px; padding: 0 8px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; background: var(--text-3); }
  .dot.err { background: var(--err); } .dot.warn { background: var(--warn); } .dot.ok { background: var(--ok); } .dot.info { background: var(--info); }
  .linkish { background: none; border: 0; padding: 0; color: var(--accent); cursor: pointer; font: inherit; text-align: left; }
  .linkish:hover { text-decoration: underline; }
  .big.linkish { color: var(--text); font-size: 22px; }
  .big.linkish.warnc { color: var(--warn); }
  .first { list-style: none; margin: 0; padding: 4px 16px 14px; display: flex; flex-direction: column; gap: 8px; }
  .first li { display: flex; align-items: flex-start; gap: 9px; min-width: 0; }
  .first .n { width: 20px; height: 20px; border-radius: 50%; background: var(--panel-active); display: grid; place-items: center; font-size: 11px; font-weight: 650; flex: none; }
  .bn { font-weight: 600; }
  .dn { font-size: 11.5px; margin-left: 4px; }
  .files { list-style: none; margin: 0; padding: 0 0 6px; }
  .file { border-top: 1px solid var(--border); }
  .file.open { background: var(--panel-hover); }
  .fr { padding: 8px 14px 8px 8px; align-items: flex-start; }
  .exp { background: none; border: 0; color: var(--text-3); cursor: pointer; padding: 3px; border-radius: 6px; margin-top: 1px; }
  .exp:hover { color: var(--text); background: var(--panel-active); }
  .chev { display: inline-flex; transition: transform var(--dur-fast); }
  .chev.rot { transform: rotate(90deg); }
  .rk { margin-top: 2px; min-width: 52px; justify-content: center; }
  .pth { overflow-wrap: anywhere; }
  .meta { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 2px; }
  .lines { font-size: 12px; white-space: nowrap; margin-top: 2px; }
  .why { padding: 0 14px 12px 40px; display: flex; flex-direction: column; gap: 8px; }
  .reasons { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; }
  .reasons li { display: flex; align-items: center; gap: 8px; }
  .hunks { display: flex; flex-wrap: wrap; gap: 6px; }
  .hk { padding: 1px 6px; border-radius: 5px; background: var(--inset); border: 1px solid var(--border); font-family: var(--mono); }
  .hk.high { border-color: color-mix(in srgb, var(--err) 45%, transparent); }
  .hk.medium { border-color: color-mix(in srgb, var(--warn) 45%, transparent); }
  @media (max-width: 640px) {
    .strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .bar .input { flex: 1; width: auto; min-width: 0; }
    .why { padding-left: 14px; }
    .rk { min-width: 0; }
  }
</style>
