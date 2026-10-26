<script>
  import { api, post } from '../../lib/api.js';
  import { app, toast, openFile } from '../../lib/store.svelte.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { timeAgo } from '../../lib/format.js';
  import { HOW_TO_ENABLE } from '../../lib/levels.js';
  import ToolBadge from '../../lib/ToolBadge.svelte';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';

  const KIND = { correction: 'User correction', fix: 'Failing command, fixed', failure: 'Failing command', revert: 'Reverted edit', repeated: 'Repeated instruction' };
  const lessons = resource(() => api('/api/insights/lessons'), { live: false });
  let showCovered = $state(false);
  let busy = $state(null);
  let targets = $state({});
  let open = $state({});

  const canEdit = $derived(!!(lessons.data?.canAccept ?? app.me?.levels?.edit));
  const canState = $derived(!!app.me?.levels?.state);
  const all = $derived(lessons.data?.lessons || []);
  const covered = $derived(all.filter((l) => l.alreadyCovered).length);
  const list = $derived(showCovered ? all : all.filter((l) => !l.alreadyCovered));
  const tone = (c) => (c >= 0.75 ? 'ok' : c >= 0.5 ? 'warn' : 'info');

  async function act(l, what) {
    busy = l.id;
    try {
      const r = await post(`/api/insights/lessons/${what}`, what === 'accept' ? { id: l.id, target: targets[l.id] || l.target } : { id: l.id });
      toast(what === 'accept' ? (r.unchanged ? `Already in ${r.path}` : `Added to ${r.path}`) : 'Dismissed — it will not come back', 'ok');
      lessons.reload();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      busy = null;
    }
  }
</script>

<div class="stack">
  <div class="bar">
    <span class="muted small">{lessons.data ? `${list.length} lesson${list.length === 1 ? '' : 's'} from ${lessons.data.sessions} agent session${lessons.data.sessions === 1 ? '' : 's'}` : 'Mining sessions…'}</span>
    <span class="spacer"></span>
    {#if covered}<label class="small muted chk"><input type="checkbox" bind:checked={showCovered} /> show {covered} already covered</label>{/if}
    <button class="btn sm" onclick={() => lessons.reload()} disabled={lessons.loading}><Icon name="refresh" size={13} /> Refresh</button>
  </div>
  {#if !canEdit}
    <div class="note small"><Icon name="lock" size={13} /> Accepting writes a context file, which needs the <b>edit</b> level. {HOW_TO_ENABLE.edit}</div>
  {/if}

  {#if lessons.error}
    <Empty icon="alert" title="Could not mine sessions">{lessons.error.message}</Empty>
  {:else if !lessons.data}
    <div class="skel" style="height:220px"></div>
  {:else if !list.length}
    <Empty icon="sparkles" title="Nothing new to learn">No corrections, reverts or repeatedly failing commands found in this project's Claude Code / Codex sessions{covered ? ' that your rules do not already cover' : ''}.</Empty>
  {:else}
    <div class="grid">
      {#each list as l (l.id)}
        <article class="card lesson">
          <div class="lh">
            <span class="badge {tone(l.confidence)}" title="confidence">{Math.round(l.confidence * 100)}%</span>
            {#each l.kinds as k (k)}<span class="badge">{KIND[k] || k}</span>{/each}
            <span class="spacer"></span>
            <span class="faint tiny">{l.count}× · {l.sessions} session{l.sessions === 1 ? '' : 's'}</span>
          </div>
          <div class="rule">{l.rule}</div>
          {#if l.alreadyCovered}
            <button class="cov small" onclick={() => openFile(l.alreadyCovered.file, { drawer: true })}>
              <Icon name="check" size={12} /> Covered by <span class="mono">{l.alreadyCovered.file}:{l.alreadyCovered.line}</span> — “{l.alreadyCovered.rule}”
            </button>
          {/if}
          <ul class="ev">
            {#each (open[l.id] ? l.evidence : l.evidence.slice(0, 2)) as e, i (i)}
              <li><ToolBadge tool={e.tool} /><q>{e.quote}</q><span class="faint tiny">{#if e.session}<EntityLink kind="session" id={e.session} label={e.ts ? timeAgo(e.ts, app.now) : 'session'} title="Open the session this quote came from" />{:else}{e.ts ? timeAgo(e.ts, app.now) : ''}{/if}</span></li>
            {/each}
          </ul>
          {#if l.evidence.length > 2}<button class="btn ghost sm more" onclick={() => (open[l.id] = !open[l.id])}>{open[l.id] ? 'Less evidence' : `All ${l.evidence.length} quotes`}</button>{/if}
          <div class="acts">
            <select class="input sm mono" aria-label="Target file" value={targets[l.id] || l.target} onchange={(e) => (targets[l.id] = e.currentTarget.value)}>
              {#each l.targets as t (t)}<option value={t}>{t}</option>{/each}
            </select>
            <button class="btn sm primary" disabled={!canEdit || busy === l.id} title={canEdit ? 'Append this rule to the file' : `Needs the edit level. ${HOW_TO_ENABLE.edit}`} onclick={() => act(l, 'accept')}><Icon name="plus" size={13} /> Accept</button>
            <button class="btn sm" disabled={!canState || busy === l.id} title={canState ? 'Hide this lesson for good' : 'Needs the admin role'} onclick={() => act(l, 'dismiss')}><Icon name="x" size={13} /> Dismiss</button>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</div>

<style>
  .stack { display: flex; flex-direction: column; gap: 12px; }
  .bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .chk { display: inline-flex; align-items: center; gap: 6px; }
  .note { padding: 8px 12px; border: 1px dashed var(--border-strong); border-radius: 10px; color: var(--text-2); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 12px; align-items: start; }
  .lesson { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .lh { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .rule { font-weight: 600; font-size: 14.5px; line-height: 1.4; overflow-wrap: anywhere; }
  .cov { all: unset; cursor: pointer; color: var(--ok); overflow-wrap: anywhere; }
  .cov:hover { text-decoration: underline; }
  .ev { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .ev li { display: flex; gap: 8px; align-items: baseline; min-width: 0; }
  .ev q { flex: 1; min-width: 0; color: var(--text-2); font-size: 12.5px; overflow-wrap: anywhere; }
  .more { align-self: flex-start; }
  .acts { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .acts select { max-width: 220px; height: 26px; font-size: 12px; }
  .small { font-size: 12.5px; }
  .tiny { font-size: 11px; }
</style>
