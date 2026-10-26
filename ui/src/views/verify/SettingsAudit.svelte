<script>
  // Agent settings audit: Claude Code settings (masked), permission modes used in sessions, MCP auth, findings.
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { fmtPct } from '../../lib/statfmt.js';
  import Empty from '../../lib/Empty.svelte';
  import Icon from '../../lib/Icon.svelte';

  let { params = {} } = $props();
  const res = resource(() => api('/api/usage/settings'), { live: false });
  const d = $derived(res.data);

  const SEV = { high: { tone: 'err', icon: 'error', rank: 0 }, medium: { tone: 'warn', icon: 'alert', rank: 1 }, low: { tone: 'info', icon: 'info', rank: 2 }, info: { tone: '', icon: 'info', rank: 3 } };
  const sev = (s) => SEV[s] || SEV.info;
  const findings = $derived((Array.isArray(d?.findings) ? d.findings : []).slice().sort((a, b) => sev(a.severity).rank - sev(b.severity).rank));
  const sevCounts = $derived(findings.reduce((a, f) => ((a[f.severity] = (a[f.severity] || 0) + 1), a), {}));

  const MODES = [
    { k: 'default', label: 'Default', c: 'var(--text-3)' },
    { k: 'acceptEdits', label: 'Accept edits', c: 'var(--info)' },
    { k: 'auto', label: 'Auto', c: 'var(--accent)' },
    { k: 'plan', label: 'Plan', c: 'var(--ok)' },
    { k: 'bypassPermissions', label: 'Bypass permissions', c: 'var(--err)' },
  ];
  const modes = $derived.by(() => {
    const pm = d?.permissionModes || {};
    const total = MODES.reduce((a, m) => a + (Number(pm[m.k]) || 0), 0);
    return { total, rows: MODES.map((m) => ({ ...m, n: Number(pm[m.k]) || 0, p: total ? (Number(pm[m.k]) || 0) / total : 0 })) };
  });
  const s = $derived(d?.settings || {});
  const hooks = $derived(s.hooks && typeof s.hooks === 'object' ? Object.entries(s.hooks) : []);
  const perms = $derived([
    { k: 'allow', label: 'Allow', tone: 'ok', list: s.permissions?.allow || [] },
    { k: 'ask', label: 'Ask', tone: 'warn', list: s.permissions?.ask || [] },
    { k: 'deny', label: 'Deny', tone: 'err', list: s.permissions?.deny || [] },
  ]);
  const needsAuth = $derived(Array.isArray(d?.mcpNeedsAuth) ? d.mcpNeedsAuth : []);
  const yn = (v) => (v == null ? '—' : v ? 'On' : 'Off');
</script>

{#if res.error && !d}
  <div class="card"><Empty icon="alert" title="Could not read agent settings">{res.error.message}</Empty></div>
{:else if d === undefined}
  <div class="card card-b sk" aria-busy="true"><div class="skel-rows"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div></div>
{:else}
  <div class="grid">
    <section class="card findings" aria-labelledby="sa-f">
      <div class="card-h" id="sa-f">
        <Icon name="shield" size={15} /> Findings
        <span class="spacer"></span>
        {#each ['high', 'medium', 'low'] as k (k)}{#if sevCounts[k]}<span class="badge {sev(k).tone}">{sevCounts[k]} {k}</span>{/if}{/each}
      </div>
      {#if !findings.length}
        <Empty icon="check" title="No findings" compact>Your Claude Code settings look safe.</Empty>
      {:else}
        <ul class="fl">
          {#each findings as f (f.id || f.title)}
            <li class="f {sev(f.severity).tone}">
              <span class="si"><Icon name={sev(f.severity).icon} size={14} /></span>
              <div class="col fb">
                <div class="row ft"><b>{f.title}</b><span class="badge {sev(f.severity).tone}">{f.severity || 'info'}</span></div>
                {#if f.why}<p class="muted">{f.why}</p>{/if}
                {#if f.fix}<p class="fix"><span class="eyebrow">Fix</span> {f.fix}</p>{/if}
                {#if f.location}<span class="loc mono faint">{f.location}</span>{/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="card-b more"><a href="#/verify?tab=audit">Security audit of MCP servers, hooks and agent config →</a></div>
    </section>

    <div class="col side">
      <section class="card" aria-labelledby="sa-m">
        <div class="card-h" id="sa-m">Permission modes <span class="sub">{modes.total} turns</span></div>
        <div class="card-b col">
          {#if !modes.total}
            <span class="faint small">No permission mode data in the selected sessions.</span>
          {:else}
            <div class="stack" role="img" aria-label={modes.rows.filter((m) => m.n).map((m) => `${m.label} ${fmtPct(m.p)}`).join(', ')}>
              {#each modes.rows as m (m.k)}{#if m.n}<span style="flex:{m.n};background:{m.c}" title="{m.label}: {m.n}"></span>{/if}{/each}
            </div>
            <ul class="ml">
              {#each modes.rows as m (m.k)}
                <li class:danger={m.k === 'bypassPermissions' && m.n}>
                  <span class="sw" style="background:{m.c}"></span>
                  <span class="grow">{m.label}</span>
                  <span class="tnum faint">{m.n}</span>
                  <span class="tnum pc">{fmtPct(m.p)}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </section>

      <section class="card" aria-labelledby="sa-mcp">
        <div class="card-h" id="sa-mcp"><Icon name="server" size={14} /> MCP servers needing auth</div>
        <div class="card-b">
          {#if !needsAuth.length}
            <span class="faint small"><Icon name="check" size={12} /> All MCP servers are signed in.</span>
          {:else}
            <div class="chips">{#each needsAuth as n (n)}<span class="badge warn mono"><Icon name="key" size={11} />{n}</span>{/each}</div>
            <p class="faint small">Run <code>/mcp</code> in Claude Code to authenticate.</p>
          {/if}
        </div>
      </section>

      <section class="card" aria-labelledby="sa-s">
        <div class="card-h" id="sa-s"><Icon name="settings" size={14} /> Settings <span class="sub">secrets masked</span></div>
        <div class="card-b col">
          <dl class="kv">
            <dt>Model</dt><dd class="mono">{s.model || '—'}</dd>
            <dt>Advisor model</dt><dd class="mono">{s.advisorModel || '—'}</dd>
            <dt>Auto mode</dt><dd>{yn(s.autoMode)}</dd>
            <dt>Theme</dt><dd>{s.theme || '—'}</dd>
            <dt>Hooks</dt><dd>{#if hooks.length}{#each hooks as [k, n] (k)}<span class="badge mono">{k} {typeof n === 'number' ? n : Array.isArray(n) ? n.length : ''}</span> {/each}{:else}none{/if}</dd>
          </dl>
          {#each perms as p (p.k)}
            <div class="perm">
              <span class="eyebrow">{p.label} <span class="tnum">{p.list.length}</span></span>
              {#if p.list.length}
                <div class="chips">{#each p.list as r (r)}<code class="rule {p.tone}">{r}</code>{/each}</div>
              {:else}<span class="faint small">none</span>{/if}
            </div>
          {/each}
        </div>
      </section>
    </div>
  </div>
{/if}

<style>
  .grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 16px; align-items: start; }
  .side { gap: 16px; }
  .sk { padding-top: 16px; }
  .fl { list-style: none; margin: 0; padding: 0 8px 4px; display: flex; flex-direction: column; gap: 4px; }
  .f { display: flex; gap: 12px; padding: 12px 10px; border-radius: var(--radius-sm); }
  .f + .f { border-top: 1px solid var(--border); }
  .si { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; flex-shrink: 0; background: var(--panel-active); color: var(--text-3); }
  .f.err .si { background: var(--err-soft); color: var(--err); }
  .f.warn .si { background: var(--warn-soft); color: var(--warn); }
  .f.info .si { background: var(--info-soft); color: var(--info); }
  .fb { gap: 4px; flex: 1; }
  .ft { justify-content: space-between; align-items: flex-start; font-size: 13.5px; }
  .fb p { margin: 0; font-size: 12.5px; line-height: 1.5; }
  .fix { color: var(--text); }
  .fix .eyebrow { margin-right: 4px; font-size: 10px; }
  .loc { font-size: 11px; overflow-wrap: anywhere; }
  .more { padding-top: 8px; border-top: 1px solid var(--border); font-size: 12.5px; }
  .stack { display: flex; height: 10px; border-radius: 99px; overflow: hidden; gap: 2px; background: var(--inset); }
  .ml { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; }
  .ml li { display: flex; align-items: center; gap: 8px; padding: 3px 6px; border-radius: 6px; }
  .ml li.danger { background: var(--err-soft); color: var(--err); font-weight: 600; }
  .sw { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; }
  .pc { width: 40px; text-align: right; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .small { font-size: 12.5px; display: inline-flex; align-items: center; gap: 5px; }
  p.small { display: block; margin: 8px 0 0; }
  .kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 14px; margin: 0; font-size: 12.5px; }
  .kv dt { color: var(--text-3); }
  .kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
  .perm { display: flex; flex-direction: column; gap: 5px; padding-top: 8px; border-top: 1px solid var(--border); }
  .rule { font-family: var(--mono); font-size: 11px; padding: 2px 7px; border-radius: 6px; background: var(--panel-active); color: var(--text-2); overflow-wrap: anywhere; }
  .rule.ok { background: var(--ok-soft); color: var(--ok); }
  .rule.warn { background: var(--warn-soft); color: var(--warn); }
  .rule.err { background: var(--err-soft); color: var(--err); }
  @media (max-width: 980px) { .grid { grid-template-columns: minmax(0, 1fr); } }
</style>
