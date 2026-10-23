<script>
  // One annotation (or a composer when `compose` is set). Inline under a line.
  import { app } from './store.svelte.js';
  import { timeAgo } from './format.js';
  import { linkifyText } from './links.js';
  import { addAnnotation, removeAnnotation, resolveAnnotation } from './annotations.js';
  import { canRun } from './actions.svelte.js';
  import Icon from './Icon.svelte';

  let { a = null, compose = null, onclose } = $props(); // compose = { path, line }
  let text = $state('');
  let busy = $state(false);

  async function submit(e) {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    busy = true;
    const r = await addAnnotation(compose.path, compose.line, text.trim());
    busy = false;
    if (r) {
      text = '';
      onclose?.();
    }
  }
  function onkey(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(e);
    if (e.key === 'Escape') {
      e.stopPropagation();
      onclose?.();
    }
  }
</script>

{#if compose}
  <form class="an compose" onsubmit={submit}>
    <!-- svelte-ignore a11y_autofocus -->
    <textarea class="input" rows="2" bind:value={text} placeholder="Add a note on line {compose.line}… (⌘↵ to save)" onkeydown={onkey} autofocus></textarea>
    <div class="row">
      <span class="faint small grow">Stored in .mdctl/annotations.json · re-anchors when the line moves</span>
      <button type="button" class="btn sm ghost" onclick={onclose}>Cancel</button>
      <button type="submit" class="btn sm primary" disabled={!text.trim() || busy || !canRun('state')}>Add note</button>
    </div>
  </form>
{:else if a}
  <div class="an" class:resolved={a.resolved} class:stale={a.stale}>
    <div class="ah">
      <span class="av"><Icon name="message" size={11} /></span>
      <b>{a.author || 'admin'}</b>
      <span class="faint">· {timeAgo(a.ts, app.now)}</span>
      {#if a.stale}<span class="badge warn" title="The anchored line was removed">stale</span>{/if}
      {#if a.resolved}<span class="badge ok">resolved</span>{/if}
      <span class="spacer"></span>
      {#if canRun('state')}
        <button class="btn sm ghost icon" title={a.resolved ? 'Reopen' : 'Resolve'} onclick={() => resolveAnnotation(a.id, !a.resolved)}><Icon name={a.resolved ? 'restore' : 'check'} size={12} /></button>
        <button class="btn sm ghost icon" title="Delete" onclick={() => removeAnnotation(a.id)}><Icon name="trash" size={12} /></button>
      {/if}
    </div>
    <div class="at">{@html linkifyText(a.text, { from: a.path })}</div>
  </div>
{/if}

<style>
  .an { margin: 6px 12px 8px 64px; padding: 9px 12px; border-radius: 11px; border: 1px solid color-mix(in srgb, var(--accent) 25%, var(--border)); background: color-mix(in srgb, var(--accent) 6%, var(--panel-solid)); font-family: var(--font); font-size: 12.5px; white-space: normal; max-width: 640px; }
  .an.resolved { opacity: 0.6; border-color: var(--border); background: var(--panel-hover); }
  .an.stale { border-style: dashed; }
  .ah { display: flex; align-items: center; gap: 6px; font-size: 11.5px; margin-bottom: 3px; }
  .ah b { font-weight: 650; text-transform: capitalize; }
  .av { width: 18px; height: 18px; border-radius: 6px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
  .at { color: var(--text); line-height: 1.55; word-break: break-word; }
  .compose { display: flex; flex-direction: column; gap: 7px; }
  .compose textarea { height: auto; padding: 8px 10px; resize: vertical; font-size: 12.5px; line-height: 1.5; }
  .small { font-size: 11px; }
  @media (max-width: 760px) { .an { margin-left: 12px; } }
</style>
