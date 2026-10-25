import { effectiveContext } from '../analysis/context.js';
import { estimateTokens } from '../core/tokens.js';
import { lineDiff } from '../core/diff.js';

/**
 * Files + contents as they were at `ts` (history versions <= ts; no history -> current).
 * opts.fallback: Map path -> { content, source, commit, ts } | { absent: true } used when history has no version <= ts (e.g. from git).
 * Returns versions too: path -> { source: 'history'|'git'|'current', id?, ts?, commit? }.
 */
export function snapshotAt(store, ts, { fallback = null } = {}) {
  const files = [];
  const contents = new Map();
  const versions = new Map();
  for (const [p, entry] of store.files) {
    let content = store.contents.get(p);
    let ver = { source: 'current' };
    let hist = [];
    try { hist = store.history.list(p); } catch { /* none */ }
    const fb = fallback?.get(p);
    if (hist.length) {
      const v = hist.find((h) => h.ts <= ts); // newest first
      if (v) {
        const c = store.history.get(p, v.id);
        if (typeof c === 'string') { content = c; ver = { source: 'history', id: v.id, ts: v.ts }; }
      } else if (fb && !fb.absent) { content = fb.content; ver = { source: fb.source || 'git', commit: fb.commit, ts: fb.ts }; } else continue; // file did not exist yet
    } else if (fb?.absent) continue;
    else if (fb) { content = fb.content; ver = { source: fb.source || 'git', commit: fb.commit, ts: fb.ts }; }
    if (typeof content !== 'string') continue;
    contents.set(p, content);
    versions.set(p, ver);
    files.push({ ...entry, tokens: estimateTokens(content) });
  }
  return { files, contents, versions };
}

export function contextAt(store, dir, tool, ts, opts = {}) {
  const at = Number(ts) || Date.now();
  const { files, contents, versions } = snapshotAt(store, at, opts);
  const r = effectiveContext(dir, files, contents, tool);
  if (opts.fallback) r.chain = r.chain.map((c) => ({ ...c, version: versions.get(c.path) || null }));
  return { ...r, ts: at };
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
