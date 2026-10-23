// Commit-graph lane layout from parent hashes (newest first).
export function layoutGraph(commits) {
  let lanes = [];
  const rows = [];
  let max = 1;
  for (const c of commits) {
    const before = lanes.slice();
    let col = before.indexOf(c.hash);
    const next = before.map((h) => (h === c.hash ? null : h));
    if (col === -1) {
      col = next.indexOf(null);
      if (col === -1) { col = next.length; next.push(null); }
    }
    const parents = c.parents || [];
    const targets = []; // lane index per parent
    parents.forEach((p, i) => {
      let j = next.indexOf(p);
      if (j === -1) {
        if (i === 0 && next[col] == null) j = col;
        else { j = next.indexOf(null); if (j === -1) { j = next.length; next.push(null); } }
        next[j] = p;
      }
      targets.push(j);
    });
    while (next.length && next[next.length - 1] == null) next.pop();
    rows.push({ hash: c.hash, col, before, after: next.slice(), targets, merge: parents.length > 1 });
    max = Math.max(max, before.length, next.length, col + 1);
    lanes = next;
  }
  return { rows, lanes: max };
}
