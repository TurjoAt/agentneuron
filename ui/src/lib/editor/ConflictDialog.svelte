<script>
  // 409 conflict resolver: your buffer vs the file on disk. Pick a side, or merge
  // block by block (yours / disk / both), with an editable merged result.
  import Modal from '../Modal.svelte';
  import Icon from '../Icon.svelte';
  import DiffView from '../DiffView.svelte';
  import { lineDiff, changeBlocks, mergeBlocks } from '../diff.js';

  let { path, mine = '', theirs = '', deleted = false, onresolve, onclose } = $props();

  let mode = $state('diff'); // diff | merge
  const diff = $derived(lineDiff(theirs ?? '', mine));
  const blocks = $derived(changeBlocks(mine, theirs ?? ''));
  const changes = $derived(blocks.filter((b) => b.kind === 'change'));
  let choice = $state({});
  let merged = $state('');
  let touched = $state(false);

  $effect(() => {
    const m = mergeBlocks(blocks, choice);
    if (!touched) merged = m;
  });

  function pickAll(c) {
    choice = Object.fromEntries(changes.map((b) => [b.id, c]));
    touched = false;
  }
  const unresolved = $derived(/^(<<<<<<< yours|>>>>>>> disk)$/m.test(merged));
</script>

<Modal title="File changed on disk" subtitle={path} icon="merge" tone="danger" width={980} {onclose} flush>
  <div class="cf">
    <div class="intro">
      <Icon name="alert" size={15} />
      <span>
        {#if deleted}The file was <b>deleted on disk</b> while you were editing.{:else}Someone (probably an agent) saved <b>{path}</b> after you opened it. Nothing has been overwritten yet.{/if}
        <span class="faint"> · <b class="ok tnum">+{diff.added}</b> <b class="err tnum">−{diff.removed}</b> lines yours vs disk · {changes.length} conflicting block{changes.length === 1 ? '' : 's'}</span>
      </span>
      <span class="spacer"></span>
      <div class="seg">
        <button class:on={mode === 'diff'} onclick={() => (mode = 'diff')}>Diff</button>
        <button class:on={mode === 'merge'} onclick={() => (mode = 'merge')} disabled={deleted}>Merge</button>
      </div>
    </div>

    {#if mode === 'diff'}
      <div class="legend faint"><span class="del">− on disk only</span><span class="add">+ yours only</span></div>
      <div class="dv"><DiffView hunks={diff.hunks} /></div>
    {:else}
      <div class="merge">
        <div class="blocks">
          <div class="row" style="gap:6px;margin-bottom:8px">
            <span class="eyebrow grow">Conflicting blocks</span>
            <button class="btn sm" onclick={() => pickAll('mine')}>All yours</button>
            <button class="btn sm" onclick={() => pickAll('theirs')}>All disk</button>
          </div>
          {#each changes as b (b.id)}
            <section class="blk">
              <div class="bh">
                <span class="faint">Block {b.id + 1}</span>
                <span class="spacer"></span>
                {#each [['mine', 'Yours'], ['theirs', 'Disk'], ['both', 'Both']] as [k, l] (k)}
                  <button class="chip" class:on={choice[b.id] === k} onclick={() => { choice = { ...choice, [b.id]: k }; touched = false; }}>{l}</button>
                {/each}
              </div>
              <div class="sides">
                <pre class="side mine" class:picked={choice[b.id] === 'mine' || choice[b.id] === 'both'}><span class="tag">yours</span>{b.mine.join('\n') || '∅ (nothing)'}</pre>
                <pre class="side theirs" class:picked={choice[b.id] === 'theirs' || choice[b.id] === 'both'}><span class="tag">disk</span>{b.theirs.join('\n') || '∅ (nothing)'}</pre>
              </div>
            </section>
          {:else}
            <div class="faint">No conflicting blocks — the versions are identical.</div>
          {/each}
        </div>
        <div class="result">
          <div class="row" style="margin-bottom:8px"><span class="eyebrow grow">Merged result (editable)</span>{#if unresolved}<span class="badge warn">markers left</span>{:else}<span class="badge ok">clean</span>{/if}</div>
          <textarea class="input mono" bind:value={merged} oninput={() => (touched = true)} spellcheck="false" aria-label="Merged content"></textarea>
        </div>
      </div>
    {/if}
  </div>
  {#snippet footer()}
    <button class="btn" onclick={() => onresolve?.({ kind: 'theirs' })}><Icon name="download" size={13} /> {deleted ? 'Close file' : 'Take disk version'}</button>
    <span class="spacer"></span>
    <button class="btn" onclick={onclose}>Decide later</button>
    {#if mode === 'merge'}
      <button class="btn primary" disabled={unresolved} title={unresolved ? 'Resolve all blocks first' : ''} onclick={() => onresolve?.({ kind: 'merge', content: merged })}><Icon name="merge" size={13} /> Save merged</button>
    {:else}
      <button class="btn danger" onclick={() => onresolve?.({ kind: 'mine' })}><Icon name="upload" size={13} /> Overwrite with mine</button>
    {/if}
  {/snippet}
</Modal>

<style>
  .cf { display: flex; flex-direction: column; min-height: 0; }
  .intro { display: flex; align-items: center; gap: 10px; padding: 12px 20px; background: var(--err-soft); color: var(--text-2); font-size: 13px; flex-wrap: wrap; }
  .intro > :global(.icon) { color: var(--err); flex-shrink: 0; }
  .intro b { color: var(--text); }
  .ok { color: var(--ok) !important; }
  .err { color: var(--err) !important; }
  .seg { display: inline-flex; border: 1px solid var(--border-strong); border-radius: 8px; overflow: hidden; background: var(--panel-solid); }
  .seg button { border: 0; background: transparent; padding: 5px 12px; font-size: 12px; cursor: pointer; color: var(--text-2); }
  .seg button.on { background: var(--panel-active); color: var(--text); font-weight: 600; }
  .legend { display: flex; gap: 16px; font-size: 11.5px; padding: 10px 20px 0; }
  .legend .del { color: var(--err); }
  .legend .add { color: var(--ok); }
  .dv { padding: 10px 20px 20px; max-height: 60dvh; overflow: auto; }
  .merge { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 0; min-height: 420px; max-height: 64dvh; }
  .blocks { padding: 14px 16px 14px 20px; overflow: auto; border-right: 1px solid var(--border); }
  .blk { border: 1px solid var(--border); border-radius: 12px; margin-bottom: 10px; overflow: hidden; }
  .bh { display: flex; align-items: center; gap: 5px; padding: 6px 8px 6px 12px; font-size: 12px; background: var(--panel-hover); border-bottom: 1px solid var(--border); }
  .bh .chip { height: 22px; font-size: 11px; }
  .sides { display: grid; grid-template-columns: 1fr 1fr; }
  .side { margin: 0; padding: 22px 10px 8px; font: 11.5px/1.55 var(--mono); white-space: pre-wrap; word-break: break-word; position: relative; opacity: 0.55; transition: opacity 0.15s; max-height: 220px; overflow: auto; }
  .side.picked { opacity: 1; }
  .side.mine { background: color-mix(in srgb, var(--ok) 7%, transparent); border-right: 1px solid var(--border); }
  .side.theirs { background: color-mix(in srgb, var(--info) 7%, transparent); }
  .tag { position: absolute; top: 4px; left: 10px; font: 650 9.5px var(--font); text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-3); }
  .result { padding: 14px 20px 14px 16px; display: flex; flex-direction: column; min-height: 0; }
  .result textarea { flex: 1; min-height: 300px; height: auto; padding: 10px 12px; resize: none; font-size: 12px; line-height: 1.55; }
  @media (max-width: 820px) {
    .merge { grid-template-columns: 1fr; max-height: none; }
    .blocks { border-right: 0; border-bottom: 1px solid var(--border); max-height: 40dvh; }
  }
</style>
