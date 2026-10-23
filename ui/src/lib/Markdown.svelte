<script>
  import { renderMarkdown } from './markdown.js';
  import { fileIndex } from './store.svelte.js';
  import { tick } from 'svelte';

  let { source = '', path = '', line = null, anchor = null } = $props();
  let el = $state();

  const html = $derived.by(() => {
    const idx = fileIndex();
    return renderMarkdown(source, {
      path,
      exists: (p) => idx.set.has(p),
      byBasename: (n) => idx.byBase.get(n.toLowerCase().replace(/\.md$/, '')) || null,
    });
  });

  function flash(node) {
    if (!node) return;
    node.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    node.classList.remove('md-target');
    void node.offsetWidth;
    node.classList.add('md-target');
  }

  // jump to a source line (nearest block at or before it) or anchor
  $effect(() => {
    void html;
    const l = Number(line);
    const a = anchor;
    if (!el || (!l && !a)) return;
    tick().then(() => {
      if (a) return flash(el.querySelector(`[id="${CSS.escape(a)}"]`));
      let best = null;
      let bestLine = -1;
      for (const n of el.querySelectorAll('[data-line]')) {
        const nl = +n.dataset.line;
        if (nl <= l && nl >= bestLine) {
          best = n;
          bestLine = nl;
        }
      }
      flash(best);
    });
  });

  function onclick(e) {
    const a = e.target.closest?.('a');
    if (!a || !el.contains(a)) return;
    if (a.classList.contains('md-anchor')) {
      e.preventDefault();
      flash(el.querySelector(`[id="${CSS.escape(a.dataset.anchor)}"]`));
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<article class="md" bind:this={el} {onclick}>{@html html}</article>
