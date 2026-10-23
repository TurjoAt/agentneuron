<script>
  import { api } from '../api.js';
  import { app, openFile, navigate } from '../store.svelte.js';
  import { resource } from '../resource.svelte.js';
  import { timeAgo, toMs, fmtDate } from '../format.js';
  import { canRun } from '../actions.js';
  import Icon from '../Icon.svelte';
  import { act, gx, hue, initials, why } from './gx.svelte.js';

  let { branches, changes } = $props();
  const info = resource(() => api('/api/git'), { key: () => gx.tick });
  const log = resource(() => api('/api/git/log', { limit: 8 }), { key: () => gx.tick });
  const stats = resource(() => api('/api/git/stats'), { key: () => gx.tick });
  const cur = $derived(branches?.local?.find((b) => b.current));
  const ch = $derived(changes || {});
  const counts = $derived({ staged: ch.staged?.length || 0, unstaged: ch.unstaged?.length || 0, untracked: ch.untracked?.length || 0, conflicted: ch.conflicted?.length || 0 });
  const rec = $derived(Array.isArray(log.data) ? log.data : []);
  const authors = $derived((stats.data?.byAuthor || []).slice(0, 6));
  const go = (tab) => navigate('git', { tab });
</script>

<div class="g-grid">
  <section class="card" style="padding:18px 20px">
    <div class="row" style="gap:14px;margin-bottom:14px">
      <span class="bi"><Icon name="branch" size={20} /></span>
      <div class="col" style="gap:2px;min-width:0">
        <span class="eyebrow">Current branch</span>
        <span class="bn mono ellipsis">{branches?.current || info.data?.branch || '(detached)'}</span>
      </div>
    </div>
    <div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:12px">
      {#if cur?.upstream}
        <span class="pill mono">{cur.upstream}</span>
        <span class="pill" class:hot={cur.ahead}>↑ {cur.ahead} ahead</span>
        <span class="pill" class:warn={cur.behind}>↓ {cur.behind} behind</span>
      {:else}<span class="pill">no upstream</span>{/if}
      {#if info.data?.head}<span class="pill mono">{info.data.head}</span>{/if}
    </div>
    <div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:14px">
      {#each [['staged', 'ok'], ['unstaged', 'warn'], ['untracked', ''], ['conflicted', 'warn']] as [k, c]}
        <button class="pill {counts[k] ? c : ''}" style="border:0;cursor:pointer" onclick={() => go('changes')}>{counts[k]} {k}</button>
      {/each}
      {#if !counts.staged && !counts.unstaged && !counts.untracked && !counts.conflicted}<span class="pill ok">clean</span>{/if}
    </div>
    <div class="row" style="flex-wrap:wrap">
      <button class="btn sm" disabled={!canRun('exec')} title={why('exec')} onclick={() => act('git.fetch', {})}><Icon name="refresh" size={13} /> Fetch</button>
      <button class="btn sm" disabled={!canRun('exec')} title={why('exec')} onclick={() => act('git.pull', {})}><Icon name="download" size={13} /> Pull</button>
      <button class="btn sm" disabled={!canRun('exec')} title={why('exec')} onclick={() => act('git.push', {})}><Icon name="upload" size={13} /> Push</button>
      <button class="btn sm ghost" onclick={() => go('changes')}><Icon name="commit" size={13} /> Commit…</button>
    </div>
  </section>

  <section class="card">
    <div class="card-h">Contributors <span class="sub">{stats.data?.byAuthor?.length || 0}</span></div>
    <div class="card-b col" style="gap:8px">
      {#each authors as a (a.author)}
        <div class="row">
          <span class="av" style="--h:{hue(a.author)}">{initials(a.author)}</span>
          <span class="grow ellipsis small">{a.author}</span>
          <span class="faint small tnum">{a.commits} commits</span>
        </div>
      {:else}<div class="faint small">No contributor data.</div>{/each}
    </div>
  </section>
</div>

<section class="card" style="margin-top:16px">
  <div class="card-h">Recent commits <span class="sub">{rec.length}</span>
    <button class="btn sm ghost" style="margin-left:auto" onclick={() => go('history')}>All history</button></div>
  <div class="card-b col" style="gap:2px">
    {#each rec as c (c.hash)}
      <button class="g-row" style="border:0;background:none;text-align:left;color:inherit" onclick={() => navigate('git', { tab: 'history', hash: c.hash })}>
        <span class="av" style="--h:{hue(c.author)}" title={c.author}>{initials(c.author)}</span>
        <span class="grow ellipsis">{c.subject}</span>
        <span class="hash">{c.short}</span>
        <span class="faint tiny" title={fmtDate(toMs(c.date))}>{timeAgo(toMs(c.date), app.now)}</span>
      </button>
    {:else}<div class="faint small" style="padding:8px">No commits.</div>{/each}
  </div>
</section>

<style>
  .bi { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; background: linear-gradient(135deg, var(--accent-soft), transparent); border: 1px solid var(--border); color: var(--accent); flex-shrink: 0; }
  .bn { font-size: 18px; font-weight: 650; }
</style>
