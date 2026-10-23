<script>
  import { api } from '../api.js';
  import { app, navigate } from '../store.svelte.js';
  import { timeAgo, toMs, fmtDate } from '../format.js';
  import Empty from '../Empty.svelte';
  import { hue } from './gx.svelte.js';
  let { params = {} } = $props();
  let path = $state(params?.path || '');
  const files = $derived([...app.files].map((f) => f.path).sort());
  $effect(() => { if (!path && files.length) path = files.find((p) => !app.files.find((f) => f.path === p)?.gitStatus) || files[0]; });
  let lines = $state([]), text = $state([]), err = $state(null), loading = $state(false);
  let seq = 0;
  $effect(() => {
    const p = path; void app.dataTick; if (!p) return;
    const my = ++seq; loading = true;
    Promise.all([api('/api/git/blame', { path: p }), api('/api/file', { path: p })]).then(([b, f]) => {
      if (my !== seq) return;
      if (b?.available === false) { err = new Error(b.reason); return; }
      err = null; lines = Array.isArray(b) ? b : []; text = (f?.content ?? '').split('\n');
    }).catch((e) => { if (my === seq) err = e; }).finally(() => { if (my === seq) loading = false; });
  });
  const groups = $derived.by(() => {
    const out = [];
    for (const l of lines) {
      const g = out[out.length - 1];
      if (g && g.hash === l.hash) g.rows.push(l); else out.push({ hash: l.hash, l, rows: [l] });
    }
    return out;
  });
  const wip = (h) => /^0+$/.test(h);
</script>
<div class="g-bar">
  <select class="input" style="max-width:100%;width:380px" bind:value={path} aria-label="File to blame">
    {#each files as p}<option value={p}>{p}</option>{/each}
  </select>
  {#if loading}<span class="faint small">loading…</span>{/if}
</div>
{#if err}<div class="card"><Empty icon="alert" title="Blame unavailable">{err.message}</Empty></div>
{:else if !groups.length}<div class="card"><Empty icon="users" title="No blame data">Pick a tracked markdown file.</Empty></div>
{:else}
  <section class="card" style="overflow:hidden">
    {#each groups as g}
      <div class="grp" style="--h:{wip(g.hash) ? 40 : hue(g.hash)}">
        <button class="meta" disabled={wip(g.hash)} onclick={() => navigate('git', { tab: 'history', hash: g.hash })} title={g.l.summary}>
          <span class="ellipsis small" style="font-weight:600">{g.l.author}</span>
          <span class="faint tiny ellipsis">{wip(g.hash) ? 'uncommitted' : g.l.short} · <span title={fmtDate(toMs(g.l.date))}>{timeAgo(toMs(g.l.date), app.now)}</span></span>
          <span class="faint tiny ellipsis">{g.l.summary}</span>
        </button>
        <div class="code mono">
          {#each g.rows as r}<div class="ln"><span class="n">{r.line}</span><span class="t">{text[r.line - 1] ?? ''}</span></div>{/each}
        </div>
      </div>
    {/each}
  </section>
{/if}
<style>
  .grp { display: flex; border-bottom: 1px solid var(--border); border-left: 3px solid hsl(var(--h) 60% 55%); background: linear-gradient(90deg, hsl(var(--h) 60% 55% / .07), transparent 40%); }
  .meta { width: 210px; flex-shrink: 0; display: flex; flex-direction: column; gap: 1px; padding: 6px 10px; border: 0; background: none; color: inherit; text-align: left; cursor: pointer; min-width: 0; }
  .meta:disabled { cursor: default; }
  .code { flex: 1; min-width: 0; overflow-x: auto; font-size: 12px; line-height: 1.6; padding: 4px 0; }
  .ln { display: flex; min-width: max-content; }
  .n { width: 40px; text-align: right; padding-right: 10px; color: var(--text-3); user-select: none; }
  .t { white-space: pre; padding-right: 12px; }
  @media (max-width: 700px) { .meta { width: 110px; } .meta :global(span:nth-child(3)) { display: none; } }
</style>
