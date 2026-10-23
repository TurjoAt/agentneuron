<script>
  // Markdown editor tab: CodeMirror + live preview (split), safe save with hash
  // check, 409 merge dialog, autosave, read-only when `edit` is disabled,
  // Ctrl/Cmd+click links, annotations gutter, context menu actions.
  import { onMount, onDestroy, tick } from 'svelte';
  import { api, post } from '../api.js';
  import { app, toast, openFile, navigate, saveLocal } from '../store.svelte.js';
  import { canRun, levelReason } from '../actions.svelte.js';
  import { resolveTarget, resolveRemote } from '../links.js';
  import { openMenu } from '../menu.svelte.js';
  import { createTask, findReplace } from '../fileActions.js';
  import { loadAnnotations } from '../annotations.js';
  import { createEditor } from './cm.js';
  import Markdown from '../Markdown.svelte';
  import Icon from '../Icon.svelte';
  import ConflictDialog from './ConflictDialog.svelte';
  import AnnotationCard from '../AnnotationCard.svelte';

  let { path, line = null } = $props();

  let host = $state();
  let previewEl = $state();
  let ed = null;
  let loaded = $state(false);
  let loadErr = $state('');
  let base = $state(''); // last saved / loaded content
  let baseHash = $state(null);
  let text = $state('');
  let saving = $state(false);
  let lastSaved = $state(0);
  let conflict = $state(null); // { mine, theirs, theirsHash, deleted }
  let diskChanged = $state(false);
  let mode = $state(readMode());
  let autosave = $state(readAuto());
  let annots = $state([]);
  let compose = $state(null); // line number
  let previewLine = $state(null);

  const isMd = $derived(/\.(md|mdc|markdown|mdx)$/i.test(path) || !/\.\w+$/.test(path));
  const editable = $derived(canRun('edit'));
  const dirty = $derived(loaded && text !== base);
  const lineAnnots = $derived(compose ? annots.filter((a) => a.line === compose) : []);

  function readMode() {
    try {
      const m = localStorage.getItem('mdctl.editor.mode');
      if (m === 'edit' || m === 'split' || m === 'preview') return innerWidth < 900 && m === 'split' ? 'edit' : m;
    } catch {
      /* ignore */
    }
    return innerWidth < 900 ? 'edit' : 'split';
  }
  function readAuto() {
    try {
      return localStorage.getItem('mdctl.editor.autosave') === '1';
    } catch {
      return false;
    }
  }
  function setMode(m) {
    mode = m;
    saveLocal('mdctl.editor.mode', m);
    if (m !== 'preview') tick().then(() => ed?.focus());
  }

  async function load(initial = false) {
    try {
      const r = await api('/api/file/raw', { path });
      base = r.content ?? '';
      baseHash = r.hash ?? null;
      text = base;
      if (ed) ed.set(base, { keepScroll: !initial });
      loaded = true;
      loadErr = '';
      diskChanged = false;
    } catch (e) {
      loadErr = e.status === 415 ? 'Binary files cannot be edited.' : e.status === 413 ? 'File is too large for the editor.' : e.message;
    }
  }

  async function refreshAnnots() {
    annots = await loadAnnotations(path);
    ed?.setAnnotations(annots);
  }

  onMount(async () => {
    await load(true);
    if (loadErr || !host) return;
    ed = createEditor(host, {
      doc: base,
      readOnly: !editable,
      onChange: (s) => (text = s),
      onSave: () => save(),
      onLink: follow,
      onGutter: (l) => (compose = compose === l ? null : l),
      onContext: ctxMenu,
      onScroll: (l) => (previewLine = l),
    });
    refreshAnnots();
    if (line) tick().then(() => ed?.gotoLine(+line));
    else if (editable && mode !== 'preview') ed.focus();
  });
  onDestroy(() => {
    ed?.destroy();
    clearTimeout(autoT);
    const d = { ...app.dirty };
    delete d[path];
    app.dirty = d;
  });

  // read-only follows live permission changes
  $effect(() => {
    const e = editable;
    ed?.setReadOnly(!e);
  });
  // annotations live refresh
  $effect(() => {
    void app.annotTick;
    if (loaded) refreshAnnots();
  });
  // dirty registry (beforeunload guard)
  $effect(() => {
    const d = dirty;
    const has = !!app.dirty[path];
    if (d !== has) {
      const n = { ...app.dirty };
      if (d) n[path] = true;
      else delete n[path];
      app.dirty = n;
    }
  });
  // external change on disk
  let lastPulse = app.pulses[path] || 0;
  $effect(() => {
    const t = app.pulses[path];
    if (!t || t === lastPulse || saving) return;
    lastPulse = t;
    if (Date.now() - lastSaved < 1500) return; // our own save echo
    api('/api/file/raw', { path })
      .then((r) => {
        if (r.hash === baseHash) return;
        if (!dirty) {
          base = r.content;
          baseHash = r.hash;
          text = r.content;
          ed?.set(r.content);
          toast(`${path} was updated on disk — reloaded`, 'info', 2600);
        } else diskChanged = true;
      })
      .catch(() => {});
  });

  let autoT;
  $effect(() => {
    void text;
    clearTimeout(autoT);
    if (autosave && dirty && editable && !conflict) autoT = setTimeout(() => save(true), 1500);
  });

  async function save(auto = false) {
    if (!editable) {
      toast(levelReason('edit'), 'warn', 5000);
      return;
    }
    if (saving || !loaded) return;
    const content = ed ? ed.value : text;
    if (content === base && !auto) {
      toast('No changes to save', 'info', 1500);
      return;
    }
    saving = true;
    try {
      const r = await post('/api/file/save', { path, content, baseHash });
      base = content;
      baseHash = r.hash;
      lastSaved = Date.now();
      diskChanged = false;
      if (!auto) toast(r.unchanged ? 'Already up to date' : `Saved ${path}`, 'ok', 1800);
    } catch (e) {
      if (e.status === 409) {
        conflict = { mine: content, theirs: e.body?.current ?? null, theirsHash: e.body?.currentHash ?? null, deleted: e.body?.current == null };
      } else toast(e.message, 'error', 6000);
    } finally {
      saving = false;
    }
  }

  async function reviewDisk() {
    try {
      const r = await api('/api/file/raw', { path });
      conflict = { mine: ed ? ed.value : text, theirs: r.content, theirsHash: r.hash, deleted: false };
    } catch (e) {
      conflict = { mine: ed ? ed.value : text, theirs: null, theirsHash: null, deleted: e.status === 404 };
    }
  }

  async function resolve(r) {
    const c = conflict;
    conflict = null;
    if (r.kind === 'theirs') {
      if (c.deleted) return navigate('files', {});
      base = c.theirs;
      baseHash = c.theirsHash;
      text = c.theirs;
      ed?.set(c.theirs);
      diskChanged = false;
      toast('Loaded the version on disk', 'info', 2000);
    } else {
      // mine or merged → save against the disk hash we just saw
      const content = r.kind === 'merge' ? r.content : c.mine;
      ed?.set(content);
      text = content;
      baseHash = c.theirsHash;
      base = c.theirs ?? '';
      await save();
    }
  }

  async function follow(target) {
    const local = resolveTarget(path, target);
    if (local) return openFile(local, { tab: 'edit' });
    const r = await resolveRemote(path, target);
    if (r?.path) openFile(r.path, { tab: 'edit' });
    else toast(`Can't resolve “${target}”${r?.candidates?.length ? ` — did you mean ${r.candidates[0]}?` : ''}`, 'warn', 5000);
  }

  function ctxMenu(e, info) {
    openMenu(
      e,
      [
        info.mention ? { label: `Open ${info.mention}`, icon: 'link', kbd: '⌘-click', run: () => follow(info.mention) } : null,
        info.mention ? { sep: true } : null,
        { label: info.selection ? 'Create task from selection' : 'Create task from this line', icon: 'tasks', run: () => createTask({ title: (info.selection || ed.view.state.doc.line(info.line).text).replace(/^\s*[-*]\s+(\[.\]\s+)?/, '').trim().slice(0, 200), files: [path], line: info.line }) },
        { label: `Add note on line ${info.line}`, icon: 'message', run: () => (compose = info.line), disabled: !canRun('state'), reason: levelReason('state') },
        info.selection ? { label: 'Find & replace selection in all files', icon: 'replace', run: () => findReplace(info.selection) } : null,
        { sep: true },
        { label: 'Save', icon: 'save', kbd: '⌘S', run: () => save(), disabled: !editable, reason: levelReason('edit') },
        { label: 'Find in file', icon: 'search', kbd: '⌘F', run: () => { ed.focus(); import('@codemirror/search').then((m) => m.openSearchPanel(ed.view)); } },
      ],
      `${path}:${info.line}`,
    );
  }

  // scroll-sync preview to the top line of the editor
  $effect(() => {
    const l = previewLine;
    if (mode !== 'split' || !previewEl || !l) return;
    let best = null;
    for (const n of previewEl.querySelectorAll('[data-line]')) {
      if (+n.dataset.line <= l) best = n;
      else break;
    }
    if (best) previewEl.scrollTo({ top: best.offsetTop - 12, behavior: 'auto' });
    else if (l <= 2) previewEl.scrollTo({ top: 0 });
  });

  const statusText = $derived(saving ? 'Saving…' : conflict ? 'Conflict' : dirty ? 'Unsaved changes' : lastSaved ? 'Saved' : 'Up to date');
</script>

<div class="ep mode-{mode}">
  <div class="bar">
    <div class="seg" role="tablist" aria-label="Editor layout">
      <button class:on={mode === 'edit'} onclick={() => setMode('edit')} title="Editor only"><Icon name="edit" size={13} /><span>Edit</span></button>
      <button class:on={mode === 'split'} onclick={() => setMode('split')} title="Side by side" class="hide-sm"><Icon name="split" size={13} /><span>Split</span></button>
      <button class:on={mode === 'preview'} onclick={() => setMode('preview')} title="Preview only"><Icon name="eye" size={13} /><span>Preview</span></button>
    </div>
    <span class="st" class:dirty class:err={!!conflict}>
      <span class="dot"></span>{statusText}
    </span>
    <span class="spacer"></span>
    {#if editable}
      <label class="auto" title="Save automatically 1.5 s after you stop typing">
        <input type="checkbox" class="sw sm" checked={autosave} onchange={(e) => { autosave = e.currentTarget.checked; saveLocal('mdctl.editor.autosave', autosave ? 1 : 0); try { localStorage.setItem('mdctl.editor.autosave', autosave ? '1' : '0'); } catch {} }} />
        <span class="hide-sm">Autosave</span>
      </label>
    {/if}
    <button class="btn sm" disabled={!dirty} onclick={() => { ed?.set(base); text = base; }} title="Discard unsaved edits"><Icon name="restore" size={12} /><span class="hide-sm">Revert</span></button>
    <button class="btn sm primary" disabled={!editable || saving || !dirty} onclick={() => save()} title="Save (⌘S)"><Icon name="save" size={12} /> Save</button>
  </div>

  {#if !editable}
    <div class="banner ro">
      <Icon name="lock" size={14} />
      <span class="grow">Read-only — {levelReason('edit')}</span>
      <a class="btn sm ghost" href="#/settings?tab=permissions">How to enable</a>
    </div>
  {/if}
  {#if diskChanged && !conflict}
    <div class="banner warn">
      <Icon name="alert" size={14} />
      <span class="grow"><b>{path}</b> changed on disk while you have unsaved edits.</span>
      <button class="btn sm" onclick={reviewDisk}><Icon name="merge" size={12} /> Review & merge</button>
    </div>
  {/if}

  {#if loadErr}
    <div class="empty"><Icon name="alert" size={18} /><b>Can't edit this file</b><span class="faint">{loadErr}</span></div>
  {:else}
    <div class="body">
      <div class="edcol" class:hidden={mode === 'preview'}>
        <div class="cm" bind:this={host}></div>
        {#if compose}
          <div class="notes">
            {#each lineAnnots as a (a.id)}<AnnotationCard {a} />{/each}
            <AnnotationCard compose={{ path, line: compose }} onclose={() => (compose = null)} />
          </div>
        {/if}
      </div>
      {#if mode !== 'edit'}
        <div class="pv" bind:this={previewEl}>
          {#if isMd}
            <Markdown source={text} {path} />
          {:else}
            <pre class="plain mono">{text}</pre>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if conflict}
  <ConflictDialog {path} mine={conflict.mine} theirs={conflict.theirs ?? ''} deleted={conflict.deleted} onresolve={resolve} onclose={() => (conflict = null)} />
{/if}

<style>
  .ep { display: flex; flex-direction: column; min-height: 0; height: 100%; }
  .bar { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .seg { display: inline-flex; padding: 2px; border-radius: 9px; background: var(--inset); border: 1px solid var(--border); }
  .seg button { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; height: 26px; padding: 0 10px; border-radius: 7px; font-size: 12px; font-weight: 550; color: var(--text-2); cursor: pointer; }
  .seg button.on { background: var(--panel-solid); color: var(--text); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2), 0 0 0 1px var(--border); }
  .st { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text-3); }
  .st .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); }
  .st.dirty { color: var(--text-2); }
  .st.dirty .dot { background: var(--warn); box-shadow: 0 0 0 3px var(--warn-soft); }
  .st.err .dot { background: var(--err); }
  .auto { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text-2); cursor: pointer; }
  .banner { display: flex; align-items: center; gap: 10px; padding: 8px 14px; font-size: 12.5px; border-bottom: 1px solid var(--border); }
  .banner.ro { background: var(--panel-hover); color: var(--text-2); }
  .banner.warn { background: var(--warn-soft); color: var(--text); }
  .banner.warn > :global(.icon) { color: var(--warn); }
  .body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); }
  .mode-split .body { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .edcol { position: relative; min-height: 0; display: flex; flex-direction: column; }
  .edcol.hidden { display: none; }
  .cm { flex: 1; min-height: 0; overflow: hidden; }
  .cm :global(.cm-editor) { height: 100%; }
  .notes { border-top: 1px solid var(--border); padding: 4px 0; max-height: 40%; overflow: auto; background: var(--inset); }
  .notes :global(.an) { margin-left: 16px; }
  .pv { min-height: 0; overflow: auto; padding: 18px 26px 40vh; border-left: 1px solid var(--border); }
  .mode-preview .pv { border-left: 0; padding: 22px clamp(16px, 4vw, 48px) 80px; max-width: 900px; width: 100%; margin: 0 auto; }
  .plain { white-space: pre-wrap; font-size: 12.5px; margin: 0; }
  .empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 60px 20px; color: var(--text-2); }
  @media (max-width: 760px) {
    .hide-sm { display: none !important; }
    .bar { padding: 8px 10px; gap: 8px; }
  }
</style>
