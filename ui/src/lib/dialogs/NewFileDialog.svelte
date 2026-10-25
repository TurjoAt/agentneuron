<script>
  // New file — blank or from a template (GET /api/agents/templates).
  import { untrack } from 'svelte';
  import { api, post } from '../api.js';
  import { app, openFile, toast, loadFiles, fileIndex } from '../store.svelte.js';
  import { canRun, levelReason } from '../actions.svelte.js';
  import { TOOLS, toolOf } from '../tools.js';
  import Modal from '../Modal.svelte';
  import Icon from '../Icon.svelte';
  import Markdown from '../Markdown.svelte';

  let { dir = '', onclose } = $props();

  let templates = $state([]);
  let loading = $state(true);
  let tpl = $state(null); // null = blank
  // `dir` only seeds the editable path field.
  let path = $state(untrack(() => (dir ? `${dir}/untitled.md` : 'untitled.md')));
  let vars = $state({});
  let preview = $state('');
  let busy = $state(false);
  let cat = $state('');

  api('/api/agents/templates')
    .then((t) => (templates = Array.isArray(t) ? t : []))
    .catch(() => (templates = []))
    .finally(() => (loading = false));

  const cats = $derived([...new Set(templates.map((t) => t.category || 'other'))]);
  const shown = $derived(templates.filter((t) => !cat || (t.category || 'other') === cat));
  const exists = $derived(fileIndex().set.has(path.trim()));
  const valid = $derived(!!path.trim() && !/(^|\/)\.\.(\/|$)/.test(path) && !path.startsWith('/') && !exists);

  function pick(t) {
    tpl = t;
    vars = Object.fromEntries((t?.vars || []).map((v) => [v.name, v.default ?? '']));
    if (t?.defaultPath) path = dir && !t.defaultPath.includes('/') ? `${dir}/${t.defaultPath}` : t.defaultPath;
  }

  let timer;
  $effect(() => {
    const t = tpl;
    const v = JSON.stringify(vars);
    clearTimeout(timer);
    if (!t) {
      preview = '';
      return;
    }
    timer = setTimeout(() => {
      api('/api/agents/template/render', { id: t.id, vars: v })
        .then((r) => (preview = r?.content || ''))
        .catch(() => (preview = ''));
    }, 200);
  });

  async function create() {
    if (!valid || busy) return;
    busy = true;
    try {
      const body = { path: path.trim() };
      if (tpl) {
        body.template = tpl.id;
        body.vars = vars;
      } else body.content = `# ${path.split('/').pop().replace(/\.\w+$/, '')}\n\n`;
      await post('/api/file/create', body);
      await loadFiles().catch(() => {});
      toast(`Created ${body.path}`, 'ok');
      onclose?.();
      openFile(body.path, { tab: 'edit' });
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      busy = false;
    }
  }
</script>

<Modal title="New file" subtitle="Blank or from a template" icon="filePlus" tone="accent" width={860} {onclose} flush>
  <div class="nf">
    <aside class="tl">
      <div class="cats">
        <button class="chip" class:on={!cat} onclick={() => (cat = '')}>All</button>
        {#each cats as c (c)}<button class="chip" class:on={cat === c} onclick={() => (cat = c)}>{c}</button>{/each}
      </div>
      <button class="tpl" class:on={!tpl} onclick={() => pick(null)}>
        <span class="ti"><Icon name="file" size={15} /></span>
        <span class="col grow" style="gap:0"><b>Blank markdown</b><span class="faint">Empty file with a heading</span></span>
      </button>
      {#if loading}
        {#each [1, 2, 3, 4] as k (k)}<div class="skel" style="height:44px;margin:4px 0"></div>{/each}
      {/if}
      {#each shown as t (t.id)}
        <button class="tpl" class:on={tpl?.id === t.id} onclick={() => pick(t)} style="--c:var(--tool-{toolOf(t.tool)})">
          <span class="ti tool"><span class="tool-dot"></span></span>
          <span class="col grow" style="gap:0;min-width:0">
            <b class="ellipsis">{t.name}</b>
            <span class="faint ellipsis">{t.description || t.defaultPath}</span>
          </span>
          {#if t.tool && TOOLS[t.tool]}<span class="badge">{TOOLS[t.tool].label}</span>{/if}
        </button>
      {/each}
    </aside>
    <div class="form">
      <label class="fld">
        <span class="fl">Path</span>
        <input class="input mono" bind:value={path} data-autofocus spellcheck="false" />
        {#if exists}<span class="err small">A file with this path already exists</span>{/if}
      </label>
      {#if tpl?.vars?.length}
        <div class="vars">
          {#each tpl.vars as v (v.name)}
            <label class="fld">
              <span class="fl">{v.label || v.name}</span>
              <input class="input" bind:value={vars[v.name]} />
            </label>
          {/each}
        </div>
      {/if}
      <div class="pv">
        <div class="eyebrow">Preview</div>
        <div class="pvb">
          {#if tpl && preview}
            <Markdown source={preview} {path} />
          {:else if tpl}
            <span class="faint">Rendering…</span>
          {:else}
            <Markdown source={`# ${path.split('/').pop().replace(/\.\w+$/, '')}\n`} {path} />
          {/if}
        </div>
      </div>
    </div>
  </div>
  {#snippet footer()}
    {#if !canRun('edit')}<span class="faint small grow"><Icon name="lock" size={12} /> {levelReason('edit')}</span>{:else}<span class="spacer"></span>{/if}
    <button class="btn" onclick={onclose}>Cancel</button>
    <button class="btn primary" onclick={create} disabled={!valid || busy || !canRun('edit')}><Icon name="plus" size={13} /> Create</button>
  {/snippet}
</Modal>

<style>
  .nf { display: grid; grid-template-columns: 300px minmax(0, 1fr); min-height: 460px; }
  .tl { border-right: 1px solid var(--border); padding: 12px; overflow: auto; max-height: 64dvh; display: flex; flex-direction: column; gap: 2px; }
  .cats { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
  .cats .chip { height: 22px; font-size: 11px; text-transform: capitalize; }
  .tpl { display: flex; align-items: center; gap: 10px; padding: 8px; border: 1px solid transparent; border-radius: 10px; background: transparent; cursor: pointer; text-align: left; font-size: 12px; }
  .tpl b { font-size: 13px; font-weight: 600; }
  .tpl:hover { background: var(--panel-hover); }
  .tpl.on { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 30%, transparent); }
  .ti { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; background: var(--panel-active); flex-shrink: 0; color: var(--text-2); }
  .ti.tool { background: color-mix(in srgb, var(--c) 14%, transparent); }
  .form { padding: 16px 20px; display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .fld { display: flex; flex-direction: column; gap: 5px; }
  .fl { font-size: 12px; font-weight: 600; color: var(--text-2); }
  .vars { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .pv { display: flex; flex-direction: column; gap: 6px; flex: 1; min-height: 0; }
  .pvb { flex: 1; border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; background: var(--inset); overflow: auto; max-height: 340px; }
  .err { color: var(--err); }
  .small { font-size: 12px; }
  @media (max-width: 760px) {
    .nf { grid-template-columns: 1fr; }
    .tl { max-height: 220px; border-right: 0; border-bottom: 1px solid var(--border); }
    .vars { grid-template-columns: 1fr; }
  }
</style>
