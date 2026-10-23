import { runGit, cleanRelPath, validRefName, validRev, US, RS, MAX_PATCH } from './run.js';

export { runGit, cleanRelPath, validRefName, validRev };

const CONFLICT = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

function unavailable(reason) { return { available: false, reason }; }

function explain(err) {
  const s = String(err || '');
  if (/dubious ownership/i.test(s)) return 'git refuses this repository ("dubious ownership"); run mdctl as the repository owner. mdctl does not change safe.directory.';
  if (/not a git repository/i.test(s)) return 'not a git repository';
  if (/ENOENT/.test(s)) return 'git not found or directory missing';
  return s.trim().split('\n')[0] || 'git unavailable';
}

export function parseRefs(d) {
  return String(d || '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function parseTrack(t) {
  const r = { ahead: 0, behind: 0, gone: false };
  if (!t) return r;
  if (/gone/.test(t)) r.gone = true;
  const a = /ahead (\d+)/.exec(t), b = /behind (\d+)/.exec(t);
  if (a) r.ahead = Number(a[1]);
  if (b) r.behind = Number(b[1]);
  return r;
}

/** Parse `-z` name-status output into [{status, path, from?}]. */
export function parseNameStatusZ(out) {
  const parts = out.split('\0');
  const res = [];
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i];
    if (!s) continue;
    const c = s[0];
    if (c === 'R' || c === 'C') { const from = parts[++i]; const p = parts[++i]; res.push({ status: c, path: p, from }); }
    else { res.push({ status: c, path: parts[++i] }); }
  }
  return res;
}

/** Parse `--numstat -z` output into Map(path -> {added, removed}). */
export function parseNumstatZ(out) {
  const m = new Map();
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i];
    if (!s) continue;
    const mm = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(s);
    if (!mm) continue;
    let p = mm[3];
    if (p === '') { i++; p = parts[++i]; } // rename: old, new follow
    m.set(p, { added: mm[1] === '-' ? 0 : Number(mm[1]), removed: mm[2] === '-' ? 0 : Number(mm[2]), binary: mm[1] === '-' });
  }
  return m;
}

export function parseHunks(patch) {
  const hunks = [];
  let cur = null;
  for (const line of patch.split('\n')) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
    if (m) {
      cur = { header: line, oldStart: +m[1], oldLines: m[2] === undefined ? 1 : +m[2], newStart: +m[3], newLines: m[4] === undefined ? 1 : +m[4], lines: [] };
      hunks.push(cur);
    } else if (cur && /^[ +\\-]/.test(line)) cur.lines.push(line);
    else if (cur && line.startsWith('diff ')) cur = null;
  }
  return hunks;
}

export function createGit2(root) {
  const g = (args, o) => runGit(root, args, o);
  let prefixCache = null;
  let failure = null; // last availability error

  async function probe() {
    const r = await g(['rev-parse', '--is-inside-work-tree', '--show-prefix'], { timeout: 6000 });
    if (!r.ok || r.out.split('\n')[0].trim() !== 'true') {
      failure = explain(r.err || 'not a git repository');
      return false;
    }
    prefixCache = r.out.split('\n')[1] ?? '';
    failure = null;
    return true;
  }
  /** → true, or an { available:false, reason } object. */
  async function check() { return (await probe()) ? true : unavailable(failure); }
  const strip = (p) => (!prefixCache ? p : p.startsWith(prefixCache) ? p.slice(prefixCache.length) : null);

  async function hasHead() { return (await g(['rev-parse', '--verify', '--quiet', 'HEAD'])).ok; }

  const COMMIT_FMT = ['%H', '%h', '%P', '%D', '%an', '%ae', '%aI', '%s'].join(US);
  function parseCommits(out) {
    const res = [];
    for (const chunk of out.split(RS)) {
      const c = chunk.replace(/^\n+/, '');
      if (!c.trim()) continue;
      const [hash, short, parents, refs, author, email, date, subject] = c.split(US);
      if (!hash) continue;
      res.push({ hash, short, parents: parents ? parents.split(' ').filter(Boolean) : [], refs: parseRefs(refs), author, email, date, subject: (subject ?? '').replace(/\n+$/, '') });
    }
    return res;
  }

  async function branches() {
    const c = await check(); if (c !== true) return c;
    const fmt = ['%(refname)', '%(refname:short)', '%(upstream:short)', '%(upstream:track)', '%(objectname)', '%(committerdate:iso-strict)', '%(subject)', '%(HEAD)'].join(US);
    const r = await g(['for-each-ref', `--format=${fmt}`, 'refs/heads', 'refs/remotes']);
    const out = { available: true, current: null, local: [], remote: [] };
    const cur = await g(['symbolic-ref', '--short', '-q', 'HEAD']);
    if (cur.ok) out.current = cur.out.trim() || null;
    else { const h = await g(['rev-parse', '--short', 'HEAD']); if (h.ok) out.current = null; }
    for (const line of r.out.split('\n')) {
      if (!line) continue;
      const [ref, name, upstream, track, hash, date, subject, head] = line.split(US);
      const last = { hash, date, subject };
      if (ref.startsWith('refs/heads/')) {
        const t = parseTrack(track);
        out.local.push({ name, upstream: upstream || null, ahead: t.ahead, behind: t.behind, gone: t.gone, current: head === '*', last });
        if (head === '*') out.current = name;
      } else if (ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')) out.remote.push({ name, last });
    }
    return out;
  }

  async function log({ branch, path, author, since, until, limit = 100, skip = 0 } = {}) {
    const c = await check(); if (c !== true) return c;
    const args = ['log', `--format=${COMMIT_FMT}${RS}`, '--date-order'];
    args.push(`-n${Math.max(1, Math.min(2000, Number(limit) || 100))}`);
    if (Number(skip) > 0) args.push(`--skip=${Math.floor(Number(skip))}`);
    if (author) args.push(`--author=${String(author).replace(/\0/g, '')}`, '--regexp-ignore-case');
    if (since) args.push(`--since=${String(since).replace(/\0/g, '')}`);
    if (until) args.push(`--until=${String(until).replace(/\0/g, '')}`);
    if (branch === 'all' || branch === '--all') args.push('--all');
    else if (branch) {
      if (!validRev(branch) && !(await validRefName(root, branch))) return { error: 'bad branch' };
      args.push(branch);
    }
    args.push('--');
    if (path) {
      const p = cleanRelPath(root, path); if (!p) return { error: 'bad path' };
      args.push(p);
    }
    const r = await g(args);
    if (!r.ok) return [];
    return parseCommits(r.out);
  }

  async function commit(hash) {
    const c = await check(); if (c !== true) return c;
    if (!validRev(hash)) return { error: 'bad hash' };
    const head = await g(['show', '-s', `--format=${COMMIT_FMT}${US}%b${RS}`, hash]);
    if (!head.ok) return { error: 'not found' };
    const parts = head.out.replace(/\n$/, '').split(US);
    const body = parts.slice(8).join(US).replace(RS, '').trim();
    const [info] = parseCommits(parts.slice(0, 8).join(US));
    if (!info) return { error: 'not found' };
    const [ns, num, patch] = await Promise.all([
      g(['show', '--format=', '--name-status', '-z', '-M', '--relative', hash]),
      g(['show', '--format=', '--numstat', '-z', '-M', '--relative', hash]),
      g(['show', '--format=', '-M', '--relative', hash]),
    ]);
    const stats = parseNumstatZ(num.out);
    const files = parseNameStatusZ(ns.out).map((f) => {
      const s = stats.get(f.path) || { added: 0, removed: 0 };
      const o = { path: f.path, status: f.status, added: s.added, removed: s.removed };
      if (f.from) o.from = f.from;
      return o;
    });
    let p = patch.out;
    let truncated = false;
    if (p.length > MAX_PATCH) { p = p.slice(0, MAX_PATCH); truncated = true; }
    return { ...info, body, files, patch: p, truncated };
  }

  async function changes() {
    const c = await check(); if (c !== true) return c;
    const [st, ns, nu] = await Promise.all([
      g(['status', '--porcelain=v1', '-z', '--untracked-files=all']),
      g(['diff', '--cached', '--numstat', '-z', '-M', '--relative']),
      g(['diff', '--numstat', '-z', '--relative']),
    ]);
    const sNum = parseNumstatZ(ns.out), uNum = parseNumstatZ(nu.out);
    const res = { available: true, staged: [], unstaged: [], untracked: [], conflicted: [] };
    const parts = st.out.split('\0');
    for (let i = 0; i < parts.length; i++) {
      const e = parts[i];
      if (e.length < 4) continue;
      const x = e[0], y = e[1];
      let p = e.slice(3);
      let from;
      if (x === 'R' || x === 'C' || y === 'R' || y === 'C') from = parts[++i];
      p = strip(p); if (p === null) continue;
      if (from !== undefined) from = strip(from) ?? from;
      if (x === '?' && y === '?') { res.untracked.push(p); continue; }
      if (x === '!' ) continue;
      if (CONFLICT.has(x + y)) { res.conflicted.push(p); continue; }
      if (x !== ' ') {
        const n = sNum.get(p) || { added: 0, removed: 0 };
        const o = { path: p, status: x, added: n.added, removed: n.removed };
        if (from && (x === 'R' || x === 'C')) o.from = from;
        res.staged.push(o);
      }
      if (y !== ' ') {
        const n = uNum.get(p) || { added: 0, removed: 0 };
        res.unstaged.push({ path: p, status: y, added: n.added, removed: n.removed });
      }
    }
    return res;
  }

  async function diff({ path, staged = false } = {}) {
    const c = await check(); if (c !== true) return c;
    const p = cleanRelPath(root, path); if (!p) return { error: 'bad path' };
    let r;
    if (staged) r = await g(['diff', '--cached', '-M', '--relative', '--', p]);
    else {
      r = await g(['diff', '--relative', '--', p]);
      if (r.ok && !r.out) {
        const un = await g(['ls-files', '--others', '--exclude-standard', '--', p]);
        if (un.ok && un.out.trim()) r = await g(['diff', '--no-index', '--', '/dev/null', p]); // exit 1 = differences
        if (r.out) r = { ...r, ok: true };
      }
    }
    let patch = r.out || '';
    let truncated = false;
    if (patch.length > MAX_PATCH) { patch = patch.slice(0, MAX_PATCH); truncated = true; }
    return { path, staged: !!staged, patch, hunks: parseHunks(patch), truncated };
  }

  async function tags() {
    const c = await check(); if (c !== true) return c;
    const fmt = ['%(refname:short)', '%(objectname)', '%(*objectname)', '%(creatordate:iso-strict)', '%(subject)', '%(objecttype)'].join(US);
    const r = await g(['for-each-ref', '--sort=-creatordate', `--format=${fmt}`, 'refs/tags']);
    return r.out.split('\n').filter(Boolean).map((l) => {
      const [name, obj, peeled, date, subject, type] = l.split(US);
      return { name, hash: peeled || obj, annotated: type === 'tag', date, subject };
    });
  }

  async function stash() {
    const c = await check(); if (c !== true) return c;
    const r = await g(['stash', 'list', `--format=%gd${US}%H${US}%gs${US}%aI`]);
    return r.out.split('\n').filter(Boolean).map((l) => {
      const [ref, hash, message, date] = l.split(US);
      const m = /\{(\d+)\}/.exec(ref);
      return { index: m ? Number(m[1]) : 0, ref, hash, message, date };
    });
  }

  async function remotes() {
    const c = await check(); if (c !== true) return c;
    const r = await g(['remote', '-v']);
    const map = new Map();
    for (const l of r.out.split('\n')) {
      const m = /^(\S+)\t(\S+) \((fetch|push)\)$/.exec(l);
      if (!m) continue;
      const o = map.get(m[1]) || { name: m[1], fetch: null, push: null };
      o[m[3]] = m[2].replace(/\/\/[^/@]*@/, '//***@'); // never expose credentials in URLs
      map.set(m[1], o);
    }
    return [...map.values()];
  }

  async function blame(path) {
    const c = await check(); if (c !== true) return c;
    const p = cleanRelPath(root, path); if (!p) return { error: 'bad path' };
    const r = await g(['blame', '--porcelain', '--', p], { timeout: 30000 });
    if (!r.ok) return { error: explain(r.err) };
    const info = new Map();
    const res = [];
    let cur = null;
    for (const line of r.out.split('\n')) {
      if (line.startsWith('\t')) { if (cur) { res.push({ line: cur.line, hash: cur.hash, short: cur.hash.slice(0, 7), author: cur.meta.author, date: cur.meta.date, summary: cur.meta.summary }); cur = null; } continue; }
      const h = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/.exec(line);
      if (h) {
        if (!info.has(h[1])) info.set(h[1], { author: '', date: null, summary: '' });
        cur = { hash: h[1], line: Number(h[2]), meta: info.get(h[1]) };
        continue;
      }
      if (!cur) continue;
      if (line.startsWith('author ')) cur.meta.author = line.slice(7);
      else if (line.startsWith('author-time ')) cur.meta.date = new Date(Number(line.slice(12)) * 1000).toISOString();
      else if (line.startsWith('summary ')) cur.meta.summary = line.slice(8);
    }
    return res;
  }

  async function stats({ since, until } = {}) {
    const c = await check(); if (c !== true) return c;
    const args = ['log', '--numstat', '--relative', `--format=${RS}%H${US}%an${US}%ae${US}%aI`];
    if (since) args.push(`--since=${String(since).replace(/\0/g, '')}`);
    if (until) args.push(`--until=${String(until).replace(/\0/g, '')}`);
    args.push('--');
    const r = await g(args, { timeout: 30000 });
    const byA = new Map(), byD = new Map(), byF = new Map();
    for (const chunk of r.out.split(RS)) {
      if (!chunk.trim()) continue;
      const lines = chunk.split('\n');
      const [, author, email, date] = lines[0].split(US);
      if (!date) continue;
      const day = date.slice(0, 10);
      const A = byA.get(email) || { author, email, commits: 0, added: 0, removed: 0 };
      const D = byD.get(day) || { date: day, commits: 0, added: 0, removed: 0 };
      A.commits++; D.commits++;
      for (const l of lines.slice(1)) {
        const m = /^(-|\d+)\t(-|\d+)\t(.+)$/.exec(l);
        if (!m) continue;
        const a = m[1] === '-' ? 0 : +m[1], d = m[2] === '-' ? 0 : +m[2];
        A.added += a; A.removed += d; D.added += a; D.removed += d;
        const F = byF.get(m[3]) || { path: m[3], commits: 0, added: 0, removed: 0 };
        F.commits++; F.added += a; F.removed += d; byF.set(m[3], F);
      }
      byA.set(email, A); byD.set(day, D);
    }
    return {
      available: true,
      byAuthor: [...byA.values()].sort((a, b) => b.commits - a.commits),
      byDay: [...byD.values()].sort((a, b) => a.date.localeCompare(b.date)),
      topFiles: [...byF.values()].sort((a, b) => b.commits - a.commits || (b.added + b.removed) - (a.added + a.removed)).slice(0, 50),
    };
  }

  /** Commits (ms ts + author) between ms timestamps; [] when unavailable. */
  async function commitTimes(fromMs, toMs) {
    if (!(await probe())) return [];
    const r = await g(['log', `--since=@${Math.floor(fromMs / 1000)}`, `--until=@${Math.floor(toMs / 1000)}`, `--format=%at${US}%an`, '--']);
    return r.out.split('\n').filter(Boolean).map((l) => { const [t, a] = l.split(US); return { ts: Number(t) * 1000, author: a }; });
  }

  return { branches, log, commit, changes, diff, tags, stash, remotes, blame, stats, commitTimes, available: probe, hasHead, validRefName: (n) => validRefName(root, n) };
}
