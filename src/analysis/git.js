import { execFile } from 'node:child_process';

const SEP = '\x1e';
const US = '\x1f';

function run(root, args, timeout = 8000) {
  return new Promise((resolve) => {
    try {
      execFile('git', args, { cwd: root, timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' } },
        (err, stdout) => {
          if (err) return resolve({ ok: false, out: typeof stdout === 'string' ? stdout : '' });
          resolve({ ok: true, out: stdout });
        });
    } catch {
      resolve({ ok: false, out: '' });
    }
  });
}

function mapCode(x, y) {
  if (x === '?' && y === '?') return '?';
  if (x === 'R' || y === 'R' || x === 'C' || y === 'C') return 'R';
  if (x === 'D' || y === 'D') return 'D';
  if (x === 'A' || y === 'A') return 'A';
  return 'M';
}

/** Parse `git status --porcelain=v1 -z` output. Returns [{code, path, from?}] with repo-root-relative paths. */
export function parsePorcelainZ(out) {
  const res = [];
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const x = e[0], y = e[1];
    const p = e.slice(3);
    let from;
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') from = parts[++i];
    res.push({ code: mapCode(x, y), path: p, from });
  }
  return res;
}

export function createGit(root) {
  let availCache = null;
  let prefixCache = null;

  async function available() {
    if (availCache !== null) return availCache;
    const r = await run(root, ['rev-parse', '--is-inside-work-tree'], 5000);
    availCache = r.ok && r.out.trim() === 'true';
    if (!availCache) {
      // do not cache negatives for long: repo may be created later
      setTimeout(() => { availCache = null; }, 3000).unref?.();
    }
    return availCache;
  }

  async function prefix() {
    if (prefixCache !== null) return prefixCache;
    const r = await run(root, ['rev-parse', '--show-prefix'], 5000);
    if (!r.ok) return '';
    prefixCache = r.out.trim();
    return prefixCache;
  }

  function strip(p, pre) {
    if (!pre) return p;
    return p.startsWith(pre) ? p.slice(pre.length) : null;
  }

  async function status() {
    const map = new Map();
    if (!(await available())) return map;
    const pre = await prefix();
    const r = await run(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    if (!r.ok) return map;
    for (const e of parsePorcelainZ(r.out)) {
      const rel = strip(e.path, pre);
      if (rel === null) continue;
      map.set(rel, e.code);
    }
    return map;
  }

  function parseLog(out) {
    const commits = [];
    for (const chunk of out.split(SEP)) {
      if (!chunk.trim()) continue;
      const nl = chunk.indexOf('\n');
      const head = nl === -1 ? chunk : chunk.slice(0, nl);
      const rest = nl === -1 ? '' : chunk.slice(nl + 1);
      const [hash, short, author, date, subject] = head.split(US);
      if (!hash) continue;
      commits.push({ hash, short, author, date, subject: subject ?? '', files: rest.split('\n').map((s) => s.trim()).filter(Boolean) });
    }
    return commits;
  }

  async function repoInfo() {
    const info = { branch: null, head: null, ahead: 0, behind: 0, remote: null, dirty: 0, recent: [] };
    if (!(await available())) return info;
    const [br, hd, ab, rm, st, lg] = await Promise.all([
      run(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
      run(root, ['rev-parse', '--short', 'HEAD']),
      run(root, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']),
      run(root, ['remote', 'get-url', 'origin']),
      status(),
      run(root, ['log', '-n', '20', '--relative', '--name-only', `--format=${SEP}%H${US}%h${US}%an${US}%aI${US}%s`]),
    ]);
    if (br.ok) info.branch = br.out.trim() || null;
    if (hd.ok) info.head = hd.out.trim() || null;
    if (ab.ok) {
      const [a, b] = ab.out.trim().split(/\s+/).map(Number);
      info.ahead = a || 0;
      info.behind = b || 0;
    }
    if (rm.ok) info.remote = rm.out.trim() || null;
    info.dirty = st.size;
    if (lg.ok) info.recent = parseLog(lg.out);
    return info;
  }

  async function fileLog(path, n = 30) {
    if (!(await available())) return [];
    const r = await run(root, ['log', '-n', String(n), '--follow', `--format=${SEP}%H${US}%h${US}%an${US}%aI${US}%s`, '--', path]);
    if (!r.ok) return [];
    return parseLog(r.out).map(({ hash, short, author, date, subject }) => ({ hash, short, author, date, subject }));
  }

  async function show(path, rev = 'HEAD') {
    if (!(await available())) return null;
    const r = await run(root, ['show', `${rev}:./${path}`]);
    return r.ok ? r.out : null;
  }

  async function diff(path) {
    if (!(await available())) return '';
    const r = await run(root, ['diff', 'HEAD', '--', path]);
    if (r.ok && r.out) return r.out;
    // no HEAD (fresh repo) or untracked: fall back to plain diff
    const r2 = await run(root, ['diff', '--', path]);
    return r2.ok ? r2.out : '';
  }

  return { available, repoInfo, status, fileLog, show, diff };
}
