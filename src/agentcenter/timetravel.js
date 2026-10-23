import { effectiveContext } from '../analysis/context.js';
import { estimateTokens } from '../core/tokens.js';
import { lineDiff } from '../core/diff.js';

/** Files + contents as they were at `ts` (history versions <= ts; no history -> current). */
function snapshotAt(store, ts) {
  const files = [];
  const contents = new Map();
  for (const [p, entry] of store.files) {
    let content = store.contents.get(p);
    let hist = [];
    try { hist = store.history.list(p); } catch { /* none */ }
    if (hist.length) {
      const v = hist.find((h) => h.ts <= ts); // newest first
      if (!v) continue; // file did not exist yet
      const c = store.history.get(p, v.id);
      if (typeof c === 'string') content = c;
    }
    if (typeof content !== 'string') continue;
    contents.set(p, content);
    files.push({ ...entry, tokens: estimateTokens(content) });
  }
  return { files, contents };
}

export function contextAt(store, dir, tool, ts) {
  const at = Number(ts) || Date.now();
  const { files, contents } = snapshotAt(store, at);
  return { ...effectiveContext(dir, files, contents, tool), ts: at };
}

export function contextDiff(store, dir, tool, fromTs, toTs) {
  const from = contextAt(store, dir, tool, fromTs);
  const to = contextAt(store, dir, tool, toTs);
  const a = new Set(from.chain.map((c) => c.path)), b = new Set(to.chain.map((c) => c.path));
  const brief = (c) => ({ ts: c.ts, tokens: c.tokens, chain: c.chain });
  return {
    from: brief(from), to: brief(to),
    filesAdded: [...b].filter((p) => !a.has(p)), filesRemoved: [...a].filter((p) => !b.has(p)),
    tokenDelta: to.tokens - from.tokens,
    diff: lineDiff(from.text, to.text),
  };
}
