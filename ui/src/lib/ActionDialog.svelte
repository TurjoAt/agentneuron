<script>
  // Renders the pending runAction() request: schema form, live command preview,
  // disabled reason + how-to-enable, typed confirmation for danger.
  import { post } from './api.js';
  import { app, toast, navigate } from './store.svelte.js';
  import { actionsState, actionEnabled, startJob } from './actions.svelte.js';
  import { LEVELS, CATEGORY_ICON } from './levels.js';
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';

  const req = $derived(actionsState.dialog);
  const def = $derived(req?.def);
  const schema = $derived(Object.entries(def?.params || {}));
  const status = $derived(req ? actionEnabled(req.id) : { enabled: false });
  const level = $derived(def?.level || 'edit');
  const isDanger = $derived(level === 'danger' || level === 'terminal');
  const confirmWord = $derived(req?.opts?.confirmText || def?.id || '');

  let values = $state({});
  let typed = $state('');
  let preview = $state({ loading: false, command: null, summary: '', error: '' });
  let running = $state(false);
  let errors = $state({});
  let timer;

  $effect(() => {
    const r = req;
    if (!r) return;
    const v = {};
    for (const [k, p] of Object.entries(r.def.params || {})) {
      const given = r.params?.[k];
      if (given !== undefined) v[k] = p.type === 'string[]' && Array.isArray(given) ? given.join('\n') : given;
      else if (p.default !== undefined) v[k] = p.type === 'string[]' && Array.isArray(p.default) ? p.default.join('\n') : p.default;
      else v[k] = p.type === 'boolean' ? false : '';
    }
    // pass-through params not in schema (registry unknown)
    for (const [k, val] of Object.entries(r.params || {})) if (!(k in v)) v[k] = val;
    values = v;
    typed = '';
    errors = {};
    running = false;
    preview = { loading: false, command: null, summary: '', error: '' };
  });

  function collect() {
    const out = {};
    const errs = {};
    for (const [k, val] of Object.entries(values)) {
      const p = def?.params?.[k] || {};
      let x = val;
      if (p.type === 'number') x = val === '' || val == null ? undefined : Number(val);
      else if (p.type === 'string[]') x = typeof val === 'string' ? val.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) : val;
      else if (p.type === 'boolean') x = !!val;
      else if (typeof x === 'string' && p.type) x = x.trim();
      if (p.required && (x === undefined || x === '' || (Array.isArray(x) && !x.length))) errs[k] = 'Required';
      else if (p.pattern && typeof x === 'string' && x && !new RegExp(p.pattern).test(x)) errs[k] = 'Invalid format';
      if (x !== undefined && x !== '') out[k] = x;
    }
    return { params: out, errs };
  }

  // live command preview (debounced)
  $effect(() => {
    if (!req) return;
    const { params, errs } = collect();
    clearTimeout(timer);
    if (Object.keys(errs).length) {
      preview = { ...preview, loading: false, error: '' };
      return;
    }
    const id = req.id;
    preview = { ...preview, loading: true };
    timer = setTimeout(() => {
      post('/api/actions/preview', { id, params })
        .then((r) => req?.id === id && (preview = { loading: false, command: r?.command ?? null, summary: r?.summary || '', error: '' }))
        .catch((e) => req?.id === id && (preview = { loading: false, command: null, summary: '', error: e.status === 404 ? '' : e.message }));
    }, 220);
  });

  const cmdText = $derived(Array.isArray(preview.command) ? preview.command.map(q).join(' ') : preview.command || '');
  function q(a) {
    a = String(a);
    return /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`;
  }

  const canSubmit = $derived(status.enabled && !running && (!isDanger || typed.trim() === confirmWord));

  function close(result = null) {
    const r = req;
    actionsState.dialog = null;
    r?.resolve(result);
  }

  async function submit(e) {
    e?.preventDefault();
    if (!canSubmit) return;
    const { params, errs } = collect();
    errors = errs;
    if (Object.keys(errs).length) return;
    running = true;
    const r = req;
    actionsState.dialog = null;
    try {
      const job = await startJob(r.id, params, r.opts);
      if (job?.status === 'error' && !r.opts?.silent) toast(`${def.title} failed${job.error ? `: ${job.error}` : ''}`, 'error', 6000);
      r.resolve(job);
    } catch (err) {
      toast(err.message, 'error', 6000);
      r.resolve(null);
    }
  }

  function howTo() {
    close(null);
    navigate('settings', { tab: 'permissions' });
  }
</script>

{#if req && def}
  <Modal
    title={req.opts?.title || def.title}
    subtitle={def.id}
    icon={CATEGORY_ICON[def.category] || LEVELS[level]?.icon || 'zap'}
    tone={isDanger ? 'danger' : 'accent'}
    width={540}
    onclose={() => close(null)}
  >
    <form class="ad" id="action-form" onsubmit={submit}>
      <div class="row lv">
        <span class="lvl {LEVELS[level]?.tone}"><Icon name={LEVELS[level]?.icon || 'zap'} size={12} /> {LEVELS[level]?.label || level}</span>
        {#if def.category}<span class="badge">{def.category}</span>{/if}
        {#if app.me?.role}<span class="faint small">as {app.me.role}</span>{/if}
      </div>
      {#if req.opts?.description || def.description}
        <p class="desc">{req.opts?.description || def.description}</p>
      {/if}

      {#if !status.enabled}
        <div class="off">
          <Icon name="lock" size={16} />
          <div class="col grow" style="gap:4px">
            <b>This action is disabled</b>
            <span class="mono small">{status.reason}</span>
          </div>
          <button type="button" class="btn sm" onclick={howTo}>How to enable</button>
        </div>
      {/if}

      {#if schema.length}
        <div class="fields">
          {#each schema as [k, p] (k)}
            <label class="fld" class:wide={p.type === 'text' || p.type === 'string[]'}>
              <span class="fl">
                {p.label || k}
                {#if p.required}<i class="req">required</i>{/if}
              </span>
              {#if p.type === 'boolean'}
                <span class="sw-row">
                  <input type="checkbox" class="sw" bind:checked={values[k]} />
                  <span class="faint small">{p.description || (values[k] ? 'Yes' : 'No')}</span>
                </span>
              {:else if p.type === 'enum'}
                <select class="input" bind:value={values[k]}>
                  {#if !p.required}<option value="">—</option>{/if}
                  {#each p.enum || [] as o (o)}<option value={o}>{o}</option>{/each}
                </select>
              {:else if p.type === 'text' || p.type === 'string[]'}
                <textarea class="input ta" rows={p.type === 'text' ? 4 : 3} bind:value={values[k]} placeholder={p.type === 'string[]' ? 'One per line' : p.placeholder || ''}></textarea>
              {:else if p.type === 'number'}
                <input class="input" type="number" bind:value={values[k]} />
              {:else if p.type === 'path'}
                <input class="input mono" list="ad-paths" bind:value={values[k]} placeholder="path/to/file.md" autocomplete="off" />
              {:else}
                <input class="input" class:mono={/name|ref|branch|path|command/i.test(k)} bind:value={values[k]} placeholder={p.placeholder || ''} autocomplete="off" spellcheck="false" />
              {/if}
              {#if errors[k]}<span class="err small">{errors[k]}</span>{:else if p.description && p.type !== 'boolean'}<span class="faint small">{p.description}</span>{/if}
            </label>
          {/each}
        </div>
        <datalist id="ad-paths">
          {#each app.files.slice(0, 400) as f (f.path)}<option value={f.path}></option>{/each}
        </datalist>
      {/if}

      <div class="pv">
        <div class="pv-h">
          <Icon name="terminal" size={13} />
          <span>Command preview</span>
          {#if preview.loading}<span class="spin"></span>{/if}
        </div>
        <pre class="pv-b mono">{#if cmdText}<span class="ps">$</span> {cmdText}{:else if preview.error}<span class="err">{preview.error}</span>{:else}<span class="faint">{preview.loading ? 'Resolving…' : 'No external command — runs inside mdctl'}</span>{/if}</pre>
        {#if preview.summary}<div class="pv-s">{preview.summary}</div>{/if}
      </div>

      {#if isDanger && status.enabled}
        <label class="typed">
          <span>Type <b class="mono">{confirmWord}</b> to confirm. This cannot be undone.</span>
          <input class="input mono" bind:value={typed} autocomplete="off" spellcheck="false" data-autofocus aria-label="Confirmation" />
        </label>
      {/if}
    </form>

    {#snippet footer()}
      <span class="faint small grow">Runs as a background job · live log in the Jobs dock</span>
      <button class="btn" type="button" onclick={() => close(null)}>Cancel</button>
      <button class="btn {isDanger ? 'danger' : 'primary'}" type="submit" form="action-form" disabled={!canSubmit}>
        <Icon name={isDanger ? 'alert' : 'play'} size={13} />
        {req.opts?.cta || (isDanger ? 'Run anyway' : 'Run')}
      </button>
    {/snippet}
  </Modal>
{/if}

<style>
  .ad { display: flex; flex-direction: column; gap: 14px; }
  .lv { gap: 6px; flex-wrap: wrap; }
  .lvl { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px; border-radius: 99px; font-size: 11px; font-weight: 650; letter-spacing: 0.02em; background: var(--panel-active); color: var(--text-2); }
  .lvl.accent { background: var(--accent-soft); color: var(--accent); }
  .lvl.warn { background: var(--warn-soft); color: var(--warn); }
  .lvl.err { background: var(--err-soft); color: var(--err); }
  .lvl.info { background: var(--info-soft); color: var(--info); }
  .desc { margin: 0; color: var(--text-2); font-size: 13.5px; line-height: 1.55; }
  .small { font-size: 12px; }
  .off { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 12px; background: var(--warn-soft); color: var(--warn); border: 1px solid color-mix(in srgb, var(--warn) 25%, transparent); }
  .off b { color: var(--text); font-weight: 600; font-size: 13px; }
  .off .mono { color: var(--text-2); word-break: break-word; }
  .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .fld { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .fld.wide, .fields .fld:only-child { grid-column: 1 / -1; }
  .fl { font-size: 12px; font-weight: 600; color: var(--text-2); display: flex; gap: 6px; align-items: baseline; }
  .req { font-style: normal; font-weight: 500; font-size: 10.5px; color: var(--text-3); }
  .ta { height: auto; padding: 8px 11px; resize: vertical; line-height: 1.5; }
  .sw-row { display: flex; align-items: center; gap: 10px; height: 34px; }
  .err { color: var(--err); }
  .pv { border-radius: 12px; border: 1px solid var(--border); background: #05060a; overflow: hidden; }
  :global([data-theme='light']) .pv { background: #101320; }
  .pv-h { display: flex; align-items: center; gap: 7px; padding: 7px 12px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; color: #8b93a7; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
  .pv-b { margin: 0; padding: 12px 14px; font-size: 12.5px; color: #e6e9f2; white-space: pre-wrap; word-break: break-all; min-height: 42px; }
  .pv-b .faint { color: #6b7386; }
  .ps { color: #2dd4a7; user-select: none; }
  .pv-s { padding: 0 14px 11px; font-size: 12px; color: #9aa2b5; }
  .typed { display: flex; flex-direction: column; gap: 7px; padding: 12px 14px; border-radius: 12px; border: 1px dashed color-mix(in srgb, var(--err) 45%, transparent); background: var(--err-soft); font-size: 12.5px; color: var(--text-2); }
  .typed b { color: var(--err); }
  .spin { width: 11px; height: 11px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.15); border-top-color: var(--accent); animation: spin 0.7s linear infinite; margin-left: auto; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 560px) {
    .fields { grid-template-columns: 1fr; }
  }
</style>
