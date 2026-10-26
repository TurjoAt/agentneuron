<script>
  // Prompt library: searchable prompts with outcome chips; repeated prompts with a
  // "save as command/skill" suggestion (copyable snippet only, nothing is written).
  import { untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { app, navigate, toast } from '../../lib/store.svelte.js';
  import { fmtNum, timeAgo } from '../../lib/format.js';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';
  import ToolBadge from '../../lib/ToolBadge.svelte';
  import Skeleton from '../../lib/viz/Skeleton.svelte';
  import { usageQuery, money, fmtMs, pct, copyText, shortId } from './shared.js';

  let { params = {}, range = '30d', agent = 'all' } = $props();
  const initialQ = untrack(() => params.q || '');
  let q = $state(initialQ);
  let qd = $state(initialQ);
  let timer;
  $effect(() => {
    const v = q;
    clearTimeout(timer);
    timer = setTimeout(() => (qd = v.trim()), 250);
    return () => clearTimeout(timer);
  });
  const res = resource(() => api('/api/usage/prompts', usageQuery(range, agent, { q: qd || undefined, limit: 200 })), { key: () => [range, agent, qd] });
  const d = $derived(res.data);

  let outcome = $state('all');
  const FILTERS = [['all', 'All'], ['errors', 'With errors'], ['interrupted', 'Interrupted'], ['rework', 'Rework']];
  const prompts = $derived((d?.prompts || []).filter((p) => outcome === 'all' || (outcome === 'errors' ? p.outcome?.errors > 0 : p.outcome?.[outcome])));
  let shown = $state(40);
  const blank = (s) => !s || !String(s).trim();
  const redacted = $derived((d?.prompts || []).length > 0 && (d.prompts || []).every((p) => blank(p.prompt)));

  let open = $state(null);
  function snippet(r) {
    const name = r.suggestion?.name || 'my-prompt';
    if (blank(r.prompt)) return null;
    if (r.suggestion?.kind === 'skill') return `---\nname: ${name}\ndescription: ${r.prompt.slice(0, 80)}\n---\n\n${r.prompt}\n`;
    return `---\ndescription: ${r.prompt.slice(0, 80)}\n---\n\n${r.prompt}\n`;
  }
  const pathFor = (r) => (r.suggestion?.kind === 'skill' ? `.claude/skills/${r.suggestion.name}/SKILL.md` : `.claude/commands/${r.suggestion?.name || 'my-prompt'}.md`);
  async function copy(text, what) {
    const ok = await copyText(text);
    toast(ok ? `${what} copied` : 'Clipboard unavailable', ok ? 'ok' : 'error');
  }
</script>

{#if res.error && !d}
  <div class="card"><Empty icon="alert" title="Prompt data unavailable">{res.error.message}<div class="mt"><button class="btn sm" onclick={() => res.reload()}><Icon name="refresh" size={13} /> Retry</button></div></Empty></div>
{:else}
  <div class="strip">
    {#if d}
      <div class="card stat"><div class="eyebrow">Prompts</div><div class="big tnum">{fmtNum(d.stats?.total)}</div></div>
      <div class="card stat"><div class="eyebrow">Avg length</div><div class="big tnum">{d.stats?.avgLength != null ? fmtNum(d.stats.avgLength) : '—'}<span class="faint unit">&nbsp;chars</span></div></div>
      <div class="card stat"><div class="eyebrow">Interrupted</div><div class="big tnum">{pct(d.stats?.interruptedRate)}</div></div>
      <div class="card stat"><div class="eyebrow">Rework</div><div class="big tnum">{pct(d.stats?.reworkRate)}</div><div class="faint tiny">prompts that undo or redo work</div></div>
    {:else}<div class="full"><Skeleton kind="kpis" count={4} /></div>{/if}
  </div>

  {#if redacted}
    <div class="note"><Icon name="lock" size={13} /> Prompt text is hidden for your role. Outcomes and costs are still shown.</div>
  {/if}

  <div class="cols">
    <section class="card lib">
      <div class="card-h">
        Prompt library
        <span class="spacer"></span>
        <div class="search"><Icon name="search" size={13} /><input class="input sm" type="search" placeholder="Search prompts" aria-label="Search prompts" bind:value={q} /></div>
      </div>
      <div class="filters" role="group" aria-label="Outcome filter">
        {#each FILTERS as [k, l] (k)}<button class="chip" class:on={outcome === k} aria-pressed={outcome === k} onclick={() => (outcome = k)}>{l}</button>{/each}
      </div>
      {#if !d}
        <div class="card-b"><Skeleton kind="timeline" count={7} /></div>
      {:else if !prompts.length}
        <Empty icon="message" title={qd ? 'No prompts match' : 'No prompts in this range'} compact>{qd ? `Nothing contains “${qd}”.` : 'Typed prompts from Claude Code and Codex show up here.'}</Empty>
      {:else}
        <ul class="plist">
          {#each prompts.slice(0, shown) as p, i (`${p.session}:${p.id ?? i}`)}
            {@const o = p.outcome || {}}
            <li class="pr">
              <div class="ph">
                <ToolBadge tool={p.tool} compact />
                <span class="faint tiny">{timeAgo(p.ts, app.now)}</span>
                <span class="faint tiny">·</span>
                <EntityLink kind="session" id={p.session} label={shortId(p.session)} class="tiny mono" />
                <span class="spacer"></span>
                <button class="btn ghost sm" onclick={() => navigate('sessions', { id: p.session, at: p.id })} aria-label="Open this prompt in the session replay"><Icon name="play" size={11} /> Replay</button>
              </div>
              {#if blank(p.prompt)}<div class="pt hidden"><Icon name="lock" size={11} /> hidden ({fmtNum(p.length)} chars)</div>
              {:else}<div class="pt">{p.prompt}</div>{/if}
              <div class="oc">
                <span class="oc-c" title="Tool calls"><Icon name="terminal" size={11} /> {fmtNum(o.toolCalls)}</span>
                {#if o.errors}<span class="oc-c err" title="Tool errors"><Icon name="alert" size={11} /> {o.errors} error{o.errors === 1 ? '' : 's'}</span>{/if}
                {#if o.interrupted}<span class="oc-c warn"><Icon name="stop" size={11} /> interrupted</span>{/if}
                {#if o.rework}<span class="oc-c warn"><Icon name="restore" size={11} /> rework</span>{/if}
                {#if o.usd != null}<span class="oc-c" title="Cost of this turn">{money(o.usd)}</span>{/if}
                {#if o.durationMs != null}<span class="oc-c" title="Turn duration"><Icon name="clock" size={11} /> {fmtMs(o.durationMs)}</span>{/if}
              </div>
            </li>
          {/each}
        </ul>
        {#if prompts.length > shown}<div class="more"><button class="btn sm" onclick={() => (shown += 60)}>Show more ({prompts.length - shown})</button></div>{/if}
      {/if}
    </section>

    <section class="card rep">
      <div class="card-h">Repeated prompts <span class="sub">save them once</span></div>
      {#if !d}
        <div class="card-b"><Skeleton kind="bars" count={5} /></div>
      {:else if !d.repeated?.length}
        <Empty icon="copy" title="No repeats yet" compact>Prompts you type 3+ times show up here with a command or skill suggestion.</Empty>
      {:else}
        <ul class="rlist">
          {#each d.repeated as r (r.id)}
            {@const snip = snippet(r)}
            <li class="rr">
              <div class="rh">
                <span class="cnt tnum">{r.count}×</span>
                <div class="grow">
                  {#if blank(r.prompt)}<div class="pt hidden"><Icon name="lock" size={11} /> hidden</div>{:else}<div class="pt">{r.prompt}</div>{/if}
                  <div class="faint tiny">{r.sessions} sessions · last {timeAgo(r.lastAt, app.now)}</div>
                </div>
              </div>
              {#if r.suggestion}
                <div class="sug">
                  <span class="badge accent">{r.suggestion.kind === 'skill' ? 'skill' : 'command'}</span>
                  <code class="mono">{r.suggestion.kind === 'skill' ? r.suggestion.name : `/${r.suggestion.name}`}</code>
                  <span class="spacer"></span>
                  {#if snip}<button class="btn ghost sm" aria-expanded={open === r.id} onclick={() => (open = open === r.id ? null : r.id)}><Icon name="code" size={12} /> {open === r.id ? 'Hide' : 'Snippet'}</button>{/if}
                </div>
                {#if open === r.id && snip}
                  <div class="snip">
                    <div class="sp-h"><span class="mono tiny faint">{pathFor(r)}</span><span class="spacer"></span><button class="btn sm" onclick={() => copy(snip, 'Snippet')}><Icon name="copy" size={12} /> Copy</button></div>
                    <pre>{snip}</pre>
                    <div class="faint tiny">Save this file yourself; AgentNeuron does not write it.</div>
                  </div>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
{/if}

<style>
  .mt { margin-top: 10px; }
  .strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
  .full { grid-column: 1 / -1; }
  .stat { padding: 13px 15px; display: flex; flex-direction: column; gap: 3px; }
  .big { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
  .unit { font-size: 12px; font-weight: 500; }
  .tiny, :global(.tiny) { font-size: 11px; }
  .note { margin-top: 12px; display: flex; gap: 8px; align-items: center; font-size: 12.5px; color: var(--text-2); padding: 8px 12px; border-radius: 9px; background: var(--info-soft); }
  .cols { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 14px; margin-top: 14px; align-items: start; }
  .card-h { flex-wrap: wrap; row-gap: 8px; }
  .search { display: flex; align-items: center; gap: 6px; color: var(--text-3); }
  .input.sm { height: 28px; font-size: 12px; width: 220px; }
  .filters { display: flex; gap: 6px; padding: 0 16px 10px; flex-wrap: wrap; }
  .plist, .rlist { list-style: none; margin: 0; padding: 0 10px 10px; display: flex; flex-direction: column; gap: 4px; }
  .pr { padding: 10px; border-radius: 10px; border: 1px solid transparent; transition: background 0.15s; }
  .pr:hover { background: var(--panel-hover); border-color: var(--border); }
  .ph { display: flex; align-items: center; gap: 6px; min-height: 26px; }
  .pt { font-size: 13.5px; color: var(--text); margin: 3px 0 6px; overflow-wrap: anywhere; white-space: pre-wrap; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .pt.hidden { color: var(--text-3); font-style: italic; display: flex; gap: 5px; align-items: center; }
  .oc { display: flex; gap: 6px; flex-wrap: wrap; }
  .oc-c { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; height: 20px; padding: 0 7px; border-radius: 99px; background: var(--inset); border: 1px solid var(--border); color: var(--text-2); font-variant-numeric: tabular-nums; }
  .oc-c.err { color: var(--err); background: var(--err-soft); border-color: transparent; }
  .oc-c.warn { color: var(--warn); background: var(--warn-soft); border-color: transparent; }
  .more { padding: 0 16px 14px; }
  .rr { padding: 10px; border-radius: 10px; background: var(--inset); display: flex; flex-direction: column; gap: 8px; }
  .rh { display: flex; gap: 10px; align-items: flex-start; }
  .cnt { font-weight: 700; font-size: 15px; color: var(--accent); min-width: 34px; }
  .sug { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .sug code { font-size: 12px; }
  .snip { border: 1px solid var(--border); border-radius: 9px; padding: 8px 10px; background: var(--panel-solid); display: flex; flex-direction: column; gap: 6px; }
  .sp-h { display: flex; align-items: center; gap: 6px; }
  pre { margin: 0; font-family: var(--mono); font-size: 11.5px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-2); max-height: 220px; overflow: auto; }
  @media (max-width: 1000px) { .cols { grid-template-columns: minmax(0, 1fr); } }
  @media (max-width: 640px) { .strip { grid-template-columns: repeat(2, minmax(0, 1fr)); } .input.sm { width: 100%; } .search { width: 100%; } }
</style>
