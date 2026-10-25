<script>
  // Live view side column: agent sessions, advisory file claims, handoff notes.
  import { app, toast } from '../../lib/store.svelte.js';
  import { timeAgo, fmtTime } from '../../lib/format.js';
  import { live, releaseClaim, claimPaths, colorTool, skey } from '../../lib/live.svelte.js';
  import { openTask } from '../../lib/fileActions.js';
  import ToolBadge from '../../lib/ToolBadge.svelte';
  import Icon from '../../lib/Icon.svelte';

  let { sessionFilter = '', onsession = null } = $props();
  const canState = $derived(!!app.me?.levels?.state);
  const sessions = $derived(live.sessions.filter((s) => s.state !== 'end').slice(0, 30));
  const ended = $derived(live.sessions.filter((s) => s.state === 'end').length);
  let claimText = $state('');

  async function release(c) {
    try { await releaseClaim(c); toast('Claim released', 'ok', 2000); } catch (e) { toast(e.message, 'error'); }
  }
  async function claim(e) {
    e.preventDefault();
    const paths = claimText.split(/[\s,]+/).filter(Boolean);
    if (!paths.length) return;
    try {
      const r = await claimPaths(paths);
      claimText = '';
      if (r.conflicts?.length) toast(`Held by ${r.conflicts[0].heldBy.agent}: ${r.conflicts.map((c) => c.path).join(', ')}`, 'warn', 6000);
      else toast(`Claimed ${r.granted.join(', ')}`, 'ok', 2500);
    } catch (err) { toast(err.message, 'error'); }
  }
</script>

<section class="card">
  <div class="card-h"><Icon name="users" size={14} /> Sessions <span class="sub">{sessions.length} live{ended ? ` · ${ended} ended` : ''}</span></div>
  <div class="card-b list">
    {#each sessions as s (skey(s))}
      <button class="sess" class:on={sessionFilter === skey(s)} onclick={() => onsession?.(sessionFilter === skey(s) ? '' : skey(s))} title="Filter the lanes to this session">
        <span class="sd {s.state}" style="--c:var(--tool-{colorTool(s.tool)})"></span>
        <div class="grow sb">
          <div class="r1"><b class="ellipsis">{s.title || s.sessionId.slice(0, 8)}</b></div>
          <div class="r2 faint">
            <span>{s.state}</span>·<span class="tnum">{s.edits || 0} edits</span>{#if s.model}·<span class="ellipsis">{s.model}</span>{/if}·<time title={fmtTime(s.lastAt)}>{timeAgo(s.lastAt, app.now)}</time>
          </div>
          {#if live.showPrompts && (s.lastThinking || s.lastPrompt)}
            <div class="pr ellipsis" title={s.lastThinking || s.lastPrompt}><span class="faint">{s.lastThinking ? 'intent' : 'prompt'}:</span> {s.lastThinking || s.lastPrompt}</div>
          {/if}
        </div>
      </button>
    {:else}
      <div class="faint small">No active Claude Code or Codex session in this project.</div>
    {/each}
  </div>
</section>

<section class="card">
  <div class="card-h"><Icon name="lock" size={14} /> Claims <span class="sub">advisory locks</span></div>
  <div class="card-b list">
    {#each live.claims as c (c.id)}
      <div class="claim">
        <Icon name="lock" size={11} />
        <code class="mono ellipsis grow" title={c.pattern}>{c.pattern}</code>
        <span class="faint small ellipsis" title="{c.agent} · {c.sessionId}{c.note ? ' — ' + c.note : ''}">{c.agent}</span>
        {#if c.taskId}<button class="lnk tiny" onclick={() => openTask(c.taskId)}>task</button>{/if}
        <span class="faint tiny tnum" title="Expires {fmtTime(c.expiresAt)}">{Math.max(0, Math.round((c.expiresAt - app.now) / 60000))}m</span>
        {#if canState}<button class="btn sm ghost icon" aria-label="Release claim {c.pattern}" title="Release" onclick={() => release(c)}><Icon name="unlock" size={12} /></button>{/if}
      </div>
    {:else}
      <div class="faint small">No claims. Agents call <code>claim_files</code> over MCP.</div>
    {/each}
    {#if canState}
      <form class="cf" onsubmit={claim}>
        <input class="input" placeholder="Claim paths or globs, e.g. src/api/**" bind:value={claimText} aria-label="Paths to claim" />
        <button class="btn sm" type="submit" disabled={!claimText.trim()}>Claim</button>
      </form>
    {/if}
  </div>
</section>

<section class="card">
  <div class="card-h"><Icon name="message" size={14} /> Handoffs <span class="sub">end-of-session notes</span></div>
  <div class="card-b list">
    {#each live.handoffs.slice(0, 6) as h (h.id)}
      <div class="ho">
        <div class="r1"><ToolBadge tool={/claude/i.test(h.agent) ? 'claude' : /codex/i.test(h.agent) ? 'codex' : /cursor/i.test(h.agent) ? 'cursor' : 'generic'} compact /><b class="ellipsis grow">{h.summary || h.agent}</b><time class="faint tiny" title={fmtTime(h.ts)}>{timeAgo(h.ts, app.now)}</time></div>
        {#if h.done.length}<div class="hl"><span class="k ok">done</span>{h.done.join(' · ')}</div>{/if}
        {#if h.next.length}<div class="hl"><span class="k">next</span>{h.next.join(' · ')}</div>{/if}
        {#if h.blockers.length}<div class="hl"><span class="k err">blocked</span>{h.blockers.join(' · ')}</div>{/if}
        {#if h.taskId}<button class="lnk tiny" onclick={() => openTask(h.taskId)}>open task</button>{/if}
      </div>
    {:else}
      <div class="faint small">No handoffs yet. Agents call <code>handoff_note</code> when they stop.</div>
    {/each}
  </div>
</section>

<style>
  .card + .card { margin-top: 12px; }
  .list { display: flex; flex-direction: column; gap: 6px; }
  .sess { display: flex; gap: 9px; align-items: flex-start; border: 1px solid transparent; background: none; border-radius: 8px; padding: 6px; text-align: left; cursor: pointer; color: inherit; font: inherit; }
  .sess:hover { background: var(--panel-hover); }
  .sess.on { border-color: var(--accent); background: var(--accent-soft); }
  .sb { min-width: 0; }
  .sd { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; background: var(--c); flex-shrink: 0; }
  .sd.idle { opacity: 0.45; }
  .sd.active, .sd.start { box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 25%, transparent); animation: breathe 2s ease-in-out infinite; }
  .r1 { display: flex; gap: 6px; align-items: center; min-width: 0; font-size: 12.5px; }
  .r2 { display: flex; gap: 4px; font-size: 11px; min-width: 0; white-space: nowrap; overflow: hidden; }
  .pr { font-size: 11.5px; color: var(--text-2); margin-top: 2px; }
  .claim { display: flex; align-items: center; gap: 6px; font-size: 12px; min-width: 0; }
  .claim code { font-size: 11.5px; }
  .cf { display: flex; gap: 6px; margin-top: 4px; }
  .cf .input { height: 28px; font-size: 12px; flex: 1; min-width: 0; }
  .ho { border-left: 2px solid var(--border-strong); padding: 2px 0 2px 8px; display: flex; flex-direction: column; gap: 2px; }
  .hl { font-size: 11.5px; color: var(--text-2); }
  .k { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; margin-right: 6px; color: var(--info); }
  .k.ok { color: var(--ok); }
  .k.err { color: var(--err); }
  .lnk { border: 0; background: none; padding: 0; color: var(--accent); cursor: pointer; font: inherit; align-self: flex-start; }
  @keyframes breathe { 50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--c) 8%, transparent); } }
  @media (prefers-reduced-motion: reduce) { .sd { animation: none !important; } }
</style>
