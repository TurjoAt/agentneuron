import fs from 'node:fs';
import path from 'node:path';
import { createGit2 } from '../git2/index.js';
import { cleanRelPath, validRefName, validRev } from '../git2/run.js';
import { buildChangelog, prependChangelog } from '../git2/changelog.js';
import { resolveProjectDir, instances, clearCache } from '../workspace/index.js';

const REMOTE_RE = /^[\w.-]+$/;

function relPaths(ctx, paths) {
  if (!Array.isArray(paths) || !paths.length) throw new Error('paths required');
  return paths.map((p) => {
    const c = cleanRelPath(ctx.root, p);
    if (!c) throw new Error(`invalid path: ${String(p).slice(0, 80)}`);
    return c;
  });
}
async function refOrThrow(ctx, name, label = 'name') {
  if (!(await validRefName(ctx.root, name))) throw new Error(`invalid ${label}: ${String(name).slice(0, 80)}`);
  return name;
}
async function git(job, args) {
  const r = await job.exec('git', args, {});
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || `git ${args[0]} failed`).trim().split('\n').slice(-3).join('\n'));
  return { output: (r.stdout || '').trim() };
}
const idx = (n) => { const i = Number(n ?? 0); if (!Number.isInteger(i) || i < 0 || i > 10000) throw new Error('invalid stash index'); return i; };

export default function register(registry, ctx) {
  const g = ctx.git2 || (ctx.git2 = createGit2(ctx.root));
  const available = async () => (await g.available());
  const def = (d) => registry.register({ category: 'git', available, ...d });
  const pathsParam = { type: 'string[]', required: true, label: 'Paths' };

  // ---- edit ------------------------------------------------------------
  def({ id: 'git.stage', title: 'Stage files', level: 'edit', description: 'git add the given paths', params: { paths: pathsParam },
    preview: (p) => ({ command: ['git', 'add', '--', ...relPaths(ctx, p.paths)], summary: `Stage ${p.paths.length} path(s)` }),
    run: async (p, c, job) => git(job, ['add', '--', ...relPaths(ctx, p.paths)]) });
  def({ id: 'git.unstage', title: 'Unstage files', level: 'edit', description: 'Remove paths from the index', params: { paths: pathsParam },
    preview: (p) => ({ command: ['git', 'restore', '--staged', '--', ...relPaths(ctx, p.paths)], summary: `Unstage ${p.paths.length} path(s)` }),
    run: async (p, c, job) => {
      const ps = relPaths(ctx, p.paths);
      if (!(await g.hasHead())) return git(job, ['rm', '-r', '--cached', '-q', '--', ...ps]);
      return git(job, ['restore', '--staged', '--', ...ps]);
    } });
  def({ id: 'git.commit', title: 'Commit', level: 'edit', description: 'Commit staged changes',
    params: { message: { type: 'text', label: 'Message' }, amend: { type: 'boolean', default: false } },
    preview: (p) => ({ command: ['git', 'commit', ...(p.amend ? ['--amend'] : []), ...(p.message ? ['-m', p.message] : ['--no-edit'])], summary: p.amend ? 'Amend last commit' : 'Commit staged changes' }),
    run: async (p, c, job) => {
      const msg = typeof p.message === 'string' ? p.message.trim() : '';
      if (!msg && !p.amend) throw new Error('commit message required');
      return git(job, ['commit', ...(p.amend ? ['--amend'] : []), ...(msg ? ['-m', msg] : ['--no-edit'])]);
    } });
  def({ id: 'git.branch.create', title: 'Create branch', level: 'edit', description: 'Create a branch (optionally from a ref) and switch to it',
    params: { name: { type: 'string', required: true, label: 'Branch name' }, from: { type: 'string', label: 'Start point' } },
    preview: (p) => ({ command: ['git', 'switch', '-c', p.name, ...(p.from ? [p.from] : [])], summary: `Create branch ${p.name}` }),
    run: async (p, c, job) => {
      await refOrThrow(ctx, p.name);
      const args = ['switch', '-c', p.name];
      if (p.from) { if (!validRev(p.from) && !(await validRefName(ctx.root, p.from))) throw new Error('invalid start point'); args.push(p.from); }
      return git(job, args);
    } });
  def({ id: 'git.branch.switch', title: 'Switch branch', level: 'edit', description: 'Switch to an existing branch',
    params: { name: { type: 'string', required: true, label: 'Branch' } },
    preview: (p) => ({ command: ['git', 'switch', p.name], summary: `Switch to ${p.name}` }),
    run: async (p, c, job) => { await refOrThrow(ctx, p.name); return git(job, ['switch', p.name]); } });
  def({ id: 'git.stash.push', title: 'Stash changes', level: 'edit', description: 'Stash working changes',
    params: { message: { type: 'string', label: 'Message' } },
    preview: (p) => ({ command: ['git', 'stash', 'push', ...(p.message ? ['-m', p.message] : [])], summary: 'Stash changes' }),
    run: async (p, c, job) => git(job, ['stash', 'push', ...(p.message ? ['-m', String(p.message)] : [])]) });
  def({ id: 'git.stash.pop', title: 'Pop stash', level: 'edit', description: 'Apply and drop a stash entry',
    params: { index: { type: 'number', default: 0, label: 'Index' } },
    preview: (p) => ({ command: ['git', 'stash', 'pop', `stash@{${idx(p.index)}}`], summary: 'Pop stash' }),
    run: async (p, c, job) => git(job, ['stash', 'pop', `stash@{${idx(p.index)}}`]) });
  def({ id: 'git.tag.create', title: 'Create tag', level: 'edit', description: 'Create a (annotated) tag at HEAD',
    params: { name: { type: 'string', required: true, label: 'Tag' }, message: { type: 'string', label: 'Message' } },
    preview: (p) => ({ command: ['git', 'tag', ...(p.message ? ['-a', '-m', p.message] : []), p.name], summary: `Tag ${p.name}` }),
    run: async (p, c, job) => { await refOrThrow(ctx, p.name, 'tag'); return git(job, ['tag', ...(p.message ? ['-a', '-m', String(p.message)] : []), p.name]); } });

  // ---- exec ------------------------------------------------------------
  const remoteOf = (p) => { if (p.remote && !REMOTE_RE.test(p.remote)) throw new Error('invalid remote'); return p.remote; };
  def({ id: 'git.fetch', title: 'Fetch', level: 'exec', description: 'Fetch from a remote (default: all)',
    params: { remote: { type: 'string', label: 'Remote' } },
    preview: (p) => ({ command: ['git', 'fetch', remoteOf(p) || '--all'], summary: 'Fetch' }),
    run: async (p, c, job) => git(job, ['fetch', remoteOf(p) || '--all']) });
  def({ id: 'git.pull', title: 'Pull', level: 'exec', description: 'Pull (fast-forward only)', params: {},
    preview: () => ({ command: ['git', 'pull', '--ff-only'], summary: 'Pull (ff-only)' }),
    run: async (p, c, job) => git(job, ['pull', '--ff-only']) });
  def({ id: 'git.push', title: 'Push', level: 'exec', description: 'Push the current branch',
    params: { setUpstream: { type: 'boolean', default: false, label: 'Set upstream (origin)' } },
    preview: (p) => ({ command: ['git', 'push', ...(p.setUpstream ? ['-u', 'origin', 'HEAD'] : [])], summary: 'Push' }),
    run: async (p, c, job) => git(job, ['push', ...(p.setUpstream ? ['-u', 'origin', 'HEAD'] : [])]) });

  // ---- danger ----------------------------------------------------------
  def({ id: 'git.discard', title: 'Discard changes', level: 'danger', description: 'Discard unstaged changes and delete untracked files at the given paths',
    params: { paths: pathsParam },
    preview: (p) => ({ command: ['git', 'restore|clean', '--', ...relPaths(ctx, p.paths)], summary: 'Irreversibly discards working-tree changes' }),
    run: async (p, c, job) => {
      const ps = relPaths(ctx, p.paths);
      const ch = await g.changes();
      const untracked = ch.untracked || [];
      const toClean = [], toRestore = [];
      for (const x of ps) {
        const norm = x.replace(/^\.\//, '').replace(/\/$/, '');
        if (untracked.some((u) => u === norm || u.startsWith(norm + '/'))) toClean.push(x); else toRestore.push(x);
      }
      const out = [];
      if (toRestore.length) out.push((await git(job, ['restore', '--worktree', '--', ...toRestore])).output);
      if (toClean.length) out.push((await git(job, ['clean', '-f', '-d', '--', ...toClean])).output);
      return { output: out.filter(Boolean).join('\n') };
    } });
  def({ id: 'git.branch.delete', title: 'Delete branch', level: 'danger', description: 'Delete a local branch',
    params: { name: { type: 'string', required: true, label: 'Branch' }, force: { type: 'boolean', default: false } },
    preview: (p) => ({ command: ['git', 'branch', p.force ? '-D' : '-d', p.name], summary: `Delete branch ${p.name}` }),
    run: async (p, c, job) => { await refOrThrow(ctx, p.name); return git(job, ['branch', p.force ? '-D' : '-d', p.name]); } });
  def({ id: 'git.stash.drop', title: 'Drop stash', level: 'danger', description: 'Delete a stash entry',
    params: { index: { type: 'number', required: true, label: 'Index' } },
    preview: (p) => ({ command: ['git', 'stash', 'drop', `stash@{${idx(p.index)}}`], summary: 'Drop stash' }),
    run: async (p, c, job) => git(job, ['stash', 'drop', `stash@{${idx(p.index)}}`]) });

  // ---- changelog -------------------------------------------------------
  registry.register({
    id: 'git.changelog.write', title: 'Write changelog', category: 'git', level: 'edit', available,
    description: 'Prepend a conventional-commits changelog section to CHANGELOG.md',
    params: { from: { type: 'string', label: 'From (tag/commit)' }, to: { type: 'string', default: 'HEAD', label: 'To' } },
    preview: (p) => ({ command: ['write', 'CHANGELOG.md'], summary: `Changelog ${p.from || '(last tag)'}..${p.to || 'HEAD'}` }),
    run: async (p, c, job) => {
      const r = await buildChangelog(ctx.root, { from: p.from || undefined, to: p.to || 'HEAD' });
      if (r.error || r.available === false) throw new Error(r.error || r.reason);
      const file = path.join(ctx.root, 'CHANGELOG.md');
      let ex = '';
      try { ex = fs.readFileSync(file, 'utf8'); } catch { /* new file */ }
      const next = prependChangelog(ex, r.markdown);
      const tmp = file + '.agentneuron-tmp';
      fs.writeFileSync(tmp, next);
      fs.renameSync(tmp, file);
      job.log?.('info', `CHANGELOG.md updated (${r.count} commits)`);
      try { ctx.invalidate?.(); } catch { /* ignore */ }
      return { path: 'CHANGELOG.md', commits: r.count, markdown: r.markdown };
    },
  });

  // ---- workspace -------------------------------------------------------
  registry.register({
    id: 'workspace.open', title: 'Open project in agentneuron', category: 'workspace', level: 'exec',
    description: 'Start another agentneuron instance for a sibling project',
    params: { path: { type: 'string', required: true, label: 'Project directory' } },
    preview: (p) => ({ command: ['agentneuron', 'start', String(p.path), '--port', '0'], summary: 'Start a new agentneuron instance' }),
    run: async (p, c, job) => {
      const dir = resolveProjectDir(ctx, p.path);
      if (!dir) throw new Error('path must be a directory inside the workspace root');
      const r = await instances.open(dir, { host: ctx.config?.host || '127.0.0.1', token: ctx.config?.token || undefined });
      clearCache();
      job.log?.('info', `agentneuron running at ${r.url}`);
      return { url: r.url };
    },
  });
}
