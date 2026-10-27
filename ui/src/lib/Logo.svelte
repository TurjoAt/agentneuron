<script>
  // The AgentNeuron mark: an "A" drawn as a tiny neural network (a soma at the apex, two axons down to
  // terminal neurons, an arched synapse as the crossbar) on the brand gradient. Same geometry as docs/assets/logo.svg
  // and the favicon in ui/index.html; keep them in sync.
  let { size = 32, pulse = false, title = '' } = $props();
  const uid = `lg${Math.random().toString(36).slice(2, 8)}`;
</script>

<svg class="logo" class:pulse viewBox="0 0 32 32" width={size} height={size} role={title ? 'img' : undefined} aria-hidden={title ? undefined : 'true'} aria-label={title || undefined}>
  <defs>
    <linearGradient id="{uid}-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff8a4c" />
      <stop offset="0.5" stop-color="#b86bff" />
      <stop offset="1" stop-color="#4f7dff" />
    </linearGradient>
    <radialGradient id="{uid}-hl" cx="0.3" cy="0.2" r="0.9">
      <stop offset="0" stop-color="#fff" stop-opacity="0.32" />
      <stop offset="0.6" stop-color="#fff" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="32" height="32" rx="9" fill="url(#{uid}-bg)" />
  <rect width="32" height="32" rx="9" fill="url(#{uid}-hl)" />
  <g stroke="#fff" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M9 25 16 7l7 18" stroke-width="2.3" />
    <path class="sig" d="M12 17.3c2.6-1.6 5.4-1.6 8 0" stroke-width="2" />
  </g>
  <g fill="#fff">
    <circle cx="16" cy="7" r="3" />
    <circle cx="9" cy="25" r="2.3" />
    <circle cx="23" cy="25" r="2.3" />
  </g>
  <circle class="core" cx="16" cy="7" r="1.2" fill="url(#{uid}-bg)" />
</svg>

<style>
  .logo { display: block; flex-shrink: 0; }
  .pulse .core { animation: lg-fire 2.2s ease-in-out infinite; transform-origin: 16px 7px; }
  .pulse .sig { stroke-dasharray: 3 2.5; animation: lg-flow 1.4s linear infinite; }
  @keyframes lg-fire { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.7); } }
  @keyframes lg-flow { to { stroke-dashoffset: -11; } }
  @media (prefers-reduced-motion: reduce) { .pulse .core, .pulse .sig { animation: none; } }
</style>
