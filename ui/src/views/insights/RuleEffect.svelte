<script>
  import { api } from '../../lib/api.js';
  import { openFile } from '../../lib/store.svelte.js';
  import { resource } from '../../lib/resource.svelte.js';
  import { fmtNum } from '../../lib/format.js';
  import Empty from '../../lib/Empty.svelte';
  import EntityLink from '../../lib/EntityLink.svelte';

  const TYPE = { 'path-prohibition': 'path', 'command-preference': 'command', 'command-prohibition': 'command', 'run-before': 'before commit' };
  const rules = resource(() => api('/api/insights/rules'), { live: false });
  let onlyCheckable = $state(true);
  const d = $derived(rules.data);
  const rows = $derived((d?.rules || []).filter((r) => !onlyCheckable || r.checkable));
  const rate = (r) => (r.appliesTimes ? Math.round((r.followed / r.appliesTimes) * 100) : null);
</script>

{#if rules.error}
  <Empty icon="alert" title="Could not score the rules">{rules.error.message}</Empty>
{:else if !d}
  <div class="skel" style="height:260px"></div>
{:else if !d.rules.length}
  <Empty icon="file" title="No rules found">No bullet rules in CLAUDE.md, AGENTS.md or rule files yet.</Empty>
{:else}
  <div class="stack">
    <section class="kp card">
      <div><div class="eyebrow">Rules</div><b class="big tnum">{d.rules.length}</b><div class="faint tiny">{d.rules.filter((r) => r.checkable).length} checkable</div></div>
      <div><div class="eyebrow">Sessions checked</div><b class="big tnum">{d.sessions}</b></div>
      <div><div class="eyebrow">Ignored</div><b class="big tnum" class:bad={d.ignored.length}>{d.ignored.length}</b><div class="faint tiny">violated ≥ followed</div></div>
      <div><div class="eyebrow">Never relevant</div><b class="big tnum">{d.neverRelevant.length}</b></div>
      <div><div class="eyebrow">Diet savings</div><b class="big tnum">{fmtNum(d.diet.tokensSaved)}</b><div class="faint tiny">of {fmtNum(d.diet.totalRuleTokens)} rule tokens / session</div></div>
    </section>

    <section class="card">
      <div class="card-h">Context diet <span class="sub">{d.diet.note}</span></div>
      <div class="card-b diet">
        <div>
          <div class="eyebrow">Cut</div>
          {#each d.diet.cut as r (r.id)}
            <div class="drow"><span class="badge info tnum">−{r.tokenCost}</span><span class="grow">{r.rule}<div class="faint tiny">{r.reason}</div></span><button class="btn ghost sm mono" onclick={() => openFile(r.file, { drawer: true })}>{r.file}:{r.line}</button></div>
          {:else}<div class="faint small">{d.diet.enoughData ? 'Every rule was relevant at least once.' : 'Not enough sessions yet.'}</div>{/each}
        </div>
        <div>
          <div class="eyebrow">Tighten</div>
          {#each d.diet.tighten as r (r.id)}
            <div class="drow"><span class="badge err tnum">{r.violated}×</span><span class="grow">{r.rule}<div class="faint tiny">{r.suggestion}</div></span><button class="btn ghost sm mono" onclick={() => openFile(r.file, { drawer: true })}>{r.file}:{r.line}</button></div>
          {:else}<div class="faint small">No rule is ignored more often than followed.</div>{/each}
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-h">Rules vs. what agents did <span class="spacer"></span><label class="small muted chk"><input type="checkbox" bind:checked={onlyCheckable} /> checkable only</label></div>
      <div class="scroll">
        <table class="tbl">
          <thead><tr><th>Rule</th><th>Kind</th><th>Applies</th><th>Followed</th><th>Violated</th><th>Tokens</th><th>Source</th></tr></thead>
          <tbody>
            {#each rows as r (r.id)}
              <tr>
                <td class="rt">{r.rule}{#if r.examples.length}<div class="faint tiny ex">{r.examples[0].kind}: {r.examples[0].text}{#if r.examples[0].session} · <EntityLink kind="session" id={r.examples[0].session} label="session" title="Open the session behind this example" />{/if}</div>{/if}</td>
                <td>{#if r.type}<span class="badge">{TYPE[r.type] || r.type}</span>{:else}<span class="faint tiny">not checkable</span>{/if}</td>
                <td class="tnum">{r.appliesTimes}</td>
                <td class="tnum"><span class="ok">{r.followed}</span>{#if rate(r) !== null}<div class="meter"><span style="width:{rate(r)}%"></span></div>{/if}</td>
                <td class="tnum" class:bad={r.violated}>{r.violated}</td>
                <td class="tnum">{r.tokenCost}</td>
                <td><button class="btn ghost sm mono" onclick={() => openFile(r.file, { drawer: true })}>{r.file}:{r.line}</button></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  </div>
{/if}

<style>
  .stack { display: flex; flex-direction: column; gap: 14px; }
  .kp { display: flex; gap: 28px; flex-wrap: wrap; padding: 14px 16px; }
  .big { font-size: 24px; font-weight: 700; letter-spacing: -0.03em; }
  .bad { color: var(--err); }
  .ok { color: var(--ok); }
  .diet { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 18px; }
  .drow { display: flex; gap: 8px; align-items: flex-start; padding: 6px 0; border-bottom: 1px solid var(--border); min-width: 0; }
  .grow { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 13px; }
  .scroll { overflow: auto; max-height: 560px; }
  .rt { min-width: 260px; max-width: 520px; overflow-wrap: anywhere; }
  .ex { margin-top: 2px; }
  .meter { height: 3px; width: 48px; background: var(--border); border-radius: 2px; margin-top: 3px; overflow: hidden; }
  .meter span { display: block; height: 100%; background: var(--ok); }
  .chk { display: inline-flex; gap: 6px; align-items: center; font-weight: 400; }
  .small { font-size: 12.5px; }
  .tiny { font-size: 11px; }
</style>
