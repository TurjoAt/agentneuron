<script>
  import { app, login } from './store.svelte.js';
  import Icon from './Icon.svelte';

  let tok = $state('');
  let busy = $state(false);
  let show = $state(false);

  async function submit(e) {
    e.preventDefault();
    if (!tok.trim() || busy) return;
    busy = true;
    await login(tok.trim());
    busy = false;
  }
</script>

<div class="login">
  <form class="panel card" onsubmit={submit}>
    <div class="mark">
      <svg viewBox="0 0 32 32" width="44" height="44" aria-hidden="true">
        <defs>
          <linearGradient id="lg-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#ff8a4c" />
            <stop offset="0.55" stop-color="#c07bff" />
            <stop offset="1" stop-color="#4f8dff" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill="url(#lg-g)" />
        <path d="M8 22V10l4 5 4-5v12M20 10v8m0 0-3-3m3 3 3-3M19 22h6" stroke="white" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </div>
    <div class="col" style="gap:4px;text-align:center">
      <h1>Sign in to agentneuron</h1>
      <p class="muted">This server is protected. Paste the token printed in the terminal where <span class="mono">agentneuron</span> was started.</p>
    </div>
    <label class="fld">
      <span class="fl">Access token</span>
      <span class="inp">
        <Icon name="key" size={15} />
        <input
          class="input mono"
          type={show ? 'text' : 'password'}
          bind:value={tok}
          placeholder="••••••••••••••••"
          aria-label="Access token"
          autocomplete="current-password"
          spellcheck="false"
        />
        <button type="button" class="btn sm ghost icon" onclick={() => (show = !show)} aria-label={show ? 'Hide token' : 'Show token'}><Icon name="eye" size={14} /></button>
      </span>
    </label>
    {#if app.loginError}<div class="er"><Icon name="error" size={14} /> {app.loginError}</div>{/if}
    <button class="btn primary big" type="submit" disabled={!tok.trim() || busy}>
      {#if busy}<span class="spin"></span>{:else}<Icon name="unlock" size={15} />{/if}
      Unlock
    </button>
    <div class="hint faint">
      <Icon name="shield" size={13} />
      <span>The token becomes an HttpOnly session cookie — it is never kept in the URL. Viewer tokens get read-only access; the admin token unlocks actions that are enabled on the server.</span>
    </div>
  </form>
</div>

<style>
  .login { min-height: 100dvh; display: grid; place-items: center; padding: 16px; }
  .panel { width: min(420px, 100%); padding: 32px 28px 24px; display: flex; flex-direction: column; gap: 18px; background: var(--panel-solid); box-shadow: var(--shadow-lg); border-radius: 20px; animation: fade-up 0.5s var(--ease) both; }
  .mark { display: grid; place-items: center; filter: drop-shadow(0 10px 28px rgba(192, 123, 255, 0.45)); }
  h1 { margin: 0; font-size: 20px; letter-spacing: -0.02em; }
  p { margin: 0; font-size: 13px; line-height: 1.55; }
  .fld { display: flex; flex-direction: column; gap: 6px; }
  .fl { font-size: 12px; font-weight: 600; color: var(--text-2); }
  .inp { position: relative; display: flex; align-items: center; color: var(--text-3); }
  .inp > :global(.icon) { position: absolute; left: 11px; pointer-events: none; }
  .inp .input { width: 100%; height: 42px; padding-left: 34px; padding-right: 40px; font-size: 14px; }
  .inp .btn { position: absolute; right: 7px; }
  .er { display: flex; align-items: center; gap: 7px; color: var(--err); font-size: 12.5px; }
  .big { height: 42px; justify-content: center; font-size: 14px; font-weight: 600; }
  .hint { display: flex; gap: 8px; font-size: 11.5px; line-height: 1.5; }
  .hint :global(.icon) { flex-shrink: 0; margin-top: 2px; }
  .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.35); border-top-color: white; animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
