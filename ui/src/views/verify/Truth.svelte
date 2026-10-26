<script>
  import { post } from '../../lib/api.js';
  import { openFile, navigate, toast } from '../../lib/store.svelte.js';
  import { canRun, levelReason } from '../../lib/actions.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';

  let { res, status = '' } = $props();

  const STATUS = {
    false: { label: 'False', icon: 'error', cls: 'err' },
    unknown: { label: 'Unknown', icon: 'info', cls: 'muted' },
    ok: { label: 'OK', icon: 'check', cls: 'ok' },
  };
  const KIND = { command: 'Command', script: 'Script', path: 'Path', version: 'Version', dependency: 'Library', env: 'Env var', port: 'Port' };

  let busy = $state('');
  const data = $derived(res.data);
  const filter = $derived(STATUS[status] ? status : 'false');
  const claims = $derived((data?.claims || []).filter((c) => filter === 'all' || c.status === filter));
  const groups = $derived.by(() => {
    const m = new Map();
    for (const c of claims) {
      if (!m.has(c.file)) m.set(c.file, []);
      m.get(c.file).push(c);
    }
    return [...m.entries()].map(([file, list]) => ({ file, list: list.sort((a, b) => a.line - b.line) }));
  });
  const canFix = $derived(canRun('edit'));

  async function apply(c) {
    busy = c.id;
    try {
      const r = await post('/api/verify/fix', { id: c.id });
      toast(`Fixed ${r.path}:${r.line}: ${r.from} → ${r.to}`, 'ok', 3200);
      res.reload();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      busy = '';
    }
  }
</script>

{#if res.error}
  <Empty icon="alert" title="Could not run the truth check">{res.error.message}</Empty>
{:else if !data}
  <div class="skel" style="height:280px"></div>
{:else}
  <div class="bar row">
    {#each [['false', data.summary.false], ['unknown', data.summary.unknown], ['ok', data.summary.ok]] as [k, n] (k)}
      <button class="chip" class:on={filter === k} onclick={() => navigate('verify', { tab: 'truth', status: k })}>
        <span class="dot {STATUS[k].cls}"></span>{STATUS[k].label} <span class="n">{n}</span>
      </button>
    {/each}
    <button class="chip" class:on={filter === 'all'} onclick={() => navigate('verify', { tab: 'truth', status: 'all' })}>All <span class="n">{data.summary.total}</span></button>
    <span class="spacer"></span>
    <span class="faint small">{data.summary.total} claims in {data.summary.files} context files</span>
    <button class="btn sm ghost" onclick={() => res.reload()} aria-label="Re-run the truth check"><Icon name="refresh" size={13} /></button>
  </div>

  {#if !groups.length}
    <div class="card">
      <Empty icon="shield" title={filter === 'false' ? 'No false claims' : 'Nothing here'}>
        {filter === 'false' ? 'Every checkable command, path and version in your context files matches the repo.' : ''}
      </Empty>
    </div>
  {:else}
    {#if filter === 'false' && !canFix}
      <p class="faint small note"><Icon name="lock" size={12} /> Automatic fixes need the edit level. {levelReason('edit')}</p>
    {/if}
    <div class="col" style="gap:12px">
      {#each groups as g (g.file)}
        <section class="card">
          <div class="card-h"><Icon name="file" size={14} /> <EntityLink kind="file" id={g.file} label={g.file} mono title="{g.file}: which agent sessions read or edited it" /> <span class="sub">{g.list.length}</span></div>
          <ul class="claims">
            {#each g.list as c (c.id)}
              <li class="claim">
                <span class="st {STATUS[c.status].cls}" title={STATUS[c.status].label}><Icon name={STATUS[c.status].icon} size={13} /></span>
                <div class="col body">
                  <div class="row head">
                    <span class="kind">{KIND[c.kind] || c.kind}</span>
                    <code class="txt">{c.text}</code>
                  </div>
                  <span class="faint small">{c.evidence}</span>
                  {#if c.status === 'false' && c.suggestion}
                    <span class="sugg small"><Icon name="wand" size={12} /> {c.suggestion}</span>
                  {/if}
                </div>
                <div class="row acts">
                  {#if c.status === 'false' && c.fixable && canFix}
                    <button class="btn sm" disabled={busy === c.id} onclick={() => apply(c)}>Apply fix</button>
                  {/if}
                  <button class="loc mono" onclick={() => openFile(c.file, { line: c.line, tab: 'raw' })} title="Open at line {c.line}">:{c.line}</button>
                </div>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .bar { gap: 6px; margin-bottom: 14px; flex-wrap: wrap; align-items: center; }
  .spacer { flex: 1; }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 2px; }
  .dot.err { background: var(--err); }
  .dot.ok { background: var(--ok); }
  .dot.muted { background: var(--text-3); }
  .note { display: flex; align-items: center; gap: 6px; margin: 0 0 10px; }
  .claims { list-style: none; margin: 0; padding: 4px 8px 8px; border-top: 1px solid var(--border); }
  .claim { display: flex; gap: 12px; align-items: flex-start; padding: 10px 8px; border-radius: 9px; }
  .claim:hover { background: var(--panel-hover); }
  .st { width: 24px; height: 24px; border-radius: 7px; display: grid; place-items: center; flex-shrink: 0; }
  .st.err { background: var(--err-soft); color: var(--err); }
  .st.ok { background: var(--ok-soft); color: var(--ok); }
  .st.muted { background: var(--panel-hover); color: var(--text-3); }
  .body { gap: 3px; flex: 1; min-width: 0; }
  .head { gap: 8px; align-items: center; flex-wrap: wrap; }
  .kind { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-3); }
  .txt { font-size: 12.5px; word-break: break-word; }
  .sugg { color: var(--accent); display: flex; align-items: center; gap: 5px; }
  .small { font-size: 12px; }
  .acts { gap: 6px; align-items: center; flex-shrink: 0; }
  .loc { border: 0; background: transparent; cursor: pointer; color: var(--text-3); font-size: 11.5px; padding: 2px 4px; }
  .loc:hover { color: var(--accent); }
  @media (max-width: 700px) {
    .claim { flex-wrap: wrap; }
    .acts { padding-left: 36px; }
  }
</style>
