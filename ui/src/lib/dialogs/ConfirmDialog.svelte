<script>
  import Modal from '../Modal.svelte';
  import Icon from '../Icon.svelte';
  let { title = 'Are you sure?', body = '', icon = 'alert', tone = '', cta = 'Confirm', run, onclose } = $props();
  let busy = $state(false);
  async function go() {
    busy = true;
    try {
      await run?.();
    } finally {
      busy = false;
      onclose?.();
    }
  }
</script>

<Modal {title} {icon} {tone} width={440} {onclose}>
  <p class="cb">{body}</p>
  {#snippet footer()}
    <span class="spacer"></span>
    <button class="btn" onclick={onclose}>Cancel</button>
    <button class="btn {tone === 'danger' ? 'danger' : 'primary'}" onclick={go} disabled={busy} data-autofocus>
      <Icon name={icon} size={13} />{cta}
    </button>
  {/snippet}
</Modal>

<style>
  .cb { margin: 0; color: var(--text-2); font-size: 13.5px; line-height: 1.6; word-break: break-word; }
</style>
