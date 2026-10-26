<script>
  // First-load boot screen. Shows the real steps of boot() (store.svelte.js → bootProgress) as they happen.
  // The visual pace can lag reality slightly so a fast load still reads as a sequence, but it never holds
  // the dashboard more than ~600 ms after data is ready. Esc / click skips once ready.
  import { onMount } from 'svelte';
  import { bootProgress } from '../store.svelte.js';
  import { prefersReducedMotion } from 'svelte/motion';
  import NeuralNet from './NeuralNet.svelte';
  import Mark from './Mark.svelte';

  /** onexit: called when the overlay has finished leaving; ready: data is loaded and the shell can show */
  let { ready = false, onexit } = $props();

  const KEY = 'agentneuron.booted';
  let first = true;
  try {
    first = !localStorage.getItem(KEY);
  } catch {
    /* storage unavailable: treat as first visit */
  }
  const still = prefersReducedMotion.current;
  // pacing: min time each step stays "running" on screen; hold after the last step
  const DWELL = still ? 0 : first ? 170 : 45;
  const CAP = first ? 560 : 260; // max ms between data ready and the overlay being gone
  const EXIT_MS = still ? 0 : first ? 260 : 180;

  let shown = $state(0); // how many steps have been revealed as finished
  let leaving = $state(false);
  let lastAdvance = 0;
  const real = $derived(bootProgress.steps);
  const settled = (s) => s.status === 'done' || s.status === 'failed';

  const display = $derived(
    real.map((s, i) => ({
      ...s,
      status: i < shown || s.status === 'pending' ? s.status : 'running',
    })),
  );
  const progress = $derived.by(() => {
    const n = display.length;
    let v = 0;
    for (const s of display) v += settled(s) ? 1 : s.status === 'running' ? 0.4 : 0;
    return Math.min(1, v / n);
  });
  const allShown = $derived(shown >= real.length);
  const current = $derived(display.find((s) => s.status === 'running') || display[Math.max(0, shown - 1)]);
  const demoFallback = $derived(real[0]?.status === 'failed' && bootProgress.outcome !== 'fatal');

  // advance the reveal cursor (driven by real progress; DWELL only spaces out reveals that already happened)
  let timer;
  function pump() {
    clearTimeout(timer);
    if (shown >= real.length) return;
    const s = real[shown];
    if (!settled(s)) return; // wait for reality
    const now = performance.now();
    let dwell = DWELL;
    if (ready && bootProgress.readyAt) {
      // compress so everything is revealed within the cap
      const left = Math.max(1, real.length - shown);
      const budget = Math.max(0, CAP - EXIT_MS - 90 - (Date.now() - bootProgress.readyAt));
      dwell = Math.min(DWELL, budget / left);
    }
    const wait = lastAdvance + dwell - now;
    if (wait > 0) {
      timer = setTimeout(pump, wait);
      return;
    }
    lastAdvance = now;
    shown++;
    timer = setTimeout(pump, 0);
  }
  $effect(() => {
    // re-run whenever any real status changes
    void real.map((s) => s.status).join();
    void ready;
    pump();
  });

  // leave when everything is revealed (+ short hold) or at the hard cap, whichever is first
  let exitTimer, capTimer;
  $effect(() => {
    if (!ready) return;
    clearTimeout(capTimer);
    capTimer = setTimeout(exit, Math.max(0, CAP - EXIT_MS));
    return () => clearTimeout(capTimer);
  });
  $effect(() => {
    if (!ready || !allShown) return;
    clearTimeout(exitTimer);
    exitTimer = setTimeout(exit, still ? 0 : first ? 90 : 20);
    return () => clearTimeout(exitTimer);
  });

  function exit() {
    if (leaving) return;
    leaving = true;
    shown = real.length;
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* ignore */
    }
    setTimeout(() => onexit?.(), EXIT_MS);
  }
  function skip() {
    if (ready) exit();
  }

  // typed log line (the latest real log entry)
  let typed = $state('');
  const latest = $derived(bootProgress.log[bootProgress.log.length - 1]?.line || '');
  $effect(() => {
    const line = latest;
    if (still || !line) {
      typed = line;
      return;
    }
    let i = 0;
    let raf = 0;
    let t0 = 0;
    const step = (t) => {
      if (!t0) t0 = t;
      i = Math.min(line.length, Math.floor((t - t0) / 9));
      typed = line.slice(0, i);
      if (i < line.length) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  });

  // a11y announcements: one line per finished step
  const announce = $derived(display.filter((s, i) => i < shown).map((s) => `${s.label}: ${s.status === 'failed' ? 'failed' : 'done'}${s.detail ? `. ${s.detail}` : ''}`).slice(-1)[0] || 'Loading AgentNeuron');

  onMount(() => {
    // hand over from the pre-JS splash (same mark, same position)
    const sp = document.getElementById('splash');
    if (sp) {
      sp.classList.add('out');
      setTimeout(() => sp.remove(), 320);
    }
    return () => {
      clearTimeout(timer);
      clearTimeout(exitTimer);
      clearTimeout(capTimer);
    };
  });
  const fmtT = (ms) => `${(ms / 1000).toFixed(2)}s`;
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && skip()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="boot" class:leaving class:first class:still style="--exit:{EXIT_MS}ms" onclick={skip} aria-busy={!ready}>
  <div class="viz">
    <NeuralNet steps={display} finished={allShown && ready} {still} />
    <Mark />
  </div>
  <div class="title">
    <h1>AgentNeuron</h1>
    <p class="sub">{demoFallback ? 'Server unreachable · loading demo workspace' : 'Waking up your context'}</p>
  </div>

  <div class="panel">
    <div class="bar" role="progressbar" aria-label="Loading" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress * 100)}>
      <span style="transform:scaleX({progress})"></span>
    </div>
    <ol class="steps">
      {#each display as s, i (s.id)}
        <li class="st {s.status}" style="--i:{i}">
          <span class="ic" aria-hidden="true">
            {#if s.status === 'done'}<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
            {:else if s.status === 'failed'}<svg viewBox="0 0 24 24"><path d="M12 8v5M12 17h.01" /></svg>
            {:else if s.status === 'running'}<span class="spin"></span>
            {:else}<span class="dot"></span>{/if}
          </span>
          <span class="lbl">{s.label}</span>
          {#if s.detail && s.status !== 'pending'}<span class="det ellipsis" title={s.detail}>{s.detail}</span>{/if}
        </li>
      {/each}
    </ol>
    <div class="log mono" aria-hidden="true">
      <span class="pr">›</span>
      {#if bootProgress.log.length}<span class="t faint">{fmtT(bootProgress.log[bootProgress.log.length - 1].t)}</span>{/if}
      <span class="ln ellipsis">{typed}</span><span class="caret"></span>
    </div>
    <div class="hint faint" class:on={ready}>{ready ? 'Press Esc or click to skip' : ' '}</div>
  </div>
  <div class="sr-only" aria-live="polite" role="status">{announce}</div>
</div>

<style>
  .boot {
    --vs: 260px;
    --vy: clamp(150px, 31vh, 290px);
    position: fixed;
    inset: 0;
    z-index: 200;
    background: var(--bg);
    color: var(--text);
    overflow: hidden;
    cursor: default;
    transition: opacity var(--exit) var(--ease), transform var(--exit) var(--ease), filter var(--exit) var(--ease);
  }
  .boot::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(60vmax 40vmax at 50% var(--vy), var(--aurora-1), transparent 70%),
      radial-gradient(40vmax 30vmax at 90% 100%, var(--aurora-2), transparent 70%);
  }
  .boot.leaving { opacity: 0; transform: scale(1.04); filter: blur(4px); pointer-events: none; }
  .still.leaving { transform: none; filter: none; }

  .viz {
    position: absolute;
    left: 50%;
    top: var(--vy);
    width: var(--vs);
    height: var(--vs);
    transform: translate(-50%, -50%);
    perspective: 600px;
  }
  .title {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(var(--vy) + var(--vs) / 2 + 6px);
    text-align: center;
    padding: 0 16px;
  }
  h1 { margin: 0; font-size: 20px; font-weight: 680; letter-spacing: -0.02em; line-height: 28px; }
  .sub { margin: 2px 0 0; color: var(--text-2); font-size: 13px; line-height: 20px; }

  .panel {
    position: absolute;
    left: 50%;
    top: calc(var(--vy) + var(--vs) / 2 + 70px);
    width: min(440px, calc(100vw - 32px));
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 10px;
    animation: panel-in 0.5s var(--ease) both;
  }
  .bar { height: 3px; border-radius: 3px; background: var(--panel-active); overflow: hidden; }
  .bar span {
    display: block;
    height: 100%;
    transform-origin: 0 50%;
    background: linear-gradient(90deg, var(--accent-2), var(--accent) 55%, var(--info));
    transition: transform 0.45s var(--ease);
    box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 60%, transparent);
  }
  .steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .st {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 26px;
    font-size: 13px;
    color: var(--text-3);
    min-width: 0;
    transition: color 0.25s;
  }
  .first .st { animation: row-in 0.4s var(--ease) both; animation-delay: calc(var(--i) * 40ms); }
  .st.running { color: var(--text); }
  .st.done { color: var(--text-2); }
  .st.failed { color: var(--warn); }
  .lbl { flex-shrink: 0; font-weight: 550; }
  .det { flex: 1; text-align: right; font-size: 12px; color: var(--text-3); font-family: var(--mono); }
  .ic { width: 16px; height: 16px; display: grid; place-items: center; flex-shrink: 0; }
  .ic svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
  .done .ic { color: var(--ok); }
  .done .ic svg { animation: pop 0.35s var(--ease-spring); }
  .dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; opacity: 0.5; }
  .spin { width: 12px; height: 12px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--accent) 25%, transparent); border-top-color: var(--accent); animation: spin 0.7s linear infinite; }

  .log {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--inset);
    font-size: 11.5px;
    color: var(--text-2);
    min-width: 0;
    position: relative;
    overflow: hidden;
  }
  .log::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 10%, transparent), transparent);
    transform: translateX(-100%);
    animation: scan 1.8s var(--ease) infinite;
    pointer-events: none;
  }
  .pr { color: var(--accent); font-weight: 700; }
  .t { flex-shrink: 0; }
  .ln { flex: 0 1 auto; }
  .caret { width: 6px; height: 13px; background: var(--accent); flex-shrink: 0; animation: blink 1s steps(1) infinite; }
  .hint { text-align: center; font-size: 11.5px; height: 16px; opacity: 0; transition: opacity 0.3s; }
  .hint.on { opacity: 1; }

  .still .log::after, .still .caret { animation: none; }
  .still .panel, .still .st { animation: none; }

  @media (max-width: 600px), (max-height: 700px) {
    .boot { --vs: 210px; --vy: clamp(130px, 28vh, 240px); }
    .det { max-width: 52%; }
  }
  @media (max-height: 560px) {
    .boot { --vs: 150px; --vy: 100px; }
    .steps { display: none; }
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes blink { 50% { opacity: 0; } }
  @keyframes scan { to { transform: translateX(100%); } }
  @keyframes pop { from { transform: scale(0.4); } to { transform: scale(1); } }
  @keyframes row-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  @keyframes panel-in { from { opacity: 0; transform: translate(-50%, 6px); } to { opacity: 1; transform: translateX(-50%); } }
</style>
