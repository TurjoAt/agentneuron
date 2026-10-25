<script>
  import { untrack } from 'svelte';
  import { post } from '../../lib/api.js';
  import { navigate, toast } from '../../lib/store.svelte.js';
  import { canRun, levelReason } from '../../lib/actions.svelte.js';
  import Markdown from '../../lib/Markdown.svelte';
  import Icon from '../../lib/Icon.svelte';
  import Empty from '../../lib/Empty.svelte';
  import { ruleStatus, STATUS_LABEL, TOOL_LABEL, NEW_RULE } from './shared.js';

  let { rules, preview, selected = '', onchange } = $props();

  const list = $derived(rules.data?.rules || []);
  const invalid = $derived(rules.data?.invalid || []);
  const status = $derived(ruleStatus(preview.data));
  const canEdit = $derived(canRun('edit'));
  const why = $derived(levelReason('edit'));

  let slug = $state(untrack(() => selected));
  let text = $state('');
  let base = $state(null); // { hash, text } of the loaded rule; null for a new rule
  let mode = $state('split');
  let newSlug = $state('');
  let saving = $state(false);
  let err = $state('');

  $effect(() => { const s = selected; untrack(() => { if (s && s !== slug) slug = s; }); });
  $effect(() => {
    const s = slug;
    const r = list.find((x) => x.slug === s);
    untrack(() => {
      if (r && (!base || base.slug !== s || base.hash !== r.hash)) { text = r.text; base = { slug: s, hash: r.hash, text: r.text }; err = ''; }
    });
  });
  const current = $derived(list.find((x) => x.slug === slug) || null);
  const dirty = $derived(base ? text !== base.text : !!text);
  const body = $derived(text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, ''));

  function pick(s) { navigate('rules', { tab: 'rules', rule: s }); slug = s; }
  function startNew() {
    const s = newSlug.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(s)) { err = 'Use lowercase letters, digits and dashes.'; return; }
    if (list.some((r) => r.slug === s)) { pick(s); return; }
    slug = s; base = null; text = NEW_RULE(s); newSlug = ''; err = '';
  }
  async function save() {
    saving = true; err = '';
    try {
      const r = await post('/api/compiler/rule', { slug, content: text, baseHash: base?.hash || undefined });
      base = { slug, hash: r.hash, text };
      toast(r.warnings?.length ? `Saved with warnings: ${r.warnings.join('; ')}` : `Saved ${slug}.md`, r.warnings?.length ? 'warn' : 'ok');
      onchange?.();
    } catch (e) { err = e.message; }
    saving = false;
  }
</script>

<div class="grid">
  <section class="card list">
    <div class="card-h">Source rules <span class="sub">{list.length}</span></div>
    {#if rules.error}
      <Empty icon="alert" title="Could not read the rules">{rules.error.message}</Empty>
    {:else if !rules.data}
      <div class="card-b"><div class="skel" style="height:180px"></div></div>
    {:else}
      {#if !list.length}
        <div class="card-b faint small">No source rules yet. Create one below, or <button class="lnk" onclick={() => navigate('rules', { tab: 'import' })}>import them from your existing files</button>.</div>
      {/if}
      <ul>
        {#each list as r (r.slug)}
          {@const st = r.errors?.length ? 'invalid' : status.get(r.slug) || 'none'}
          <li>
            <button class="item" class:on={r.slug === slug} onclick={() => pick(r.slug)}>
              <span class="row t"><b>{r.title}</b><span class="spacer"></span><span class="st {st}" title={STATUS_LABEL[st]}>{STATUS_LABEL[st]}</span></span>
              <span class="row chips">
                <span class="mono faint tiny">{r.slug}.md</span>
                {#if r.priority}<span class="chip sm">p{r.priority}</span>{/if}
                {#each r.scope.length ? r.scope : ['everywhere'] as g (g)}<span class="chip sm scope" title="Scope">{g}</span>{/each}
                {#if r.tools.length === 6}<span class="chip sm tool">all tools</span>{:else}{#each r.tools as t (t)}<span class="chip sm tool">{TOOL_LABEL[t] || t}</span>{/each}{/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
      {#each invalid.filter((i) => !list.some((r) => r.slug === i.slug)) as i (i.file)}
        <div class="card-b bad small"><Icon name="alert" size={12} /> <span class="mono">{i.file}</span>: {i.errors.join('; ')}</div>
      {/each}
      <div class="card-b newrow">
        <input class="inp mono" placeholder="new-rule-slug" bind:value={newSlug} onkeydown={(e) => e.key === 'Enter' && startNew()} aria-label="New rule slug" />
        <button class="btn sm" onclick={startNew}><Icon name="plus" size={12} /> New rule</button>
      </div>
    {/if}
  </section>

  <section class="card ed">
    {#if !slug}
      <Empty icon="file" title="Pick a rule">Select a source rule to edit it. Frontmatter keys: <span class="mono">title, description, scope, tools, priority, alwaysApply</span>.</Empty>
    {:else}
      <div class="card-h">
        <span class="mono">{slug}.md</span>
        {#if !base}<span class="chip sm">new</span>{/if}
        {#if dirty}<span class="chip sm">unsaved</span>{/if}
        <span class="spacer"></span>
        <div class="segc" role="group" aria-label="Editor layout">
          {#each ['edit', 'split', 'preview'] as m (m)}<button class:on={mode === m} onclick={() => (mode = m)}>{m}</button>{/each}
        </div>
        <button class="btn sm primary" disabled={!canEdit || saving || !dirty} title={canEdit ? '' : why} onclick={save}><Icon name="check" size={12} /> Save</button>
      </div>
      {#if current?.errors?.length}<div class="card-b bad small">{current.errors.join('; ')}</div>{/if}
      {#if current?.warnings?.length}<div class="card-b faint small">{current.warnings.join('; ')}</div>{/if}
      {#if !canEdit}<div class="card-b faint small"><Icon name="lock" size={12} /> Read-only: {why}.</div>{/if}
      {#if err}<div class="card-b bad small">{err}</div>{/if}
      <div class="panes {mode}">
        {#if mode !== 'preview'}
          <textarea class="src mono" bind:value={text} readonly={!canEdit} spellcheck="false" aria-label="Rule source"></textarea>
        {/if}
        {#if mode !== 'edit'}
          <div class="pv"><Markdown source={body} path={`${slug}.md`} /></div>
        {/if}
      </div>
    {/if}
  </section>
</div>

<style>
  .grid { display: grid; grid-template-columns: minmax(260px, 360px) minmax(0, 1fr); gap: 14px; align-items: start; }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  ul { list-style: none; margin: 0; padding: 0 8px 8px; display: flex; flex-direction: column; gap: 4px; }
  .item { width: 100%; text-align: left; border: 1px solid transparent; background: none; border-radius: 10px; padding: 8px 10px; cursor: pointer; color: var(--text); display: flex; flex-direction: column; gap: 6px; }
  .item:hover { background: var(--panel-hover); }
  .item.on { background: var(--panel-active); border-color: var(--border-strong); }
  .t b { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chips { flex-wrap: wrap; gap: 4px; }
  .chip.sm { height: 20px; font-size: 11px; padding: 0 7px; }
  .chip.scope { font-family: var(--mono); }
  .st { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 99px; background: var(--panel-hover); color: var(--text-3); white-space: nowrap; }
  .st.ok { color: var(--ok); background: var(--ok-soft); }
  .st.stale { color: var(--warn); background: var(--warn-soft); }
  .st.edited, .st.invalid { color: var(--err); background: var(--err-soft); }
  .bad { color: var(--err); }
  .small { font-size: 12.5px; }
  .tiny { font-size: 11px; }
  .lnk { border: 0; background: none; padding: 0; color: var(--accent); cursor: pointer; font: inherit; }
  .newrow { display: flex; gap: 8px; border-top: 1px solid var(--border); padding-top: 12px; }
  .inp { flex: 1; min-width: 0; height: 28px; border: 1px solid var(--border); border-radius: 7px; background: var(--inset); color: var(--text); padding: 0 8px; }
  .panes { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border-top: 1px solid var(--border); min-height: 420px; }
  .panes.edit, .panes.preview { grid-template-columns: 1fr; }
  .src { width: 100%; min-height: 420px; resize: vertical; border: 0; border-right: 1px solid var(--border); background: var(--inset); color: var(--text); padding: 12px 14px; font-size: 12.5px; line-height: 1.6; outline: none; }
  .pv { padding: 8px 18px; overflow: auto; max-height: 70vh; min-width: 0; }
</style>
