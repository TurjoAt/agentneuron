<script>
  // Bug detective: paste an error / stack trace (admins) or use the last failing run; frames mapped to files,
  // ranked hypotheses with evidence and how to confirm each. The pasted text is not stored unless saved.
  import { post } from '../../lib/api.js';
  import { app, toast } from '../../lib/store.svelte.js';
  import { runAction, actionEnabled } from '../../lib/actions.js';
  import { timeAgo } from '../../lib/format.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';
  import { copyText } from '../usage/shared.js';

  let text = $state('');
  let report = $state(null);
  let busy = $state(false);
  let error = $state(null);
  let lastInput = $state(null);
  const isAdmin = $derived(app.me ? app.me.role === 'admin' : true);
  const saveState = $derived(actionEnabled('brief.save'));

  async function analyze(body) {
    busy = true; error = null;
    try { report = await post('/api/brief/debug', body); lastInput = body; } catch (e) { error = e; report = null; } finally { busy = false; }
  }
  const fromText = (e) => { e?.preventDefault(); if (text.trim()) analyze({ error: text }); };
  const fromRun = () => analyze({ run: 'last' });
  async function copyMd() {
    if (!report?.markdown) return;
    toast((await copyText(report.markdown)) ? 'Bug report copied as Markdown' : 'Could not copy to the clipboard', 'info', 2600);
  }
  async function save() {
    if (lastInput?.error) {
      // pasted text is saved by the debug route itself (never as an action param, which every role can list)
      try { const r = await post('/api/brief/debug', { ...lastInput, save: true }); toast(`Debug report saved to ${r.saved?.path || '.agentneuron/briefs/'}`, 'ok', 3000); }
      catch (e) { toast(`Could not save: ${e.message}`, 'err', 4000); }
      return;
    }
    const job = await runAction('brief.save', { kind: 'debug', run: report?.run?.id || undefined }, { title: 'Save debug report' });
    if (job?.status === 'ok') toast('Debug report saved to .agentneuron/briefs/', 'ok', 3000);
  }
  const conf = (c) => (c >= 0.65 ? 'high' : c >= 0.4 ? 'medium' : 'low');
  const fileOf = (r) => String(r || '').replace(/:\d+$/, '');
  const isRel = (p) => p && !/^([/\\~]|[A-Za-z]:)/.test(p) && !String(p).startsWith('node_modules/');
</script>

<section class="card" aria-label="Error input">
  <form class="card-b form" onsubmit={fromText}>
    {#if isAdmin}
      <label class="fl"><span>Error or stack trace</span>
        <textarea class="input mono ta" rows="7" placeholder={"TypeError: Cannot read properties of undefined (reading 'id')\n    at handler (src/routes/user.ts:42:17)"} bind:value={text} spellcheck="false"></textarea></label>
      <p class="muted small">Analysed locally and not stored unless you save the report. Secrets are masked.</p>
    {:else}
      <p class="muted small">Pasting error text is admin-only. You can analyse the last failing verification run.</p>
    {/if}
    <div class="acts">
      {#if isAdmin}<button class="btn primary" type="submit" disabled={busy || !text.trim()}><Icon name="search" size={13} />Analyse</button>{/if}
      <button class="btn" type="button" onclick={fromRun} disabled={busy}><Icon name="play" size={13} />Use last failing run</button>
    </div>
  </form>
</section>

{#if busy && !report}
  <div class="card card-b sk" aria-busy="true"><div class="skel-rows"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div></div>
{:else if error}
  <div class="card"><Empty icon="alert" title={error.status === 400 ? 'Nothing to analyse' : 'Analysis failed'}>{error.status === 400 ? 'No failing run is recorded yet. Run the checks from Ship check, or paste an error.' : error.message}</Empty></div>
{:else if !report}
  <div class="card"><Empty icon="search" title="Paste an error to start">You get the stack frames mapped to project files, what changed there recently, related env keys and dependencies, similar past failures, and ranked hypotheses with how to confirm each.</Empty></div>
{:else}
  <section class="card head" aria-busy={busy}>
    <div class="hh">
      <div class="ht">
        <div class="kicker">{report.source === 'run' ? `Failing ${report.run?.kind || ''} run ${report.run?.id || ''}` : 'Pasted error'}{#if report.run?.endedAt} · {timeAgo(report.run.endedAt)}{/if}</div>
        <h2><span class="etype">{report.error?.type}</span>{#if report.error?.quote}<span class="emsg">: {report.error.quote}</span>{/if}</h2>
      </div>
      <div class="acts">
        <button class="btn sm" onclick={copyMd} disabled={!report.markdown}><Icon name="copy" size={13} />Copy Markdown</button>
        <button class="btn sm" onclick={save} disabled={!saveState.enabled} title={saveState.enabled ? 'Save to .agentneuron/briefs/' : saveState.reason}><Icon name="save" size={13} />Save</button>
      </div>
    </div>
    {#if report.frames?.length}
      <ol class="frames" aria-label="Stack frames">
        {#each report.frames.slice(0, 12) as f, i (i)}
          <li class:own={f.inProject}>
            {#if f.inProject}<EntityLink kind="file" id={f.path} label={`${f.path}:${f.line}`} mono />{:else}<span class="mono muted">{f.dep ? `${f.dep} › ` : ''}{f.path}:{f.line}</span>{/if}
            {#if f.fn}<span class="fn mono">{f.fn}</span>{/if}
            {#if f.recent}<span class="badge warn">changed recently</span>{/if}
          </li>
        {/each}
      </ol>
    {/if}
  </section>

  <div class="hyps">
    {#if !report.hypotheses?.length}
      <div class="card"><Empty compact icon="info" title="No hypothesis has supporting evidence">Re-run with more output (full stack trace, verbose test output).</Empty></div>
    {/if}
    {#each report.hypotheses || [] as h, i (h.id)}
      <article class="card hyp {conf(h.confidence)}">
        <div class="hy-h">
          <span class="rank">{i + 1}</span>
          <h3>{h.title}</h3>
          <span class="conf" title="Confidence from the evidence found, not a probability">
            <span class="meter"><span style="width:{Math.round(h.confidence * 100)}%"></span></span>{Math.round(h.confidence * 100)}%
          </span>
        </div>
        <ul class="evs">
          {#each h.evidence as e, j (j)}
            <li><span class="ek">{e.kind}</span><span>{e.label}</span>
              {#if e.kind === 'file' && isRel(e.ref)}<EntityLink kind="file" id={fileOf(e.ref)} label={e.ref} mono />
              {:else if e.kind === 'commit'}<EntityLink kind="commit" id={e.ref} label={e.ref} mono />
              {:else if e.kind === 'session'}<EntityLink kind="session" id={e.ref} label={String(e.ref).slice(0, 8)} mono />
              {:else if e.ref}<code>{e.ref}</code>{/if}
              {#if e.quote}<q>{e.quote}</q>{/if}
            </li>
          {/each}
        </ul>
        <div class="check"><Icon name="check" size={13} /><div><strong>How to confirm:</strong> {h.check}</div></div>
      </article>
    {/each}
  </div>

  {#if report.related}
    <section class="card rel" aria-label="Related">
      <div class="card-h">Related</div>
      <div class="card-b rgrid">
        {#if report.related.commits?.length}<div><h4>Recent commits</h4><ul>{#each report.related.commits as c (c.hash)}<li><EntityLink kind="commit" id={c.hash} label={c.short} mono /> {c.subject} <span class="muted">{timeAgo(c.ts)}</span></li>{/each}</ul></div>{/if}
        {#if report.related.config?.length}<div><h4>Config and env</h4><ul>{#each report.related.config as c, i (i)}<li>{c.label}</li>{/each}</ul></div>{/if}
        {#if report.related.deps?.length}<div><h4>Dependencies</h4><ul>{#each report.related.deps as d (d.name)}<li><span class="mono">{d.name}</span> <span class="muted">declared {d.declared || '—'}, installed {d.installed || '—'}</span></li>{/each}</ul></div>{/if}
        {#if report.related.tests?.length}<div><h4>Failing tests</h4><ul>{#each report.related.tests as t, i (i)}<li>{t.name}{#if t.file} · <EntityLink kind="file" id={t.file} label={t.file} mono />{/if}</li>{/each}</ul></div>{/if}
        {#if report.related.sessions?.length}<div><h4>Similar past failures</h4><ul>{#each report.related.sessions as s, i (i)}<li><EntityLink kind="session" id={s.session} label={String(s.session).slice(0, 8)} mono />{#if s.command} <code>{s.command}</code>{/if}{#if s.fix} → fixed by <code>{s.fix}</code>{/if}</li>{/each}</ul></div>{/if}
        {#if !report.related.commits?.length && !report.related.config?.length && !report.related.deps?.length && !report.related.tests?.length && !report.related.sessions?.length}<p class="muted small">No related commits, config, dependencies or tests found.</p>{/if}
      </div>
    </section>
  {/if}
{/if}

<style>
  .form { display: flex; flex-direction: column; gap: 8px; padding-top: 14px; }
  .fl { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 550; color: var(--text-2); }
  .ta { width: 100%; height: auto; min-height: 120px; padding: 8px 10px; resize: vertical; font-size: 12px; line-height: 1.45; }
  .acts { display: flex; gap: 6px; flex-wrap: wrap; }
  .small { font-size: 12px; margin: 0; }
  .card { margin-bottom: 14px; }
  .sk { padding-top: 16px; }
  .head { padding: 14px 16px; }
  .hh { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .ht { min-width: 0; flex: 1 1 260px; }
  .kicker { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); }
  h2 { margin: 2px 0 0; font-size: 16px; overflow-wrap: anywhere; }
  .etype { color: var(--err); }
  .emsg { font-weight: 500; }
  .frames { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
  .frames li { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 3px 8px; border-radius: 6px; min-width: 0; overflow-wrap: anywhere; }
  .frames li.own { background: var(--inset); }
  .fn { color: var(--text-2); }
  .hyps { display: flex; flex-direction: column; }
  .hyp { padding: 12px 16px; border-left: 3px solid var(--border-strong); }
  .hyp.high { border-left-color: var(--err); }
  .hyp.medium { border-left-color: var(--warn); }
  .hyp.low { border-left-color: var(--info); }
  .hy-h { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .rank { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--panel-active); font-size: 12px; font-weight: 700; }
  h3 { margin: 0; font-size: 14px; flex: 1 1 200px; min-width: 0; overflow-wrap: anywhere; }
  .conf { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--text-2); }
  .meter { width: 64px; height: 6px; border-radius: 99px; background: var(--panel-active); overflow: hidden; display: inline-block; }
  .meter span { display: block; height: 100%; background: var(--accent); border-radius: inherit; }
  .evs { list-style: none; margin: 8px 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; }
  .evs li { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; overflow-wrap: anywhere; }
  .ek { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-3); min-width: 54px; }
  .evs code, .rel code { font-family: var(--mono); font-size: 11.5px; padding: 0 5px; border-radius: 4px; background: var(--panel-active); overflow-wrap: anywhere; }
  .evs q { color: var(--text-2); flex-basis: 100%; padding-left: 60px; }
  @media (max-width: 480px) { .evs q { padding-left: 0; } }
  .check { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border-radius: var(--radius-xs); background: var(--ok-soft); font-size: 12.5px; overflow-wrap: anywhere; }
  .check :global(svg) { color: var(--ok); margin-top: 2px; flex: none; }
  .rgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
  .rgrid h4 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-3); }
  .rgrid ul { margin: 0; padding-left: 16px; font-size: 12.5px; display: flex; flex-direction: column; gap: 4px; }
  .rgrid li { overflow-wrap: anywhere; }
</style>
