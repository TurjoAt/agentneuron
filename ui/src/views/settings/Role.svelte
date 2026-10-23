<script>
  import { app, logout } from '../../lib/store.svelte.js';
  import { LEVELS, LEVEL_KEYS } from '../../lib/levels.js';
  import Icon from '../../lib/Icon.svelte';

  let { settings = null } = $props();
  const role = $derived(app.me?.role || settings?.roles?.you || 'unknown');
  const r = $derived(settings?.roles || {});
</script>

<section class="card">
  <div class="card-h">Role &amp; authentication</div>
  <div class="card-b col" style="gap:16px">
    <div class="row" style="gap:14px;flex-wrap:wrap">
      <span class="ava big" style="--h:{role === 'admin' ? 250 : 160}"><Icon name="user" size={18} /></span>
      <div class="col" style="gap:2px">
        <div class="eyebrow">You are</div>
        <div class="rl">{role}</div>
      </div>
      <span class="spacer"></span>
      {#if app.me?.tokenRequired || r.tokenRequired}
        <button class="btn" onclick={logout}><Icon name="logout" size={14} /> Log out</button>
      {:else}
        <span class="badge">no token required</span>
      {/if}
    </div>

    <div class="grid">
      <div class="kv"><span class="faint">Token required</span><b>{(app.me?.tokenRequired ?? r.tokenRequired) ? 'yes' : 'no (open on this machine)'}</b></div>
      <div class="kv"><span class="faint">Admin token</span><b>{r.adminToken ? 'configured' : 'not set'}</b></div>
      <div class="kv"><span class="faint">Viewer token</span><b>{r.viewerToken ? 'configured' : 'not set'}</b></div>
    </div>

    <div>
      <div class="eyebrow" style="margin-bottom:8px">What this role can do right now</div>
      <div class="chips">
        {#each LEVEL_KEYS as l (l)}
          <span class="badge {app.me?.levels?.[l] || l === 'read' ? 'ok' : ''}"><Icon name={LEVELS[l].icon} size={11} /> {LEVELS[l].label}{app.me?.levels?.[l] || l === 'read' ? '' : ' — off'}</span>
        {/each}
      </div>
    </div>

    <p class="muted small" style="margin:0">
      With no tokens configured everyone is <b>admin</b>. If only <code>token</code> is set, its holder is admin.
      If <code>adminToken</code> is set, it is the admin and <code>token</code> becomes a read-only <b>viewer</b>.
      Even admins need the matching permission level enabled in the config.
    </p>
  </div>
</section>

<style>
  .rl { font-size: 24px; font-weight: 700; letter-spacing: -0.03em; text-transform: capitalize; }
  .big { width: 44px; height: 44px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
  .kv { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; font-size: 13px; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .small { font-size: 12.5px; }
  code { font-family: var(--mono); font-size: 11.5px; background: var(--inset); padding: 1px 5px; border-radius: 5px; }
</style>
