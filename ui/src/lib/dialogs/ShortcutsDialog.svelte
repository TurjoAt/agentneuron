<script>
  import Modal from '../Modal.svelte';
  import { VIEWS } from '../nav.js';
  let { onclose } = $props();
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const M = mac ? '⌘' : 'Ctrl';
  const groups = [
    ['General', [[[M, 'K'], 'Command palette — files, content, actions'], [['/'], 'Search'], [[M, '⇧', 'F'], 'Find & replace across files'], [[M, 'J'], 'Toggle jobs dock'], [['?'], 'This help'], [['Esc'], 'Close panel / dialog']]],
    ['Navigation', [[['Alt', '←'], 'Back'], [['Alt', '→'], 'Forward'], [['1'], `…${VIEWS.length > 9 ? '9' : VIEWS.length}  Jump to view`], [['0'], 'Settings'], [['n'], 'New file']]],
    ['Editor', [[[M, 'S'], 'Save'], [[M, 'Click'], 'Follow link under cursor'], [[M, 'F'], 'Find in file'], [[M, 'Z'], 'Undo']]],
    ['Tasks board', [[['Drag'], 'Move card between columns'], [['Enter'], 'Open focused card'], [['c'], 'New card']]],
  ];
</script>

<Modal title="Keyboard shortcuts" icon="command" width={620} {onclose}>
  <div class="grid">
    {#each groups as [title, rows] (title)}
      <section>
        <div class="eyebrow">{title}</div>
        {#each rows as [keys, label] (label)}
          <div class="r">
            <span class="ks">{#each keys as k (k)}<span class="kbd">{k}</span>{/each}</span>
            <span class="muted">{label}</span>
          </div>
        {/each}
      </section>
    {/each}
  </div>
</Modal>

<style>
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px 28px; padding-bottom: 6px; }
  section { display: flex; flex-direction: column; gap: 8px; }
  .r { display: flex; align-items: center; gap: 12px; font-size: 13px; }
  .ks { display: inline-flex; gap: 3px; min-width: 92px; }
  @media (max-width: 560px) { .grid { grid-template-columns: 1fr; } }
</style>
