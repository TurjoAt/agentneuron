<script>
  // Unified diff renderer. Collapses long unchanged runs (expandable).
  let { hunks = [], context = 3 } = $props();

  let expanded = $state(new Set());

  const rows = $derived.by(() => {
    const out = [];
    // `line` = new-file line for add/ctx, old-file line for del (falls back to counting)
    let oldN = 0;
    let newN = 0;
    let delta = 0; // adds − dels so far
    const lines = hunks.map((h) => {
      const ln = Number.isFinite(h.line) && h.line > 0 ? h.line : null;
      if (h.type === 'del') {
        oldN = ln ?? oldN + 1;
        delta--;
        return { ...h, o: oldN, n: null };
      }
      newN = ln ?? newN + 1;
      if (h.type === 'add') {
        delta++;
        return { ...h, o: null, n: newN };
      }
      oldN = newN - delta;
      return { ...h, o: oldN, n: newN };
    });
    const changed = lines.map((l) => l.type !== 'ctx');
    const near = (i) => {
      for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) if (changed[k]) return true;
      return false;
    };
    let i = 0;
    while (i < lines.length) {
      if (lines[i].type === 'ctx' && !near(i)) {
        let j = i;
        while (j < lines.length && lines[j].type === 'ctx' && !near(j)) j++;
        const id = `${i}-${j}`;
        if (expanded.has(id) || j - i < 3) out.push(...lines.slice(i, j));
        else out.push({ type: 'gap', id, count: j - i });
        i = j;
      } else {
        out.push(lines[i]);
        i++;
      }
    }
    return out;
  });

  function expand(id) {
    expanded = new Set([...expanded, id]);
  }
</script>

<div class="diff mono" role="table" aria-label="Diff">
  {#each rows as r, k (r.type === 'gap' ? r.id : k)}
    {#if r.type === 'gap'}
      <button class="gap" onclick={() => expand(r.id)}>⋯ {r.count} unchanged lines</button>
    {:else}
      <div class="ln {r.type}" role="row">
        <span class="no">{r.o ?? ''}</span>
        <span class="no">{r.n ?? ''}</span>
        <span class="sg">{r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}</span>
        <span class="tx">{r.text || ' '}</span>
      </div>
    {/if}
  {:else}
    <div class="none">No differences.</div>
  {/each}
</div>

<style>
  .diff {
    font-size: 12.5px;
    line-height: 1.6;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: auto;
    background: var(--inset);
  }
  .ln {
    display: grid;
    grid-template-columns: 44px 44px 20px minmax(0, 1fr);
    min-width: max-content;
  }
  .no {
    color: var(--text-3);
    text-align: right;
    padding-right: 10px;
    user-select: none;
    font-size: 11px;
    border-right: 1px solid var(--border);
  }
  .sg {
    text-align: center;
    color: var(--text-3);
    user-select: none;
  }
  .tx {
    white-space: pre;
    padding-right: 16px;
  }
  .add {
    background: color-mix(in srgb, var(--ok) 11%, transparent);
  }
  .add .sg, .add .tx { color: color-mix(in srgb, var(--ok) 75%, var(--text)); }
  .del {
    background: color-mix(in srgb, var(--err) 11%, transparent);
  }
  .del .sg, .del .tx { color: color-mix(in srgb, var(--err) 75%, var(--text)); }
  .gap {
    display: block;
    width: 100%;
    border: 0;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    background: var(--panel-hover);
    color: var(--text-3);
    font: inherit;
    font-size: 11.5px;
    padding: 3px 0;
    cursor: pointer;
  }
  .gap:hover { color: var(--accent); background: var(--accent-soft); }
  .none { padding: 18px; color: var(--text-3); text-align: center; font-family: var(--font); }
</style>
