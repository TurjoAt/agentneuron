// Mock routes for Agent brief (agent C). Synthetic data only.
// mock.js merges these: briefRoutes({ role, sessions, files, commits }).
const H = 3600e3;
const err = (status, message) => Object.assign(new Error(message), { status });
const ev = (kind, ref, ts = null) => ({ kind, ref, ts });

const RULES = [
  { id: 'pm-pnpm', kind: 'package-manager', severity: 'block', title: 'This repo uses pnpm', why: 'pnpm-lock.yaml is the lockfile. Another package manager would ignore it and write a second lockfile with different versions.', fix: 'Use pnpm (for example `pnpm add <pkg>`).', source: { kind: 'fact', ref: 'pnpm-lock.yaml' }, evidence: [ev('file', 'pnpm-lock.yaml')], applies: 'command' },
  { id: 'rule-3a91c0d2e4', kind: 'protected-path', severity: 'block', title: 'Never edit files in `apps/api/generated/` (they come from the OpenAPI spec).', why: 'Rule in apps/api/CLAUDE.md:14.', fix: 'Follow the rule or ask the user first.', source: { kind: 'rule', ref: '3a91c0d2e4', file: 'apps/api/CLAUDE.md', line: 14 }, evidence: [ev('file', 'apps/api/CLAUDE.md:14')], applies: 'paths' },
  { id: 'lesson-5e2f7b1c9a0d', kind: 'command-rule', severity: 'warn', title: 'Use vitest, not jest.', why: 'Accepted lesson (added to CLAUDE.md).', fix: 'Use vitest.', source: { kind: 'lesson', ref: '5e2f7b1c9a0d', file: 'CLAUDE.md' }, evidence: [ev('file', 'CLAUDE.md')], applies: 'command' },
  { id: 'history-81c4d0e9b2a7', kind: 'history', severity: 'warn', title: 'Use `pnpm test:unit` instead of `pnpm test`.', why: 'Seen 4× in 3 session(s): a different command worked.', fix: 'Use `pnpm test:unit` instead of `pnpm test`.', source: { kind: 'history', ref: '81c4d0e9b2a7' }, evidence: [{ ...ev('session', 'c41d77e2-90aa-4c1b-8f3e-6a2b9d0e5f11'), quote: '$ pnpm test → Error: no test specified in workspace root' }], applies: 'command', sessionDerived: true },
  { id: 'generated', kind: 'generated', severity: 'warn', title: 'Generated or installed file', why: 'Edits are overwritten by the next build or install.', fix: 'Change the source or generator and rebuild.', source: { kind: 'builtin', ref: 'generated' }, evidence: [], applies: 'paths' },
  { id: 'lockfile', kind: 'generated', severity: 'warn', title: 'Lockfile edited by hand', why: 'Lockfiles are written by the package manager; hand edits break integrity hashes.', fix: 'Change the manifest and run the package manager.', source: { kind: 'builtin', ref: 'lockfile' }, evidence: [], applies: 'paths' },
  { id: 'env', kind: 'secrets', severity: 'warn', title: 'Environment file with secrets', why: '.env files hold credentials and are usually not committed.', fix: 'Edit .env.example for new keys; never commit real values.', source: { kind: 'builtin', ref: 'env' }, evidence: [], applies: 'paths' },
  { id: 'danger-0', kind: 'destructive', severity: 'warn', title: 'Force push rewrites shared history', why: 'Hard to undo.', fix: 'Push without --force, or use --force-with-lease on your own branch only.', source: { kind: 'builtin', ref: 'destructive' }, evidence: [], applies: 'command' },
];

function matchRules(command, paths, task, viewer) {
  const out = [];
  const segs = command.split(/&&|\|\||;|\|/).map((s) => s.trim().split(/\s+/));
  const rule = (id) => RULES.find((r) => r.id === id);
  const hit = (r, detail, extra = {}) => out.push({ id: r.id, severity: extra.severity || r.severity, title: r.title, why: detail ? `${r.why} ${detail}` : r.why, fix: r.fix, source: r.source, evidence: r.evidence, ...(r.sessionDerived && { sessionDerived: true }) });
  for (const w of segs) {
    if (['npm', 'yarn', 'bun'].includes(w[0])) hit(rule('pm-pnpm'), `\`${w[0]} ${w[1] || ''}\` was proposed.`, ['install', 'i', 'add', 'ci', 'remove'].includes(w[1]) || (w[0] === 'yarn' && !w[1]) ? {} : { severity: 'warn' });
    if (w.includes('jest')) hit(rule('lesson-5e2f7b1c9a0d'), '`jest` was proposed.');
    if (!viewer && w[0] === 'pnpm' && w[1] === 'test') hit(rule('history-81c4d0e9b2a7'));
    if (w[0] === 'git' && w[1] === 'push' && w.some((x) => x === '--force' || x === '-f')) hit(rule('danger-0'));
  }
  const gen = paths.filter((p) => /(^|\/)(dist|build|node_modules)\/|\.min\.js$/.test(p));
  if (gen.length) hit(rule('generated'), gen.map((p) => `\`${p}\`: build output.`).join(' '));
  const prot = paths.filter((p) => p.startsWith('apps/api/generated/'));
  if (prot.length) hit(rule('rule-3a91c0d2e4'), `Touches ${prot.map((p) => `\`${p}\``).join(', ')}.`);
  const locks = paths.filter((p) => /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(p));
  if (locks.length) hit(rule('lockfile'), `Touches ${locks.map((p) => `\`${p}\``).join(', ')}.`);
  const envs = paths.filter((p) => /(^|\/)\.env(\.[\w-]+)?$/.test(p) && !/example|sample/.test(p));
  if (envs.length) hit(rule('env'), `Touches ${envs.map((p) => `\`${p}\``).join(', ')}.`);
  if (task && /install|dependenc|package|test/i.test(task)) for (const r of RULES.filter((x) => ['fact', 'lesson'].includes(x.source.kind) && !out.some((w) => w.id === x.id))) out.push({ id: r.id, severity: 'info', title: r.title, why: `Relevant to the task. ${r.why}`, fix: r.fix, source: r.source, evidence: r.evidence });
  const rank = { block: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

function resumeFor(sess, task, now) {
  const s = sess || {};
  const sid = s.sessionId || 'c41d77e2-90aa-4c1b-8f3e-6a2b9d0e5f11';
  const files = (s.filesTouched && s.filesTouched.length ? s.filesTouched : ['docs/plan.md', 'apps/api/src/payments/intent.ts', 'apps/api/test/intent.test.ts']).slice(0, 6);
  const t0 = s.startedAt || now - 3 * H, t1 = s.lastAt || now - 10 * 60e3;
  const at = (f) => Math.round(t0 + (t1 - t0) * f);
  const done = [
    ...files.slice(0, 3).map((p, i) => ({ kind: 'edit', label: `Edited ${p}${i === 0 ? ' (3 edits)' : ''}`, path: p, evidence: [ev('session', sid, at(0.3 + i * 0.1)), ev('file', p, at(0.3 + i * 0.1))] })),
    { kind: 'commit', label: 'Commit 4be1c07: feat(payments): add PaymentIntent state machine', evidence: [ev('commit', '4be1c07a9d2e3f4b5c6d7e8f9a0b1c2d3e4f5a6b', at(0.7))] },
  ];
  const failed = [
    { kind: 'command', label: 'Command failed 3×', command: 'pnpm test --filter api', quote: 'FAIL test/intent.test.ts > confirms a captured intent: expected "captured" got "requires_action"', resolved: false, count: 3, evidence: [ev('session', sid, at(0.55)), ev('session', sid, at(0.62)), ev('session', sid, at(0.68))] },
    { kind: 'command', label: 'Command failed 1×, later passed', command: 'pnpm lint', quote: 'apps/api/src/payments/intent.ts:41:7 no-unused-vars', resolved: true, count: 1, evidence: [ev('session', sid, at(0.4))] },
    { kind: 'denied', label: 'Bash call was denied (user-rejected)', evidence: [ev('session', sid, at(0.5))] },
    { kind: 'run', label: 'test run failed (1 failing)', command: 'pnpm test', evidence: [ev('run', 'run-7f3a', now - 25 * 60e3)] },
  ];
  const decisions = [
    { kind: 'correction', label: 'User correction', quote: "no, don't add a new status enum, reuse the existing PaymentStatus", title: "Don't add a new status enum, reuse the existing PaymentStatus.", evidence: [ev('session', sid, at(0.45))] },
    { kind: 'answer', label: 'User answered (AskUserQuestion)', quote: 'Which retry policy? = "exponential with jitter"', evidence: [ev('session', sid, at(0.2))] },
    { kind: 'rule', label: 'Accepted rule: Use vitest, not jest.', path: 'CLAUDE.md', evidence: [ev('file', 'CLAUDE.md', at(0.8))] },
  ];
  const runs = [
    { id: 'run-7f3a', kind: 'test', command: 'pnpm test', startedAt: now - 26 * 60e3, endedAt: now - 25 * 60e3, exitCode: 1, passed: 41, failed: 1, skipped: 2, failures: [{ name: 'confirms a captured intent', file: 'apps/api/test/intent.test.ts', quote: 'expected "captured" got "requires_action"' }] },
    { id: 'run-7f39', kind: 'build', command: 'pnpm build', startedAt: now - 40 * 60e3, endedAt: now - 39 * 60e3, exitCode: 0, passed: null, failed: 0, skipped: null, failures: [] },
  ];
  const todos = [
    { kind: 'todo', title: 'Add the PaymentIntent state machine', status: 'completed', evidence: [ev('session', sid, at(0.3))] },
    { kind: 'todo', title: 'Fix the captured-intent test', status: 'in_progress', evidence: [ev('session', sid, at(0.7))] },
    { kind: 'todo', title: 'Document retries in docs/plan.md', status: 'pending', evidence: [ev('session', sid, at(0.7))] },
  ];
  const criteria = task ? [{ id: 'c1', label: 'Captured intents end in status "captured"', status: 'failed', evidence: [ev('run', 'run-7f3a')] }, { id: 'c2', label: 'Retries use exponential backoff with jitter', status: 'untested', evidence: [] }] : [];
  const next = [
    { kind: 'fix-test', label: 'Fix failing test: confirms a captured intent', path: 'apps/api/test/intent.test.ts', evidence: [ev('run', 'run-7f3a', now - 25 * 60e3)] },
    { kind: 'command', label: 'Resolve the command that failed 3× and never passed', command: 'pnpm test --filter api', quote: 'expected "captured" got "requires_action"', evidence: [ev('session', sid, at(0.68))] },
    ...todos.filter((x) => x.status !== 'completed').map((x) => ({ kind: 'todo', label: 'Finish open todo', title: x.title, evidence: x.evidence })),
    ...criteria.filter((c) => c.status !== 'verified').map((c) => ({ kind: 'criterion', label: `${c.status === 'failed' ? 'Fix' : 'Verify'} acceptance criterion: ${c.label}`, evidence: c.evidence.length ? c.evidence : [ev('task', task)] })),
    { kind: 'checkpoint', label: 'Checkpoint "before state machine" is available to roll back to', evidence: [ev('checkpoint', 'cp-21', at(0.25))] },
  ];
  const title = task ? 'PaymentIntent retries' : s.title || 'Implement PaymentIntent module';
  const goal = { prompt: s.lastPrompt || 'Wire the PaymentIntent module into checkout routes and update the plan', ...(task && { title }), evidence: [ev('session', sid, t0), ...(task ? [ev('task', task)] : [])] };
  const out = {
    generatedAt: now, source: { session: task ? null : sid, task: task || null, sessions: [sid] }, title, goal,
    lastPrompt: 'keep going, but the captured test still fails', sessions: [{ sessionId: sid, tool: s.tool || 'claude', title: s.title || title, startedAt: t0, lastAt: t1, branch: 'feat/payments', errors: 4, prompts: 7 }],
    task: task ? { id: task, title, status: 'doing' } : null, done, failed, decisions,
    files: files.map((p, i) => ({ path: p, edits: 3 - Math.min(2, i), lastAt: at(0.7 - i * 0.1), evidence: [ev('session', sid, at(0.7 - i * 0.1))] })),
    runs, todos, criteria, checkpoints: [{ id: 'cp-21', label: 'before state machine', createdAt: at(0.25), files: 4 }], next,
    counts: { done: done.length, failed: failed.length, decisions: decisions.length, files: files.length, next: next.length },
  };
  const line = (i) => `- ${[i.label, i.title, i.command && `\`${i.command}\``, i.quote && `"${i.quote}"`].filter(Boolean).join(' ')}`;
  out.markdown = [`# Resume brief: ${title}`, '', '> Generated by AgentNeuron (demo data).', '', '## Goal', '', `> ${goal.prompt}`, '',
    '## Done', '', ...done.map(line), '', '## Failed attempts (do not repeat blindly)', '', ...failed.map(line), '', '## Decisions and corrections', '', ...decisions.map(line), '',
    '## Files', '', ...out.files.map((f) => `- \`${f.path}\``), '', '## Next steps', '', ...next.map(line), ''].join('\n');
  return out;
}

function viewerResume(v) {
  const strip = (i) => { const { command: _c, quote: _q, ...x } = i; return { ...x, ...(x.title !== undefined && { title: '' }) }; };
  const { markdown: _m, ...rest } = v;
  return { ...rest, title: '', lastPrompt: '', goal: { ...v.goal, prompt: '', ...(v.goal.title !== undefined && { title: '' }) }, task: v.task ? { ...v.task, title: '' } : null,
    sessions: v.sessions.map((s) => ({ ...s, title: '' })), done: v.done.map(strip), failed: v.failed.map(strip), decisions: v.decisions.map(strip), next: v.next.map(strip), todos: v.todos.map(strip),
    runs: v.runs.map((r) => ({ ...r, failures: r.failures.map(({ quote: _q, ...f }) => f) })) };
}

function packFor(task, budget, files) {
  const words = String(task).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const all = files.map((f) => f.path).filter(Boolean);
  const score = (p) => words.reduce((a, w) => a + (p.toLowerCase().includes(w) ? 3 : 0), 0);
  const ranked = all.map((p) => ({ p, s: score(p) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.p.localeCompare(b.p));
  const base = ranked.length ? ranked : all.slice(0, 4).map((p, i) => ({ p, s: 2 - i * 0.3 }));
  const items = [
    { kind: 'fact', path: 'pnpm-lock.yaml', text: 'Package manager: pnpm (lockfile pnpm-lock.yaml)', score: 5, reason: 'repo fact', tokens: 10 },
    { kind: 'fact', path: 'package.json', text: '`pnpm test` runs `vitest run`', score: 4, reason: 'package script', tokens: 8 },
    { kind: 'rule', path: 'CLAUDE.md', heading: 'Conventions', line: 12, text: '- Use vitest, not jest.\n- Never edit files in `apps/api/generated/`.\n- Run `pnpm lint` before every commit.', score: 3.5, tokens: 34, reason: 'section mentions "test"' },
    ...base.slice(0, 8).map((x, i) => ({ kind: /test|spec/.test(x.p) ? 'test' : 'file', path: x.p, reason: i === 0 ? `name matches ${words.slice(0, 2).map((w) => `"${w}"`).join(', ') || '"plan"'}; mentions "intent"` : i % 2 ? `imported by ${base[0].p}` : 'edited together in 2 agent sessions', score: Math.round((x.s + 4 - i * 0.4) * 100) / 100, tokens: 180 + ((x.p.length * 37) % 900) })),
  ];
  const out = [], skipped = [];
  let used = 0;
  for (const it of items) { if (used + it.tokens > budget) { skipped.push({ kind: it.kind, path: it.path, tokens: it.tokens, score: it.score, reason: 'budget full' }); continue; } used += it.tokens; out.push(it); }
  const md = [`# Context pack: ${task}`, '', `> ${out.length} items, ~${used} of ${budget} tokens.`, '', '## Files', '', ...out.filter((i) => i.kind === 'file').map((i) => `- \`${i.path}\` (~${i.tokens} tokens) — ${i.reason}`), ''].join('\n');
  return { generatedAt: Date.now(), task: { id: /^T-\d+$/.test(task) ? task : null, text: task }, budget, tokens: used, items: out, skipped, markdown: md };
}

function debugFor(error, source, viewer) {
  const text = String(error || '');
  const hyps = [
    { id: 'recent:apps/api/src/payments/intent.ts', title: 'Regression from a recent change to apps/api/src/payments/intent.ts', confidence: 0.75,
      evidence: [{ kind: 'file', ref: 'apps/api/src/payments/intent.ts:58', label: 'Top project frame of the stack trace' }, { kind: 'commit', ref: '4be1c07', label: 'Commit: feat(payments): add PaymentIntent state machine' }, { kind: 'session', ref: '8f2c1a90-3b7e-4d0e-9a41-2f6c5d8e1b07', label: 'An agent session edited this file in the last 7 days' }],
      check: 'Inspect the change with `git log -p -3 -- apps/api/src/payments/intent.ts`; if reverting 4be1c07 on a scratch branch makes the error go away, this is the cause.' },
    { id: 'null-value', title: 'A value is null or undefined at apps/api/src/payments/intent.ts:58', confidence: 0.45,
      evidence: [{ kind: 'error', ref: 'TypeError', label: 'Null / undefined access' }, { kind: 'file', ref: 'apps/api/src/payments/intent.ts:58', label: 'In confirmIntent' }],
      check: 'Log the value just before apps/api/src/payments/intent.ts:58 and trace where it is set; check callers changed recently and missing awaits.' },
    { id: 'env:STRIPE_WEBHOOK_SECRET', title: 'STRIPE_WEBHOOK_SECRET is documented but not set locally', confidence: 0.6,
      evidence: [{ kind: 'config', ref: '.env.example', label: 'STRIPE_WEBHOOK_SECRET is listed' }, { kind: 'config', ref: '.env', label: 'STRIPE_WEBHOOK_SECRET is missing' }],
      check: 'Set STRIPE_WEBHOOK_SECRET in .env (see .env.example) and restart the process.' },
    { id: 'seen-before', title: 'This failure was seen before in an agent session', confidence: 0.52,
      evidence: [{ kind: 'session', ref: 'c41d77e2-90aa-4c1b-8f3e-6a2b9d0e5f11', label: 'Same error earlier', quote: "TypeError: Cannot read properties of undefined (reading 'status')" }, { kind: 'file', ref: 'apps/api/src/payments/store.ts', label: 'Edited before it passed' }],
      check: 'Open the session replay and see which edits made it pass.' },
  ].sort((a, b) => b.confidence - a.confidence);
  const out = {
    generatedAt: Date.now(), source, run: source === 'run' ? { id: 'run-7f3a', kind: 'test', command: 'pnpm test', endedAt: Date.now() - 25 * 60e3 } : null,
    error: { type: 'TypeError', quote: text.split('\n')[0].replace(/^TypeError:\s*/, '').slice(0, 300) || "Cannot read properties of undefined (reading 'status')" },
    frames: [
      { path: 'apps/api/src/payments/intent.ts', line: 58, col: 21, fn: 'confirmIntent', inProject: true, dep: null, recent: true },
      { path: 'apps/api/src/routes/checkout.ts', line: 112, col: 9, fn: 'handler', inProject: true, dep: null, recent: false },
      { path: 'index.js', line: 284, col: 15, fn: 'Layer.handle', inProject: false, dep: 'express' },
    ],
    hypotheses: viewer ? hyps.filter((h) => h.id !== 'seen-before').map((h) => ({ ...h, evidence: h.evidence.filter((e) => e.kind !== 'session') })) : hyps,
    related: {
      files: ['apps/api/src/payments/intent.ts', 'apps/api/src/routes/checkout.ts'],
      commits: [{ hash: '4be1c07a9d2e3f4b5c6d7e8f9a0b1c2d3e4f5a6b', short: '4be1c07', subject: 'feat(payments): add PaymentIntent state machine', ts: Date.now() - 5 * H, files: ['apps/api/src/payments/intent.ts'] }],
      sessions: viewer ? [] : [{ session: 'c41d77e2-90aa-4c1b-8f3e-6a2b9d0e5f11', ts: Date.now() - 30 * H, command: 'pnpm test --filter api', quote: "TypeError: Cannot read properties of undefined (reading 'status')", fix: 'pnpm test --filter api', edits: ['apps/api/src/payments/store.ts'], similarity: 0.71 }],
      config: [{ key: 'STRIPE_WEBHOOK_SECRET', label: 'STRIPE_WEBHOOK_SECRET: in .env.example, not set in .env' }],
      deps: [{ name: 'express', declared: '^4.19.2', installed: '4.19.2' }],
      tests: [{ run: 'run-7f3a', kind: 'test', name: 'confirms a captured intent', file: 'apps/api/test/intent.test.ts' }],
    },
  };
  if (viewer) { out.error.quote = ''; out.frames = out.frames.map(({ fn: _f, ...f }) => f); }
  else out.markdown = [`# Bug report: ${out.error.type}: ${out.error.quote}`, '', '## Hypotheses', '', ...out.hypotheses.map((h, i) => `### ${i + 1}. ${h.title} (${Math.round(h.confidence * 100)}%)\n\n${h.evidence.map((e) => `- ${e.label} (\`${e.ref}\`)`).join('\n')}\n\n**How to confirm:** ${h.check}\n`)].join('\n');
  return out;
}

export function briefRoutes(deps) {
  const role = () => (deps.role ? deps.role() : 'admin');
  const viewer = () => role() !== 'admin';
  const sessions = () => (deps.sessions ? deps.sessions() : []);
  const saved = [{ id: 'b1a2b3c4d5e', kind: 'resume', title: 'Implement PaymentIntent module', createdAt: Date.now() - 20 * H, source: { session: '8f2c1a90-3b7e-4d0e-9a41-2f6c5d8e1b07', task: null } }];
  return {
    '/api/brief/sources': () => ({
      sessions: sessions().slice(0, 30).map((s) => ({ sessionId: s.sessionId, tool: s.tool, title: viewer() ? '' : s.title, startedAt: s.startedAt, lastAt: s.lastAt, branch: 'feat/payments', errors: (s.messages || 0) % 5, files: (s.filesTouched || []).length })),
      tasks: [{ id: 'T-12', title: 'PaymentIntent retries', status: 'doing', files: 3 }, { id: 'T-14', title: 'Document webhook replay', status: 'todo', files: 1 }],
    }),
    '/api/brief/resume': (q) => {
      const list = sessions();
      const s = q.session ? list.find((x) => x.sessionId === q.session) : list[0];
      if (q.session && !s) throw err(404, 'session not found');
      const v = resumeFor(s, q.task || null, Date.now());
      return viewer() ? viewerResume(v) : v;
    },
    '/api/brief/briefs': () => ({ briefs: saved.map((b) => (viewer() ? { ...b, title: '' } : b)) }),
    '/api/brief/brief': (q) => {
      const b = saved.find((x) => x.id === q.id);
      if (!b) throw err(404, 'brief not found');
      const v = resumeFor(sessions().find((s) => s.sessionId === b.source.session), null, b.createdAt);
      return { ...b, title: viewer() ? '' : b.title, brief: viewer() ? viewerResume(v) : v };
    },
    '/api/brief/warnings': (q) => {
      const command = String(q.command || ''), paths = String(q.paths || '').split(',').map((s) => s.trim()).filter(Boolean), task = String(q.task || '');
      const warnings = matchRules(command, paths, task, viewer());
      return { command, paths, task, warnings, blocking: warnings.some((w) => w.severity === 'block'), rules: RULES.length };
    },
    '/api/brief/rules': () => ({ rules: RULES.filter((r) => !viewer() || r.source.kind !== 'history').map(({ sessionDerived: _s, ...r }) => r) }),
    '/api/brief/pack': (q) => {
      const task = String(q.task || '').trim();
      if (!task) throw err(400, 'task is required');
      const budget = Math.max(500, Math.min(200000, Number(q.budget) || 8000));
      return packFor(task, budget, deps.files ? deps.files() : []);
    },
    '/api/brief/debug': (_q, b = {}) => {
      const error = typeof b.error === 'string' ? b.error : '';
      if (error.trim() && viewer()) throw err(403, 'pasting error text is admin-only; send { "run": "last" } for the last failing run');
      if (!error.trim() && !b.run) throw err(400, 'no error text and no failing run recorded');
      if (b.save === true && viewer()) throw err(403, 'saving a debug report needs the state level');
      const r = debugFor(error || "TypeError: Cannot read properties of undefined (reading 'status')", error.trim() ? 'error' : 'run', viewer());
      return b.save === true ? { ...r, saved: { id: 'b3f9c2a71d0', path: '.agentneuron/briefs/b3f9c2a71d0.json' } } : r;
    },
  };
}
