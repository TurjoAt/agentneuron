<script>
  import { scale } from 'svelte/transition';
  import { app, openFile, saveLocal, navigate } from './store.svelte.js';
  import { timeAgo } from './format.js';
  import { dur } from './motion.js';
  import Icon from './Icon.svelte';

  let open = $state(false);
  let browser = $state(readBrowser());
  const supported = typeof Notification !== 'undefined';

  function readBrowser() {
    try {
      return JSON.parse(localStorage.getItem('agentneuron.browserNotify') || 'false');
    } catch {
      return false;
    }
  }

  function toggle() {
    open = !open;
    if (open) app.unread = 0;
  }

  async function setBrowser(on) {
    if (on && supported && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission().catch(() => 'denied');
      if (p !== 'granted') on = false;
    }
    browser = on;
    saveLocal('agentneuron.browserNotify', on);
  }

  const ICON = { secret: 'key', conflict: 'users', 'health-drop': 'health', 'job-failed': 'error', 'job-done': 'check' };
  const tone = (n) => (n.level === 'error' ? 'err' : n.level === 'warn' ? 'warn' : n.level === 'ok' || n.type === 'job-done' ? 'ok' : 'info');

  function click(n) {
    open = false;
    if (n.path) openFile(n.path);
    else if (n.type?.startsWith('job')) navigate('settings', { tab: 'jobs' });
  }
</script>

<div class="bell-wrap">
  <button class="btn icon ghost" onclick={toggle} aria-label="Notifications" aria-expanded={open} title="Notifications">
    <Icon name="bell" size={17} />
    {#if app.unread}<span class="dotn tnum">{app.unread > 9 ? '9+' : app.unread}</span>{/if}
  </button>
  {#if open}
    <div class="nb-bg" onpointerdown={() => (open = false)} aria-hidden="true"></div>
    <div class="nb card" transition:scale={{ start: 0.96, duration: dur(130) }} role="dialog" aria-label="Notifications">
      <div class="nh">
        <b>Notifications</b>
        <span class="spacer"></span>
        {#if app.notifications.length}<button class="btn sm ghost" onclick={() => (app.notifications = [])}>Clear</button>{/if}
      </div>
      <div class="nl">
        {#each app.notifications as n (n.id)}
          <button class="ni" onclick={() => click(n)}>
            <span class="nic {tone(n)}"><Icon name={ICON[n.type] || 'bell'} size={13} /></span>
            <span class="col grow" style="gap:1px">
              <span class="nt">{n.title}</span>
              {#if n.body}<span class="faint nbdy">{n.body}</span>{/if}
              <span class="faint ntime">{timeAgo(n.ts, app.now)}{n.path ? ` · ${n.path}` : ''}</span>
            </span>
          </button>
        {:else}
          <div class="empty-n">
            <Icon name="bell" size={20} />
            <span>You're all caught up</span>
            <span class="faint small">Secrets, conflicts, health drops and job results show up here.</span>
          </div>
        {/each}
      </div>
      <label class="nf">
        <input type="checkbox" class="sw" checked={browser} disabled={!supported} onchange={(e) => setBrowser(e.currentTarget.checked)} />
        <span class="grow">Browser notifications when this tab is hidden</span>
      </label>
    </div>
  {/if}
</div>

<style>
  .bell-wrap { position: relative; }
  .dotn {
    position: absolute;
    top: 3px;
    right: 2px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 99px;
    background: var(--err);
    color: white;
    font-size: 9.5px;
    font-weight: 700;
    display: grid;
    place-items: center;
    box-shadow: 0 0 0 2px var(--bg);
  }
  .nb-bg { position: fixed; inset: 0; z-index: 70; }
  .nb {
    position: absolute;
    z-index: 71;
    right: 0;
    top: 42px;
    width: min(380px, calc(100vw - 24px));
    background: var(--panel-solid);
    box-shadow: var(--shadow-lg);
    transform-origin: top right;
    overflow: hidden;
  }
  .nh { display: flex; align-items: center; padding: 12px 12px 8px 16px; font-size: 13.5px; }
  .nl { max-height: 380px; overflow: auto; padding: 0 6px 6px; }
  .ni { display: flex; gap: 11px; width: 100%; padding: 9px 10px; border: 0; background: transparent; border-radius: 10px; cursor: pointer; text-align: left; }
  .ni:hover { background: var(--panel-hover); }
  .nic { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; flex-shrink: 0; }
  .nic.err { background: var(--err-soft); color: var(--err); }
  .nic.warn { background: var(--warn-soft); color: var(--warn); }
  .nic.ok { background: var(--ok-soft); color: var(--ok); }
  .nic.info { background: var(--info-soft); color: var(--info); }
  .nt { font-size: 13px; font-weight: 550; }
  .nbdy { font-size: 12px; }
  .ntime { font-size: 11px; }
  .empty-n { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 28px 16px; color: var(--text-2); text-align: center; font-size: 13px; }
  .small { font-size: 12px; }
  .nf { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-top: 1px solid var(--border); font-size: 12px; color: var(--text-2); background: var(--inset); cursor: pointer; }
</style>
