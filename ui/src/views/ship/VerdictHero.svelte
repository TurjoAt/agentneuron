<script>
  // Verdict hero: one glance answer to "is this verified?", with the reasons behind it.
  import Icon from '../../lib/Icon.svelte';
  import { VERDICT, plural } from './shared.js';

  let { report, summary = null } = $props();
  const v = $derived(VERDICT[report.verdict] || VERDICT.unverified);
  const reasons = $derived([...(report.reasons || [])].sort((a, b) => ({ err: 0, warn: 1, ok: 2 })[a.level] - ({ err: 0, warn: 1, ok: 2 })[b.level]));
  const checksPassed = $derived((report.checks || []).filter((c) => c.status === 'passed' && !c.stale).length);
  const cs = $derived(report.criteriaSummary || { criteria: 0, verified: 0 });
  const ready = $derived(summary?.readiness);
</script>

<section class="card hero {v.tone}" aria-labelledby="ship-verdict">
  <div class="glow" aria-hidden="true"></div>
  <div class="main">
    <div class="ring" aria-hidden="true"><Icon name={v.icon} size={26} /></div>
    <div class="col txt">
      <span class="eyebrow">Completion verdict</span>
      <h2 id="ship-verdict">{v.label}</h2>
      <p class="muted">{v.line}</p>
    </div>
  </div>
  <dl class="stats">
    <div><dt>Changed</dt><dd class="tnum">{plural(report.totals?.files || 0, 'file')} <span class="add">+{report.totals?.added || 0}</span> <span class="del">−{report.totals?.removed || 0}</span></dd></div>
    <div><dt>Checks</dt><dd class="tnum">{report.checks?.length ? `${checksPassed}/${report.checks.length} passing` : 'none detected'}</dd></div>
    <div><dt>Criteria</dt><dd class="tnum">{cs.criteria ? `${cs.verified}/${cs.criteria} verified` : 'none defined'}</dd></div>
    {#if ready}<div><dt>Readiness</dt><dd class:bad={!ready.ready}>{ready.ready ? 'ready' : plural(ready.blockers, 'blocker')}</dd></div>{/if}
  </dl>
  {#if reasons.length}
    <ul class="reasons" aria-label="Reasons">
      {#each reasons as r, i (i)}
        <li class={r.level}><Icon name={r.level === 'ok' ? 'check' : r.level === 'err' ? 'x' : 'alert'} size={13} /><span>{r.text}</span></li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .hero { padding: 20px; display: grid; gap: 16px; overflow: hidden; --tone: var(--info); --tone-soft: var(--info-soft); }
  .hero.ok { --tone: var(--ok); --tone-soft: var(--ok-soft); }
  .hero.warn { --tone: var(--warn); --tone-soft: var(--warn-soft); }
  .hero.err { --tone: var(--err); --tone-soft: var(--err-soft); }
  .glow { position: absolute; inset: -40% -10% auto auto; width: 60%; height: 180%; background: radial-gradient(closest-side, var(--tone-soft), transparent); pointer-events: none; }
  .main { display: flex; gap: 16px; align-items: center; min-width: 0; }
  .ring { width: 56px; height: 56px; flex-shrink: 0; border-radius: 50%; display: grid; place-items: center; color: var(--tone); background: var(--tone-soft); box-shadow: 0 0 0 1px color-mix(in srgb, var(--tone) 35%, transparent), 0 0 0 6px var(--tone-soft); animation: pop 0.5s var(--ease-spring) backwards; }
  @keyframes pop { from { transform: scale(0.6); opacity: 0; } }
  .txt { gap: 2px; }
  h2 { margin: 0; font-size: 24px; letter-spacing: -0.01em; color: var(--tone); }
  .txt p { margin: 0; font-size: 13px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin: 0; }
  .stats > div { background: var(--inset); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 12px; min-width: 0; }
  dt { font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
  dd { margin: 2px 0 0; font-weight: 600; font-size: 14px; }
  dd.bad { color: var(--err); }
  .add { color: var(--ok); font-weight: 500; font-size: 12px; }
  .del { color: var(--err); font-weight: 500; font-size: 12px; }
  .reasons { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
  .reasons li { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 4px 9px; border-radius: 99px; background: var(--panel-active); color: var(--text-2); max-width: 100%; }
  .reasons li span { overflow-wrap: anywhere; }
  .reasons li.err { background: var(--err-soft); color: var(--err); }
  .reasons li.warn { background: var(--warn-soft); color: var(--warn); }
  .reasons li.ok { background: var(--ok-soft); color: var(--ok); }
  @media (max-width: 480px) { .hero { padding: 16px; } h2 { font-size: 20px; } .ring { width: 46px; height: 46px; } }
</style>
