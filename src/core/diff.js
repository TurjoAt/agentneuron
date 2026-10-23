const MAX_LINES = 20000;
const MAX_D = 1500;

function splitLines(t) {
  if (!t) return [];
  const l = t.split('\n');
  if (l[l.length - 1] === '') l.pop();
  return l;
}

/** Myers shortest-edit-script. Returns array of ['=',i,j] / ['-',i] / ['+',j] or null if over maxD. */
function myers(a, b) {
  const n = a.length, m = b.length;
  const cap = Math.min(n + m, MAX_D);
  const off = cap + 1;
  let v = new Int32Array(2 * cap + 3);
  const trace = [];
  let found = -1;
  for (let d = 0; d <= cap && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[k - 1 + off] < v[k + 1 + off])) x = v[k + 1 + off];
      else x = v[k - 1 + off] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[k + off] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
  }
  if (found < 0) return null;
  const ops = [];
  let x = n, y = m;
  for (let d = found; d > 0; d--) {
    const vv = trace[d];
    const k = x - y;
    const prevK = (k === -d || (k !== d && vv[k - 1 + off] < vv[k + 1 + off])) ? k + 1 : k - 1;
    const prevX = vv[prevK + off];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push(['=', x - 1, y - 1]); x--; y--; }
    if (x === prevX) { ops.push(['+', y - 1]); y--; } else { ops.push(['-', x - 1]); x--; }
  }
  while (x > 0 && y > 0) { ops.push(['=', x - 1, y - 1]); x--; y--; }
  return ops.reverse();
}

/**
 * Line diff. hunks is a flat, ordered list of every line:
 *  ctx/add: `line` is the 1-based line in the new text; del: 1-based line in the old text.
 * Falls back to "replace the changed middle" for huge/very different inputs.
 */
export function lineDiff(oldText, newText) {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);

  const hunks = [];
  for (let i = 0; i < pre; i++) hunks.push({ type: 'ctx', line: i + 1, text: a[i] });

  let ops = null;
  if (am.length && bm.length && am.length + bm.length <= MAX_LINES) ops = myers(am, bm);
  if (!ops) {
    ops = [];
    for (let i = 0; i < am.length; i++) ops.push(['-', i]);
    for (let j = 0; j < bm.length; j++) ops.push(['+', j]);
  }
  let added = 0, removed = 0;
  for (const op of ops) {
    if (op[0] === '=') hunks.push({ type: 'ctx', line: pre + op[2] + 1, text: bm[op[2]] });
    else if (op[0] === '-') { removed++; hunks.push({ type: 'del', line: pre + op[1] + 1, text: am[op[1]] }); }
    else { added++; hunks.push({ type: 'add', line: pre + op[1] + 1, text: bm[op[1]] }); }
  }
  for (let i = 0; i < suf; i++) {
    hunks.push({ type: 'ctx', line: b.length - suf + i + 1, text: b[b.length - suf + i] });
  }
  return { added, removed, hunks };
}
