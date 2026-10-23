<script>
  import { onMount } from 'svelte';
  import { jobs, openJob, loadJobs } from '../../lib/actions.js';
  import { fmtTime, timeAgo } from '../../lib/format.js';
  import Empty from '../../lib/Empty.svelte';

  onMount(() => { loadJobs(); });
  const dur = (j) => {
    if (!j.startedAt) return '';
    const ms = (j.endedAt || Date.now()) - j.startedAt;
    return ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60000)} min`;
  };
  const tone = (s) => (s === 'ok' ? 'ok' : s === 'error' ? 'err' : s === 'running' || s === 'queued' ? 'info' : 'warn');
</script>

<section class="card">
  <div class="card-h">Jobs history <span class="sub">{jobs.list.length} recent</span></div>
  {#if !jobs.list.length}
    <Empty icon="play" title="No jobs yet">Actions you run (commits, scripts, syncs…) show up here with their logs.</Empty>
  {:else}
    <div class="scroll">
      <table class="tbl">
        <thead><tr><th>Action</th><th>Level</th><th>Status</th><th>Started</th><th class="hide">Duration</th></tr></thead>
        <tbody>
          {#each jobs.list as j (j.id)}
            <tr class="clk" onclick={() => openJob(j.id)}>
              <td><b class="small">{j.title || j.actionId}</b>{#if j.command}<div class="faint tiny mono ellipsis cm">{j.command}</div>{/if}</td>
              <td><span class="badge">{j.level}</span></td>
              <td><span class="badge {tone(j.status)}">{j.status}{j.exitCode ? ` (${j.exitCode})` : ''}</span></td>
              <td class="nw" title={fmtTime(j.startedAt)}>{timeAgo(j.startedAt)}</td>
              <td class="hide faint small">{dur(j)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style>
  .scroll { overflow-x: auto; }
  .clk { cursor: pointer; }
  .nw { white-space: nowrap; }
  .cm { max-width: 380px; }
  .small { font-size: 12.5px; }
  .tiny { font-size: 11px; }
  @media (max-width: 640px) { .hide { display: none; } }
</style>
