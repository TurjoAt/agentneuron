// Client-side line diff + simple two-way merge (used by the editor conflict
// dialog). Output format matches DiffView: { added, removed, hunks: [{ type:
// 'ctx'|'add'|'del', line, text }] } where `line` is the new-file line for
// add/ctx and the old-file line for del.

const MAX_CELLS = 4_000_000;

/** Line diff a → b. Trims common prefix/suffix, LCS in between. */
export function lineDiff(a, b) {
  const A = String(a ?? '').split('\n');
  const B = String(b ?? '').split('\n');
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const a2 = A.slice(pre, A.length - suf);
  const b2 = B.slice(pre, B.length - suf);
  const hunks = [];
  for (let k = 0; k < pre; k++) hunks.push({ type: 'ctx', line: k + 1, text: B[k] });
  let added = 0;
  let removed = 0;
  const n = a2.length;
  const m = b2.length;
  if (n * m > MAX_CELLS) {
    // too big for LCS: replace block
    for (let i = 0; i < n; i++) hunks.push({ type: 'del', line: pre + i + 1, text: a2[i] });
    for (let j = 0; j < m; j++) hunks.push({ type: 'add', line: pre + j + 1, text: b2[j] });
    removed = n;
    added = m;
  } else {
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) dp[i][j] = a2[i] === b2[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a2[i] === b2[j]) {
        hunks.push({ type: 'ctx', line: pre + j + 1, text: b2[j] });
        i++;
        j++;
      } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
        hunks.push({ type: 'add', line: pre + j + 1, text: b2[j] });
        j++;
        added++;
      } else {
        hunks.push({ type: 'del', line: pre + i + 1, text: a2[i] });
        i++;
        removed++;
      }
    }
  }
  for (let k = 0; k < suf; k++) {
    const bi = B.length - suf + k;
    hunks.push({ type: 'ctx', line: bi + 1, text: B[bi] });
  }
  return { added, removed, hunks };
}

/**
 * Group a diff into change blocks for interactive merging.
 * Returns segments: { kind: 'same', lines } | { kind: 'change', id, mine: [], theirs: [] }
 * where `mine` = lines only in a (yours), `theirs` = lines only in b (disk).
 */
export function changeBlocks(mine, theirs) {
  const { hunks } = lineDiff(mine, theirs);
  const out = [];
  let cur = null;
  let id = 0;
  for (const h of hunks) {
    if (h.type === 'ctx') {
      if (cur?.kind !== 'same') out.push((cur = { kind: 'same', lines: [] }));
      cur.lines.push(h.text);
    } else {
      if (cur?.kind !== 'change') out.push((cur = { kind: 'change', id: id++, mine: [], theirs: [] }));
      (h.type === 'del' ? cur.mine : cur.theirs).push(h.text);
    }
  }
  return out;
}

/** Build merged text from blocks + per-block choice ('mine'|'theirs'|'both'|'markers'). */
export function mergeBlocks(blocks, choice = {}) {
  const lines = [];
  for (const b of blocks) {
    if (b.kind === 'same') lines.push(...b.lines);
    else {
      const c = choice[b.id] || 'markers';
      if (c === 'mine') lines.push(...b.mine);
      else if (c === 'theirs') lines.push(...b.theirs);
      else if (c === 'both') lines.push(...b.mine, ...b.theirs);
      else lines.push('<<<<<<< yours', ...b.mine, '=======', ...b.theirs, '>>>>>>> disk');
    }
  }
  return lines.join('\n');
}

/** Parse a unified git patch into files → hunks (for PatchView). */
export function parsePatch(patch) {
  const files = [];
  let f = null;
  let h = null;
  let o = 0;
  let n = 0;
  for (const line of String(patch || '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      f = { from: m?.[1] || '', path: m?.[2] || line.slice(11), hunks: [], meta: [], added: 0, removed: 0, binary: false };
      files.push(f);
      h = null;
      continue;
    }
    if (!f) {
      if (line.startsWith('@@')) {
        f = { from: '', path: '', hunks: [], meta: [], added: 0, removed: 0, binary: false };
        files.push(f);
      } else continue;
    }
    const hm = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (hm) {
      o = +hm[1];
      n = +hm[2];
      h = { header: line, section: hm[3].trim(), lines: [] };
      f.hunks.push(h);
      continue;
    }
    if (!h) {
      if (/^Binary files/.test(line)) f.binary = true;
      if (!/^(---|\+\+\+|index )/.test(line) && line) f.meta.push(line);
      continue;
    }
    if (line.startsWith('+')) {
      h.lines.push({ t: 'add', o: null, n: n++, text: line.slice(1) });
      f.added++;
    } else if (line.startsWith('-')) {
      h.lines.push({ t: 'del', o: o++, n: null, text: line.slice(1) });
      f.removed++;
    } else if (line.startsWith('\\')) {
      h.lines.push({ t: 'note', o: null, n: null, text: line });
    } else if (line.startsWith(' ') || line === '') {
      h.lines.push({ t: 'ctx', o: o++, n: n++, text: line.slice(1) });
    }
  }
  // drop trailing empty ctx line produced by final newline
  for (const file of files) {
    const last = file.hunks[file.hunks.length - 1];
    const ll = last?.lines[last.lines.length - 1];
    if (ll && ll.t === 'ctx' && ll.text === '') last.lines.pop();
  }
  return files;
}
