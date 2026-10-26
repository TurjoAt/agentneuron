<!-- The AgentNeuron mark at the centre of the boot visual. ui/index.html (#splash) draws the same mark at the same spot. -->
<div class="bmark" aria-hidden="true">
  <svg viewBox="0 0 32 32" width="56" height="56">
    <defs>
      <linearGradient id="bm-g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ff8a4c" />
        <stop offset="0.55" stop-color="#c07bff" />
        <stop offset="1" stop-color="#4f8dff" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="9" fill="url(#bm-g)" />
    <path d="M8 22V10l4 5 4-5v12M20 10v8m0 0-3-3m3 3 3-3M19 22h6" stroke="white" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</div>

<style>
  .bmark {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 56px;
    height: 56px;
    margin: -28px 0 0 -28px;
    border-radius: 16px;
    box-shadow: 0 12px 40px -8px rgba(192, 123, 255, 0.55);
    animation: bm-breathe 2.4s ease-in-out infinite alternate;
  }
  .bmark svg { display: block; }
  @keyframes bm-breathe { from { transform: scale(0.97); } to { transform: scale(1.03); } }
</style>
