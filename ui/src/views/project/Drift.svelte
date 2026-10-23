<script>
  import { api } from '../../lib/api.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { openFile } from '../../lib/store.svelte.js';
  import { timeAgo } from '../../lib/format.js';
  import Section from './Section.svelte';

  const d = resource(() => api('/api/project/drift').catch(() => []), { key: () => 'd', live: false });
  const rows = $derived((Array.isArray(d.data) ? d.data : []).slice().sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.severity] - ({ high: 0, medium: 1, low: 2 })[b.severity]));
  const cls = (s) => (s === 'high' ? 'err' : s === 'medium' ? 'warn' : 'info');
</script>

{#if rows.length}
  <Section id="drift" title="Doc drift" icon="history" sub="docs older than the code they mention">
    <div class="list">
      {#each rows as r (r.doc)}
        <div class="row">
          <span class="sev {cls(r.severity)}">{r.severity}</span>
          <div class="grow">
            <button class="lk mono" onclick={() => openFile(r.doc, { drawer: true })}>{r.doc}</button>
            <div class="faint small">doc edited {timeAgo(r.docChangedAt)} · code changed {timeAgo(r.codeChangedAt)} · {r.commitsSince} commit{r.commitsSince === 1 ? '' : 's'} since</div>
            <div class="ms">{#each (r.mentions || []).slice(0, 6) as m (m)}<span class="m mono">{m}</span>{/each}{#if (r.mentions || []).length > 6}<span class="faint small">+{r.mentions.length - 6}</span>{/if}</div>
          </div>
        </div>
      {/each}
    </div>
  </Section>
{/if}

<style>
  .list { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 10px; }
  .row { display: flex; gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
  .row:last-child { border-bottom: 0; }
  .grow { flex: 1; min-width: 0; }
  .sev { align-self: flex-start; font-size: 10.5px; font-weight: 700; text-transform: uppercase; padding: 2px 7px; border-radius: 99px; }
  .sev.err { color: var(--err); background: var(--err-soft); } .sev.warn { color: var(--warn); background: var(--warn-soft); } .sev.info { color: var(--info); background: var(--info-soft); }
  .lk { border: 0; background: none; padding: 0; color: var(--text); font-weight: 600; cursor: pointer; font-size: 12.5px; overflow-wrap: anywhere; text-align: left; } .lk:hover { color: var(--accent); }
  .small { font-size: 11.5px; }
  .ms { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
  .m { font-size: 11px; padding: 1px 7px; border-radius: 6px; background: var(--panel-active); color: var(--text-2); max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
</style>
