<script>
  import { api } from '../api.js';
  import { app, navigate } from '../store.svelte.js';
  import { timeAgo, toMs, fmtDate } from '../format.js';
  import Icon from '../Icon.svelte';
  import Empty from '../Empty.svelte';
  import CommitGraph from './CommitGraph.svelte';
  import PatchView from './PatchView.svelte';
  import { layoutGraph } from './graph.js';
  import { gx, hue, initials, STATUS } from './gx.svelte.js';
  import EntityLink from '../EntityLink.svelte';

  let { params = {} } = $props();
  const PAGE = 60;
  let list = $state([]);
  let more = $state(true);
  let loading = $state(false);
  let error = $state(null);
  let path = $state('');
  let author = $state('');
  let since = $state('');
  let seq = 0;

  async function load(reset) {
    const my = ++seq;
    loading = true;
    try {
      const r = await api('/api/git/log', { limit: PAGE, skip: reset ? 0 : list.length, path: path || undefined, author: author || undefined, since: since || undefined });
      if (my !== seq) return;
      if (r && r.available === false) { error = new Error(r.reason || 'unavailable'); return; }
      error = null;
      const arr = Array.isArray(r) ? r : [];
      list = reset ? arr : [...list, ...arr];
      more = arr.length >= PAGE;
    } catch (e) { if (my === seq) error = e; }
    finally { if (my === seq) loading = false; }
  }
  let t;
  $effect(() => { void [path, author, since, gx.tick]; clearTimeout(t); t = setTimeout(() => load(true), 200); return () => clearTimeout(t); });

  const g = $derived(layoutGraph(list));
  const hash = $derived(params?.hash || '');
  let detail = $state(null);
  let dErr = $state(null);
  $effect(() => {
    const h = hash; gx.tick; detail = null; dErr = null;
    if (!h) return;
    api('/api/git/commit', { hash: h }).then((d) => { if (h === hash) detail = d; }).catch((e) => { dErr = e; });
  });
  const open = (h) => navigate('git', { tab: 'history', hash: h });
  const refs = (c) => (c.refs || []).filter(Boolean);
</script>

<div class="g-bar">
  <input class="input" style="width:170px" placeholder="Path" bind:value={path} aria-label="Filter by path" />
  <input class="input" style="width:150px" placeholder="Author" bind:value={author} aria-label="Filter by author" />
  <input class="input" style="width:150px" placeholder="Since (2 weeks ago)" bind:value={since} aria-label="Since" />
  {#if path || author || since}<button class="btn sm ghost" onclick={() => { path = author = since = ''; }}>Clear</button>{/if}
</div>

<div class="g-split" style="grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)">
  <section class="card" style="padding:4px">
    {#if error}<Empty icon="alert" title="Could not load history">{error.message}</Empty>
    {:else if !list.length && !loading}<Empty icon="history" title="No commits">Nothing matches these filters.</Empty>
    {:else}
      <div class="scroll">
        {#each list as c, i (c.hash)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div class="crow" class:on={hash === c.hash} role="button" tabindex="0" onclick={() => open(c.hash)} onkeydown={(e) => e.key === 'Enter' && open(c.hash)}>
            <CommitGraph row={g.rows[i]} lanes={g.lanes} />
            <div class="grow col" style="gap:1px">
              <div class="row" style="gap:6px"><span class="ellipsis" style="font-weight:550">{c.subject}</span>
                {#each refs(c).slice(0, 3) as r}<span class="ref" class:head={r.startsWith('HEAD')} class:tag={r.startsWith('tag:')}>{r.replace('HEAD -> ', '')}</span>{/each}</div>
              <div class="faint tiny ellipsis"><span class="hash">{c.short}</span> · {c.author} · <span title={fmtDate(toMs(c.date))}>{timeAgo(toMs(c.date), app.now)}</span></div>
            </div>
          </div>
        {/each}
        {#if more}<div style="padding:8px;text-align:center"><button class="btn sm" disabled={loading} onclick={() => load(false)}>{loading ? 'Loading…' : 'Load more'}</button></div>{/if}
      </div>
    {/if}
  </section>

  <section class="scroll">
    {#if !hash}<div class="card"><Empty icon="commit" title="Select a commit">See its files and patch.</Empty></div>
    {:else if dErr}<div class="card"><Empty icon="alert" title="Could not load commit">{dErr.message}</Empty></div>
    {:else if !detail}<div class="skel" style="height:160px"></div>
    {:else}
      <div class="card" style="padding:14px 16px;margin-bottom:12px">
        <div class="row" style="gap:10px;margin-bottom:6px"><span class="av" style="--h:{hue(detail.author)}">{initials(detail.author)}</span>
          <div class="col" style="gap:0"><b>{detail.subject}</b><span class="faint tiny">{detail.author} · {fmtDate(toMs(detail.date))} · <EntityLink kind="commit" id={detail.hash} label={detail.short} class="hash" title="Sessions, files and tasks linked to this commit" /></span></div></div>
        {#if detail.body}<pre class="body">{detail.body}</pre>{/if}
        <div class="col" style="gap:0;margin-top:8px">
          {#each detail.files || [] as f}
            <div class="row small" style="padding:3px 0"><span class="st {f.status?.[0]}">{f.status?.[0]}</span><span class="mono grow ellipsis" title={STATUS[f.status?.[0]]}>{#if f.status?.[0] === 'D'}{f.path}{:else}<EntityLink kind="file" id={f.path} label={f.path} title="{f.path}: agent sessions, commits and tasks" />{/if}</span>
              <span class="tiny mono"><span class="add">+{f.added}</span> <span class="del">−{f.removed}</span></span></div>
          {/each}
        </div>
      </div>
      <PatchView patch={detail.patch} truncated={detail.truncated} />
    {/if}
  </section>
</div>

<style>
  .crow { display: flex; align-items: center; gap: 8px; padding: 0 10px 0 6px; min-height: 44px; cursor: pointer; border-radius: 8px; }
  .crow:hover { background: var(--panel-hover); }
  .crow.on { background: var(--panel-active); }
  .body { white-space: pre-wrap; font: inherit; font-size: 13px; color: var(--text-2); margin: 6px 0 0; }
</style>
