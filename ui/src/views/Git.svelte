<script>
  import { api } from '../lib/api.js';
  import { app, openFile, isPulsing } from '../lib/store.svelte.js';
  import { resource } from '../lib/resource.svelte.js';
  import { timeAgo, toMs, fmtDate } from '../lib/format.js';
  import { GIT_STATUS } from '../lib/tools.js';
  import ToolBadge from '../lib/ToolBadge.svelte';
  import GitStatus from '../lib/GitStatus.svelte';
  import Icon from '../lib/Icon.svelte';
  import Empty from '../lib/Empty.svelte';

  let { params: _p } = $props();
  const git = resource(() => api('/api/git'));
  const info = $derived(git.data);
  const available = $derived(app.state?.git?.available !== false && info && (info.branch || info.head || info.recent?.length));
  const changed = $derived(app.files.filter((f) => f.gitStatus).sort((a, b) => a.path.localeCompare(b.path)));
  const tool = (p) => app.files.find((f) => f.path === p)?.tool;
  const initials = (n = '') => n.split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase() || '?';
  const hue = (n = '') => [...n].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
</script>

<div class="page">
  <div class="page-h">
    <div>
      <h1>Git</h1>
      <p>Repository state and recent commits that touched markdown.</p>
    </div>
  </div>

  {#if git.error}
    <Empty icon="alert" title="Could not load git info">{git.error.message}</Empty>
  {:else if !info}
    <div class="skel" style="height:200px"></div>
  {:else if !available}
    <div class="card"><Empty icon="git" title="Git not available">This project is not a git repository, or git is not installed. mdctl's local history still tracks every change.</Empty></div>
  {:else}
    <div class="grid">
      <section class="card repo">
        <div class="branch">
          <span class="bi"><Icon name="branch" size={20} /></span>
          <div class="col" style="gap:2px;min-width:0">
            <span class="eyebrow">Current branch</span>
            <span class="bn mono ellipsis">{info.branch || '(detached)'}</span>
          </div>
        </div>
        <dl class="kv">
          <dt>HEAD</dt><dd class="mono">{info.head || '—'}</dd>
          <dt>Remote</dt><dd class="mono ellipsis">{info.remote || '—'}</dd>
          <dt>Sync</dt>
          <dd>
            <span class="pill" class:hot={info.ahead}>↑ {info.ahead ?? 0} ahead</span>
            <span class="pill" class:hot={info.behind}>↓ {info.behind ?? 0} behind</span>
          </dd>
          <dt>Working tree</dt>
          <dd>{#if info.dirty}<span class="warn">{info.dirty} uncommitted change{info.dirty === 1 ? '' : 's'}</span>{:else}<span class="ok">clean</span>{/if}</dd>
        </dl>
      </section>

      <section class="card changes">
        <div class="card-h">Uncommitted markdown <span class="sub">{changed.length} files</span></div>
        <div class="card-b col" style="gap:2px">
          {#each changed as f (f.path)}
            <div class="list-row crow" class:pulse-row={isPulsing(f.path)}>
              <button class="cbtn" onclick={() => openFile(f.path, { drawer: true })}>
                <GitStatus status={f.gitStatus} />
                <ToolBadge tool={f.tool} compact />
                <span class="mono grow ellipsis small">{f.path}</span>
                <span class="faint tiny">{GIT_STATUS[f.gitStatus]?.label || f.gitStatus}</span>
              </button>
              <a class="btn sm ghost icon" href="#/diff?path={encodeURIComponent(f.path)}&from=git:HEAD&to=current" title="Diff vs HEAD" aria-label="Diff {f.path} vs HEAD"><Icon name="diff" size={13} /></a>
            </div>
          {:else}
            <div class="faint small" style="padding:8px">No uncommitted markdown changes.</div>
          {/each}
        </div>
      </section>
    </div>

    <section class="card commits">
      <div class="card-h">Recent commits touching markdown <span class="sub">{info.recent?.length || 0}</span></div>
      <ol class="clist">
        {#each info.recent || [] as c, i (c.hash)}
          <li class="fade-up" style="animation-delay:{Math.min(i, 10) * 30}ms">
            <span class="av" style="--h:{hue(c.author)}" title={c.author}>{initials(c.author)}</span>
            <div class="grow col" style="gap:4px">
              <div class="row" style="flex-wrap:wrap">
                <span class="subj">{c.subject}</span>
              </div>
              <div class="faint small"><span class="mono hash">{c.short || c.hash?.slice(0, 7)}</span> · {c.author} · <span title={fmtDate(toMs(c.date))}>{timeAgo(toMs(c.date), app.now)}</span></div>
              {#if c.files?.length}
                <div class="files">
                  {#each c.files as p (p)}
                    <button class="fchip mono" onclick={() => openFile(p, { drawer: true })}><ToolBadge tool={tool(p)} compact />{p}</button>
                  {/each}
                </div>
              {/if}
            </div>
          </li>
        {:else}
          <li class="faint">No recent commits.</li>
        {/each}
      </ol>
    </section>
  {/if}
</div>

<style>
  .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 16px; margin-bottom: 16px; }
  .repo { padding: 18px 20px; display: flex; flex-direction: column; gap: 16px; }
  .branch { display: flex; gap: 14px; align-items: center; }
  .bi { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; background: linear-gradient(135deg, var(--accent-soft), transparent); border: 1px solid var(--border); color: var(--accent); flex-shrink: 0; }
  .bn { font-size: 18px; font-weight: 650; }
  .kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 10px 18px; margin: 0; font-size: 13px; }
  .kv dt { color: var(--text-3); }
  .kv dd { margin: 0; display: flex; gap: 6px; flex-wrap: wrap; min-width: 0; }
  .pill { font-size: 12px; padding: 1px 8px; border-radius: 99px; background: var(--panel-active); color: var(--text-2); }
  .pill.hot { background: var(--accent-soft); color: var(--accent); }
  .warn { color: var(--warn); }
  .ok { color: var(--ok); }
  .small { font-size: 12.5px; }
  .tiny { font-size: 11px; }
  .crow { padding: 2px 4px 2px 0; cursor: default; }
  .cbtn { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; border: 0; background: none; padding: 6px 8px; cursor: pointer; text-align: left; }
  .changes .card-b { max-height: 320px; overflow: auto; }
  .clist { list-style: none; margin: 0; padding: 0 16px 16px; display: flex; flex-direction: column; }
  .clist li { display: flex; gap: 14px; padding: 12px 0; border-bottom: 1px solid var(--border); }
  .clist li:last-child { border-bottom: 0; }
  .av { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; font-size: 11.5px; font-weight: 700; color: white; background: linear-gradient(135deg, hsl(var(--h) 70% 55%), hsl(calc(var(--h) + 40) 70% 45%)); flex-shrink: 0; }
  .subj { font-weight: 550; }
  .hash { color: var(--accent); }
  .files { display: flex; gap: 6px; flex-wrap: wrap; }
  .fchip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); background: var(--panel-hover); border-radius: 7px; padding: 2px 8px; font-size: 11.5px; color: var(--text-2); cursor: pointer; }
  .fchip:hover { color: var(--text); border-color: var(--border-strong); }
  @media (max-width: 900px) {
    .grid { grid-template-columns: 1fr; }
  }
</style>
