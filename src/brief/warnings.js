// Agent mistake prevention (#8): warning rules derived from repo facts (lockfile -> package manager, generated
// files), context-file rules, accepted lessons and (for roles that may see session data) failing-command history,
// matched against a proposed action { command, paths, task }. Nothing here spawns a process.
import fs from 'node:fs';
import path from 'node:path';
import { detectProject } from '../project/index.js';
import { parseRules, classify, segments } from '../insights/rules.js';
import { lessonsFrom } from '../insights/lessons.js';
import { readState, hiddenOf } from '../insights/index.js';
import { projectSessions, signature } from '../insights/transcripts.js';
import { tokens, jaccard, containment, norm, sha } from '../insights/text.js';
import { globMatch } from '../core/glob.js';
import { createClaims } from '../live/claims.js';
import { readRegularAsync } from '../files/safeio.js';
import { ev, clipText, pathList } from './util.js';

const PMS = ['npm', 'pnpm', 'yarn', 'bun'];
const INSTALL = new Set(['install', 'i', 'add', 'ci', 'remove', 'rm', 'uninstall', 'un', 'update', 'up', 'upgrade', 'dedupe', 'link']);
const LOCK_FILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'composer.lock', 'poetry.lock', 'Cargo.lock', 'Gemfile.lock', 'uv.lock', 'go.sum', 'npm-shrinkwrap.json']);
const GENERATED = [
  [/(^|\/)(dist|build|out|\.next|\.nuxt|\.svelte-kit|coverage)\//, 'build output'],
  [/(^|\/)(node_modules|vendor)\//, 'installed dependency'],
  [/\.min\.(js|css)$/, 'minified bundle'],
  [/(\.generated\.|\.gen\.|_pb2\.py$|\.pb\.go$|_generated\.)/, 'generated source'],
];
const DESTRUCTIVE = [
  [/\bgit\s+push\b[^|;&]*\s(--force\b|-f\b|--force-with-lease\b)/, 'warn', 'Force push rewrites shared history', 'Push without --force, or coordinate with the team and use --force-with-lease on your own branch only.'],
  [/\bgit\s+reset\s+--hard\b/, 'warn', 'git reset --hard discards uncommitted work', 'Create a checkpoint first (agentneuron checkpoint create) or stash the changes.'],
  [/\bgit\s+clean\s+-\w*f/, 'warn', 'git clean deletes untracked files', 'Preview with git clean -n first.'],
  [/\bgit\s+checkout\s+(--\s+)?\.(\s|$)|\bgit\s+restore\s+\.(\s|$)/, 'warn', 'Discards all working-tree changes', 'Restore only the files you mean to.'],
  [/\brm\s+-(?=[A-Za-z]*r)[A-Za-z]+\s+(\/|~|\$HOME|\*)(\s|$)/, 'block', 'Recursive delete of a root, home or wildcard path', 'Delete the specific directory you mean, never / ~ or *.'],
  [/\bgit\s+commit\b[^|;&]*--no-verify\b/, 'warn', 'Skips the commit hooks', 'Fix what the hooks report instead of bypassing them.'],
  [/\b(migrate:fresh|migrate:reset|db:drop|db:wipe|dropdb)\b|\bDROP\s+(TABLE|DATABASE)\b/i, 'warn', 'Destroys database data', 'Only on a disposable local database; never against shared or production data.'],
];

const SEV_RANK = { block: 0, warn: 1, info: 2 };
const ruleId = (s) => sha(s).slice(0, 10);

function pathMatch(target, p) {
  if (!p) return false;
  const t = target.replace(/^\.\//, '');
  if (/[*?{]/.test(t)) return globMatch(t, p) || globMatch(`**/${t}`, p);
  if (t.endsWith('/')) return p.startsWith(t) || p.includes(`/${t}`);
  return p === t || p.startsWith(`${t}/`) || p.endsWith(`/${t}`);
}

/** Rule matchers from a classified context rule / lesson (null when not checkable). */
function fromCheck(c) {
  if (!c) return null;
  if (c.type === 'command-preference') return { type: 'prefer', prefer: c.prefer, avoid: c.avoid };
  if (c.type === 'command-prohibition') return { type: 'forbid-cmd', cmd: c.cmd };
  if (c.type === 'path-prohibition') return { type: 'forbid-path', targets: c.targets };
  return null;
}

const lessonCache = new Map(); // root -> { sig, at, list }

async function historyLessons(b) {
  let ss = [];
  try { ss = await projectSessions({ root: b.root, home: b.home, sessions: b.sessions }, { limit: 100 }); } catch { ss = []; }
  const sig = signature(ss);
  const c = lessonCache.get(b.root);
  if (c && c.sig === sig && Date.now() - c.at < 60000) return c.list;
  const files = b.store ? [...b.store.files.values()] : [];
  const list = lessonsFrom(ss, { files, contents: b.store?.contents || new Map(), hidden: hiddenOf(readState(b.root)) });
  lessonCache.set(b.root, { sig, at: Date.now(), list });
  return list;
}

/**
 * The active warning rules. opts.sessionData: include rules mined from session history (unaccepted lessons,
 * repeated failures). Callers pass false for roles that may not see prompts, so a viewer cannot probe history.
 */
export async function warningRules(b, { sessionData = true } = {}) {
  const rules = [];
  const seen = new Set();
  const add = (r) => { const k = r.dedupe || r.id; if (seen.has(k)) return; seen.add(k); rules.push(r); };

  // facts: package manager from the lockfile
  let proj = null;
  try { proj = await detectProject(b.root); } catch { proj = null; }
  const pm = (proj?.packageManagers || []).find((p) => PMS.includes(p.id) && p.lockfile);
  if (pm) {
    add({ id: `pm-${pm.id}`, kind: 'package-manager', severity: 'block', title: `This repo uses ${pm.id}`, why: `${pm.lockfile} is the lockfile. Another package manager would ignore it and write a second lockfile with different versions.`,
      fix: `Use ${pm.id} (for example \`${pm.id} ${pm.id === 'npm' ? 'install' : 'add'} <pkg>\`).`, source: { kind: 'fact', ref: pm.lockfile }, evidence: [ev('file', pm.lockfile)],
      match: { type: 'pm', prefer: pm.id, avoid: PMS.filter((x) => x !== pm.id) } });
  }
  const pyLock = ['poetry.lock', 'uv.lock', 'Pipfile.lock'].find((f) => (proj?.manifests || []).some((m) => m.path === f || m === f) || fs.existsSync(path.join(b.root, f)));
  if (pyLock) {
    const tool = pyLock === 'poetry.lock' ? 'poetry' : pyLock === 'uv.lock' ? 'uv' : 'pipenv';
    add({ id: `py-${tool}`, kind: 'package-manager', severity: 'warn', title: `Python dependencies are managed with ${tool}`, why: `${pyLock} pins the versions; pip install bypasses it.`,
      fix: `Use \`${tool} add <pkg>\`.`, source: { kind: 'fact', ref: pyLock }, evidence: [ev('file', pyLock)], match: { type: 'py', tool } });
  }

  // context-file rules
  const files = b.store ? [...b.store.files.values()] : [];
  for (const r of b.store ? parseRules(files, b.store.contents) : []) {
    const m = fromCheck(r.check);
    if (!m) continue;
    add({ id: `rule-${r.id}`, dedupe: norm(r.rule), kind: m.type === 'forbid-path' ? 'protected-path' : 'command-rule', severity: m.type === 'prefer' ? 'warn' : 'block',
      title: clipText(r.rule, 200), why: `Rule in ${r.file}:${r.line}.`, fix: m.type === 'prefer' && m.prefer ? `Use ${m.prefer}.` : 'Follow the rule or ask the user first.',
      source: { kind: 'rule', ref: r.id, file: r.file, line: r.line }, evidence: [ev('file', `${r.file}:${r.line}`)], match: m });
  }
  // accepted lessons (they are written into a context file, so they are project text now)
  for (const a of readState(b.root).accepted) {
    const m = fromCheck(classify(String(a.rule || '')));
    if (!m) continue;
    add({ id: `lesson-${a.id}`, dedupe: norm(a.rule), kind: m.type === 'forbid-path' ? 'protected-path' : 'command-rule', severity: m.type === 'prefer' ? 'warn' : 'block',
      title: clipText(a.rule, 200), why: `Accepted lesson${a.target ? ` (added to ${a.target})` : ''}.`, fix: m.type === 'prefer' && m.prefer ? `Use ${m.prefer}.` : 'Follow the rule or ask the user first.',
      source: { kind: 'lesson', ref: a.id, file: a.target || null }, evidence: a.target ? [ev('file', a.target, a.ts)] : [], match: m });
  }

  // history: commands that keep failing, reverted edits, corrections not yet accepted (session-derived)
  if (sessionData) {
    for (const l of await historyLessons(b)) {
      if (l.alreadyCovered) continue;
      const evidence = l.evidence.slice(0, 4).map((e) => ({ ...ev('session', e.session, e.ts), quote: e.quote }));
      let m = null;
      if ((l.kind === 'fix' || l.kind === 'failure') && l.evidence[0]) {
        const key = /`([^`]+)`/.exec(l.kind === 'fix' ? l.rule.split(' instead of ')[1] || '' : l.rule)?.[1];
        if (key) m = { type: 'history-cmd', key };
      } else if (l.kind === 'revert') {
        const p = l.evidence.find((e) => e.path)?.path;
        if (p) m = { type: 'history-path', targets: [p] };
      } else m = fromCheck(classify(l.rule));
      if (!m) continue;
      add({ id: `history-${l.id}`, dedupe: norm(l.rule), kind: 'history', severity: 'warn', title: l.rule, why: `Seen ${l.count}× in ${l.sessions} session(s): ${l.kind === 'fix' ? 'a different command worked' : l.kind === 'failure' ? 'this command kept failing' : l.kind === 'revert' ? 'an agent edit here was reverted' : 'the user corrected this'}.`,
        fix: l.kind === 'fix' ? l.rule : 'Check the evidence before repeating it; accept the lesson in Insights to make it a rule.', source: { kind: 'history', ref: l.id }, evidence, match: m, sessionDerived: true });
    }
  }

  // built-in: generated files, lockfiles, env files, destructive commands
  add({ id: 'generated', kind: 'generated', severity: 'warn', title: 'Generated or installed file', why: 'Edits are overwritten by the next build or install.', fix: 'Change the source or generator and rebuild.', source: { kind: 'builtin', ref: 'generated' }, evidence: [], match: { type: 'generated' } });
  add({ id: 'lockfile', kind: 'generated', severity: 'warn', title: 'Lockfile edited by hand', why: 'Lockfiles are written by the package manager; hand edits break integrity hashes.', fix: 'Change the manifest and run the package manager.', source: { kind: 'builtin', ref: 'lockfile' }, evidence: [], match: { type: 'lockfile' } });
  add({ id: 'env', kind: 'secrets', severity: 'warn', title: 'Environment file with secrets', why: '.env files hold credentials and are usually not committed.', fix: 'Edit .env.example for new keys; never commit real values.', source: { kind: 'builtin', ref: 'env' }, evidence: [], match: { type: 'env' } });
  DESTRUCTIVE.forEach(([re, severity, title, fix], i) => add({ id: `danger-${i}`, kind: 'destructive', severity, title, why: 'Hard to undo.', fix, source: { kind: 'builtin', ref: 'destructive' }, evidence: [], match: { type: 'regex', re } }));
  add({ id: 'claims', kind: 'coordination', severity: 'warn', title: 'Claimed by another agent', why: 'Another agent session holds an advisory claim on this path.', fix: 'Coordinate (list_claims / handoffs) or pick another file.', source: { kind: 'builtin', ref: 'claims' }, evidence: [], match: { type: 'claims' } });
  return rules;
}

/** Public view of a rule (no matcher internals). */
export const publicRule = ({ match, dedupe: _d, sessionDerived: _s, ...r }) => ({ ...r, applies: ['forbid-path', 'history-path', 'generated', 'lockfile', 'env', 'claims'].includes(match.type) ? 'paths' : 'command' });

const commandKey = (seg) => {
  const args = seg.words.slice(1).filter((w) => !w.startsWith('-'));
  const n = /^(npm|pnpm|yarn|bun)$/.test(seg.prog) && args[0] === 'run' ? 2 : 1;
  return [seg.prog, ...args.slice(0, n)].join(' ');
};

async function headerSays(root, p) {
  try {
    const r = await readRegularAsync(path.join(root, p), { head: 1024, confine: root });
    return r ? /@generated|DO NOT EDIT|auto-?generated|this file (is|was) generated/i.test(r.buf.toString('utf8')) : false;
  } catch { return false; }
}

/** Match one rule against an action; returns a warning or null. */
async function check(b, r, { command, segs, paths, claims }) {
  const m = r.match;
  const w = (detail, extra = {}) => ({ id: r.id, severity: extra.severity || r.severity, title: r.title, why: detail ? `${r.why} ${detail}` : r.why, fix: r.fix, source: r.source, evidence: [...(extra.evidence || []), ...r.evidence], ...(r.sessionDerived && { sessionDerived: true }) });
  if (command) {
    if (m.type === 'pm') {
      const s = segs.find((g) => m.avoid.includes(g.prog) && g.prog !== 'npx');
      if (s) {
        const verb = s.words[1] || '';
        if (INSTALL.has(verb) || (s.prog === 'yarn' && !verb)) return w(`\`${s.prog} ${verb}\` was proposed.`);
        return w(`\`${s.prog}\` was proposed; prefer \`${m.prefer}\` for scripts too.`, { severity: 'warn' });
      }
    } else if (m.type === 'py') {
      const s = segs.find((g) => /^pip3?$/.test(g.prog) && g.words[1] === 'install');
      if (s) return w('`pip install` was proposed.');
    } else if (m.type === 'prefer') {
      const s = segs.find((g) => m.avoid.includes(g.prog));
      if (s) return w(`\`${s.prog}\` was proposed.`);
    } else if (m.type === 'forbid-cmd') {
      const want = segments(m.cmd)[0];
      if (want && segs.some((g) => g.prog === want.prog && ` ${g.seg} `.includes(` ${want.seg} `))) return w();
    } else if (m.type === 'history-cmd') {
      if (segs.some((g) => commandKey(g) === m.key || g.seg.startsWith(`${m.key} `) || g.seg === m.key)) return w();
    } else if (m.type === 'regex') {
      if (m.re.test(command)) return w();
    } else if (m.type === 'forbid-path' || m.type === 'history-path') {
      const t = m.targets.find((x) => x.replace(/\*.*$/, '').length > 2 && command.includes(x.replace(/\*.*$/, '')));
      if (t && /\b(rm|mv|sed\s+-i|tee|cp|truncate|>)\b|>/.test(command)) return w(`The command writes to \`${t}\`.`);
    }
  }
  if (paths.length) {
    if (m.type === 'forbid-path' || m.type === 'history-path') {
      const hit = paths.filter((p) => m.targets.some((t) => pathMatch(t, p)));
      if (hit.length) return w(`Touches ${hit.map((p) => `\`${p}\``).join(', ')}.`, { evidence: hit.map((p) => ev('file', p)) });
    } else if (m.type === 'lockfile') {
      const hit = paths.filter((p) => LOCK_FILES.has(path.posix.basename(p)));
      if (hit.length) return w(`Touches ${hit.map((p) => `\`${p}\``).join(', ')}.`, { evidence: hit.map((p) => ev('file', p)) });
    } else if (m.type === 'env') {
      const hit = paths.filter((p) => /(^|\/)\.env(\.[\w-]+)?$/.test(p) && !/\.(example|sample|dist|template|defaults)$/.test(p));
      if (hit.length) return w(`Touches ${hit.map((p) => `\`${p}\``).join(', ')}.`, { evidence: hit.map((p) => ev('file', p)) });
    } else if (m.type === 'generated') {
      const hit = [];
      for (const p of paths) {
        const g = GENERATED.find(([re]) => re.test(p));
        if (g) hit.push([p, g[1]]);
        else if (await headerSays(b.root, p)) hit.push([p, 'marked as generated in its header']);
      }
      if (hit.length) return w(hit.map(([p, k]) => `\`${p}\`: ${k}.`).join(' '), { evidence: hit.map(([p]) => ev('file', p)) });
    } else if (m.type === 'claims' && claims) {
      const hit = [];
      for (const p of paths) for (const c of claims.holders(p)) hit.push(`\`${p}\` by ${c.agent}`);
      if (hit.length) return w(`Claimed: ${[...new Set(hit)].join(', ')}.`, { evidence: paths.map((p) => ev('file', p)) });
    }
  }
  return null;
}

/**
 * Warnings for a proposed action { command, paths, task }. opts.sessionData: see warningRules.
 * Returns { warnings, blocking, rules: n }.
 */
export async function checkAction(b, { command = '', paths = [], task = '' } = {}, { sessionData = true } = {}) {
  const cmd = typeof command === 'string' ? command.slice(0, 4000) : '';
  const ps = pathList(paths);
  const rules = await warningRules(b, { sessionData });
  const segs = segments(cmd);
  let claims = null;
  try { claims = createClaims(b.root); } catch { claims = null; }
  const out = [];
  for (const r of rules) {
    const hit = await check(b, r, { command: cmd, segs, paths: ps, claims });
    if (hit) out.push(hit);
  }
  // task text: surface the rules that talk about the same things (info only)
  const t = typeof task === 'string' ? task.slice(0, 2000) : '';
  if (t) {
    const tt = tokens(t);
    const scored = rules.filter((r) => r.source.kind === 'rule' || r.source.kind === 'lesson' || r.source.kind === 'history' || r.source.kind === 'fact')
      .map((r) => { const rt = tokens(r.title); return [r, Math.max(jaccard(tt, rt), containment(rt, tt) * 0.8)]; })
      .filter(([r, s]) => s >= 0.2 && !out.some((w) => w.id === r.id)).sort((a, c) => c[1] - a[1] || (a[0].id < c[0].id ? -1 : 1)).slice(0, 6);
    for (const [r] of scored) out.push({ id: r.id, severity: 'info', title: r.title, why: `Relevant to the task. ${r.why}`, fix: r.fix, source: r.source, evidence: r.evidence, ...(r.sessionDerived && { sessionDerived: true }) });
  }
  out.sort((a, c) => SEV_RANK[a.severity] - SEV_RANK[c.severity] || (a.id < c.id ? -1 : 1));
  return { command: cmd, paths: ps, task: t, warnings: out, blocking: out.some((w) => w.severity === 'block'), rules: rules.length };
}

export { ruleId };
