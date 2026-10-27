<script>
  import Logo from '../Logo.svelte';
</script>

<!-- The AgentNeuron mark at the centre of the boot visual. ui/index.html (#splash) draws the same mark at the same spot. -->
<div class="bmark" aria-hidden="true">
  <Logo size={56} pulse />
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
