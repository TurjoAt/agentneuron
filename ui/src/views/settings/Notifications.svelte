<script>
  import { app, saveLocal, toast } from '../../lib/store.svelte.js';
  import { timeAgo } from '../../lib/format.js';
  import Icon from '../../lib/Icon.svelte';

  let { settings = null } = $props();
  const KEY = 'mdctl.browserNotify';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'false') === true; } catch { return false; } };
  let want = $state(read());
  let perm = $state(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const hooks = $derived(settings?.notifications?.webhooks || []);
  const serverBrowser = $derived(settings?.notifications?.browser !== false);

  async function toggle() {
    if (!want && perm === 'default') {
      try { perm = await Notification.requestPermission(); } catch { /* ignore */ }
      if (perm !== 'granted') { toast('Browser notifications were not allowed', 'warn'); return; }
    }
    if (!want && perm === 'denied') { toast('Notifications are blocked in your browser settings', 'warn'); return; }
    want = !want;
    saveLocal(KEY, want);
  }
  const recent = $derived(app.notifications.slice(0, 12));
</script>

<div class="stack">
  <section class="card">
    <div class="card-h">Browser notifications</div>
    <div class="card-b row" style="gap:14px;flex-wrap:wrap">
      <div class="grow col" style="gap:3px;min-width:220px">
        <b>Notify me when this tab is in the background</b>
        <span class="muted small">Secret found, agent conflict, health drop, job finished or failed.</span>
        <span class="faint small">Permission: <b>{perm}</b>{#if !serverBrowser} · disabled in server config{/if}</span>
      </div>
      {#if perm === 'unsupported'}
        <span class="badge">not supported</span>
      {:else}
        <button class="btn" class:primary={!want} onclick={toggle}><Icon name="bell" size={14} /> {want ? 'Turn off' : 'Turn on'}</button>
      {/if}
    </div>
  </section>

  <section class="card">
    <div class="card-h">Webhooks <span class="sub">{hooks.length} configured · Slack/Discord compatible</span></div>
    <div class="card-b col" style="gap:8px">
      {#each hooks as w, i (i)}
        <div class="wh">
          <Icon name="globe" size={14} />
          <code class="grow ellipsis">{w.url}</code>
          <span class="chips">{#each w.events || [] as e (e)}<span class="badge">{e}</span>{:else}<span class="faint small">all events</span>{/each}</span>
        </div>
      {:else}
        <div class="faint small">No webhooks configured.</div>
      {/each}
      <div class="eyebrow" style="margin-top:6px">Add one in .mdctl/config.json</div>
      <pre>{`{ "notifications": { "webhooks": [ { "url": "https://hooks.slack.com/…", "events": ["secret","conflict","health-drop","job-failed","job-done"] } ] } }`}</pre>
      <span class="faint small">URLs are masked here; secrets never leave the server.</span>
    </div>
  </section>

  <section class="card">
    <div class="card-h">Recent <span class="sub">this session</span></div>
    <div class="card-b col" style="gap:2px">
      {#each recent as n, i (n.ts + '' + i)}
        <div class="list-row" style="cursor:default">
          <span class="badge {n.level === 'error' ? 'err' : n.level === 'warn' ? 'warn' : n.level === 'ok' ? 'ok' : 'info'}">{n.type || n.level || 'info'}</span>
          <span class="grow small"><b>{n.title}</b> <span class="muted">{n.body || ''}</span></span>
          <span class="faint tiny">{timeAgo(n.ts, app.now)}</span>
        </div>
      {:else}<div class="faint small">Nothing yet.</div>{/each}
    </div>
  </section>
</div>

<style>
  .stack { display: flex; flex-direction: column; gap: 14px; }
  .small { font-size: 12.5px; }
  .tiny { font-size: 11px; }
  .wh { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 9px 12px; border: 1px solid var(--border); border-radius: 10px; }
  .wh code { font-family: var(--mono); font-size: 12px; min-width: 160px; }
  .chips { display: flex; gap: 4px; flex-wrap: wrap; }
  pre { margin: 0; padding: 10px 12px; background: var(--inset); border: 1px solid var(--border); border-radius: 10px; font-family: var(--mono); font-size: 11.5px; overflow-x: auto; white-space: pre-wrap; }
</style>
