<script>
  import { app } from '../../lib/store.svelte.js';
  import { LEVELS, LEVEL_KEYS, HOW_TO_ENABLE } from '../../lib/levels.js';
  import Icon from '../../lib/Icon.svelte';

  let { settings = null } = $props();
  const cfg = $derived(settings?.actions || {});
  const me = $derived(app.me?.levels || {});
  function on(l) {
    if (l === 'read') return true;
    if (l === 'state') return !!me.state;
    return !!cfg[l] && me[l] !== false;
  }
  function why(l) {
    if (on(l)) return '';
    if (l === 'state') return HOW_TO_ENABLE.state;
    if (cfg[l] && me[l] === false) return 'Enabled in config, but your role (viewer) is not allowed to use it.';
    return HOW_TO_ENABLE[l];
  }
  const flags = $derived(LEVEL_KEYS.filter((l) => !['read', 'state'].includes(l) && !cfg[l]));
</script>

<section class="card">
  <div class="card-h">Permission levels <span class="sub">everything that changes something is off by default</span></div>
  <div class="card-b col" style="gap:0">
    {#each LEVEL_KEYS as l (l)}
      {@const m = LEVELS[l]}
      <div class="lv">
        <span class="ic {m.tone}"><Icon name={m.icon} size={15} /></span>
        <div class="grow col" style="gap:3px;min-width:0">
          <div class="row" style="gap:8px"><b>{m.label}</b><span class="mono faint tiny">{l}</span></div>
          <div class="muted small">{m.desc}</div>
          {#if !on(l)}<div class="how small"><Icon name="key" size={12} /> {why(l)}</div>{/if}
        </div>
        <span class="sw" class:on={on(l)} role="img" aria-label="{m.label} {on(l) ? 'on' : 'off'}"><i></i><span>{on(l) ? 'ON' : 'OFF'}</span></span>
      </div>
    {/each}
  </div>
</section>

<section class="card">
  <div class="card-h">How to enable <span class="sub">read-only — change this on the server, not here</span></div>
  <div class="card-b col" style="gap:12px">
    <div>
      <div class="eyebrow">.mdctl/config.json</div>
      <pre>{`{ "actions": { "edit": true, "exec": true, "danger": false, "terminal": false } }`}</pre>
    </div>
    <div>
      <div class="eyebrow">CLI flags</div>
      <pre>mdctl start --enable edit,exec            # add danger,terminal only if you need them
mdctl start --admin-token SECRET           # separate admin from read-only viewers</pre>
    </div>
    {#if settings?.howToEnable}<p class="muted small" style="margin:0">{settings.howToEnable}</p>{/if}
    {#if flags.length}<p class="faint small" style="margin:0">Currently off: {flags.join(', ')}. Restart mdctl after editing the config file.</p>{/if}
  </div>
</section>

<style>
  .lv { display: flex; gap: 14px; align-items: flex-start; padding: 12px 0; border-bottom: 1px solid var(--border); }
  .lv:last-child { border-bottom: 0; }
  .ic { width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; background: var(--panel-active); color: var(--text-2); flex-shrink: 0; }
  .ic.accent { color: var(--accent); background: var(--accent-soft); }
  .ic.warn { color: var(--warn); background: var(--warn-soft); }
  .ic.err { color: var(--err); background: var(--err-soft); }
  .ic.info { color: var(--info); background: var(--info-soft); }
  .how { color: var(--text-2); display: flex; gap: 6px; align-items: flex-start; }
  .small { font-size: 12.5px; }
  .tiny { font-size: 11px; }
  .sw { display: inline-flex; align-items: center; gap: 7px; height: 26px; padding: 0 10px 0 4px; border-radius: 99px; background: var(--panel-active); color: var(--text-3); font-size: 11px; font-weight: 700; flex-shrink: 0; }
  .sw i { width: 18px; height: 18px; border-radius: 50%; background: var(--text-3); }
  .sw.on { background: var(--ok-soft); color: var(--ok); }
  .sw.on i { background: var(--ok); }
  pre { margin: 4px 0 0; padding: 10px 12px; background: var(--inset); border: 1px solid var(--border); border-radius: 10px; font-family: var(--mono); font-size: 12px; overflow-x: auto; }
</style>
