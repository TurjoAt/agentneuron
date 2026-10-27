// Mock routes for Ship check (agent A). Synthetic data only.
// mock.js merges these: shipRoutes({ role, sessions, files, commits }). Keys are bare paths, handlers get (params, body).
// `?off=exec` shows the disabled Run button with its how-to-enable hint; `?role=viewer` hides logs and overrides.

const MIN = 60_000;
const H = 60 * MIN;

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const hex = (s, n = 40) => { let out = ''; let h = hashStr(s); while (out.length < n) { h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0; out += h.toString(16).padStart(8, '0'); } return out.slice(0, n); };
const notFound = (m) => Object.assign(new Error(m), { status: 404 });
const badReq = (m) => Object.assign(new Error(m), { status: 400 });

export function shipRoutes(deps = {}) {
  const now = Date.now();
  const role = () => (typeof deps.role === 'function' ? deps.role() : 'admin');
  const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const off = new Set((qs.get('off') || '').split(',').filter(Boolean));
  const head = hex('head');

  const runGate = () => {
    if (role() !== 'admin') return { actionId: 'ship.verify.run', level: 'exec', enabled: false, reason: `requires the admin role (you are ${role()})` };
    if (off.has('exec')) return { actionId: 'ship.verify.run', level: 'exec', enabled: false, reason: 'enable actions.exec in .agentneuron/config.json (or start agentneuron with --enable exec)' };
    return { actionId: 'ship.verify.run', level: 'exec', enabled: true, reason: '' };
  };
  const override = () => (role() === 'admin' && !off.has('state') ? { enabled: true, reason: '' } : { enabled: false, reason: 'requires the admin role (log in with the admin token)' });

  const runs = [
    { id: 'r00mock0004a1b2c3', check: 'pnpm:test', kind: 'test', command: 'pnpm run test', source: 'package.json#scripts.test', startedAt: now - 14 * MIN, endedAt: now - 13 * MIN, exitCode: 1, passed: 46, failed: 2, skipped: 1, format: 'vitest', head,
      tests: [{ name: 'invoices > paginates with a cursor', status: 'passed' }, { name: 'invoices > returns an empty page past the end', status: 'failed' }, { name: 'auth > logout clears the session', status: 'passed' }, { name: 'auth > rate limits login attempts', status: 'failed' }],
      failures: [
        { name: 'invoices > returns an empty page past the end', file: 'apps/api/src/invoices.test.ts', line: 58, message: 'AssertionError: expected [ { id: 41 } ] to deeply equal []' },
        { name: 'auth > rate limits login attempts', file: 'apps/api/src/auth/limit.test.ts', line: 22, message: 'expected 200 to be 429' },
      ] },
    { id: 'r00mock0003d4e5f6', check: 'pnpm:typecheck', kind: 'typecheck', command: 'pnpm run typecheck', source: 'package.json#scripts.typecheck', startedAt: now - 15 * MIN, endedAt: now - 14.5 * MIN, exitCode: 0, passed: 1, failed: 0, skipped: 0, format: 'exit', head, tests: [], failures: [] },
    { id: 'r00mock0002a7b8c9', check: 'pnpm:lint', kind: 'lint', command: 'pnpm run lint', source: 'package.json#scripts.lint', startedAt: now - 3 * H, endedAt: now - 3 * H + 40_000, exitCode: 0, passed: 1, failed: 0, skipped: 0, format: 'exit', head: hex('old'), tests: [], failures: [] },
    { id: 'r00mock0001c0d1e2', check: 'pnpm:test', kind: 'test', command: 'pnpm run test', source: 'package.json#scripts.test', startedAt: now - 26 * H, endedAt: now - 26 * H + 61_000, exitCode: 0, passed: 44, failed: 0, skipped: 1, format: 'vitest', head: hex('older'), tests: [], failures: [] },
  ];
  const latest = (check) => runs.find((r) => r.check === check) || null;
  const summaryRun = (r) => (r ? { ...r, tests: undefined } : null);

  const checks = () => [
    { id: 'pnpm:test', kind: 'test', label: 'pnpm run test', command: 'pnpm run test', source: 'package.json#scripts.test', script: 'vitest run', last: summaryRun(latest('pnpm:test')), stale: false, status: 'failed' },
    { id: 'pnpm:typecheck', kind: 'typecheck', label: 'pnpm run typecheck', command: 'pnpm run typecheck', source: 'package.json#scripts.typecheck', script: 'tsc --noEmit', last: summaryRun(latest('pnpm:typecheck')), stale: false, status: 'passed' },
    { id: 'pnpm:lint', kind: 'lint', label: 'pnpm run lint', command: 'pnpm run lint', source: 'package.json#scripts.lint', script: 'eslint .', last: summaryRun(latest('pnpm:lint')), stale: true, status: 'passed' },
    { id: 'pnpm:build', kind: 'build', label: 'pnpm run build', command: 'pnpm run build', source: 'package.json#scripts.build', script: 'vite build', last: null, stale: false, status: 'never' },
  ];

  const T1 = 'm3f1c0de0a11', T2 = 'm9a8b7c6d5e4';
  const cid = (t, s) => 'c' + hex(t + s, 10);
  const ev = {
    commit: (s, label) => ({ kind: 'commit', ref: hex(s), label: `${hex(s, 7)} ${label}` }),
    file: (p) => ({ kind: 'file', ref: p, label: `${p} (changed)` }),
    pass: (n) => ({ kind: 'test', ref: 'r00mock0004a1b2c3', label: `passed: ${n}`, status: 'passed' }),
    fail: (n, p, l) => ({ kind: 'test', ref: 'r00mock0004a1b2c3', label: `failed: ${n}`, status: 'failed', path: p, line: l }),
  };
  const tasks = () => [
    { id: T1, title: 'Cursor pagination for GET /invoices', status: 'doing', source: 'md', path: 'TASKS.md', line: 7, labels: ['api'],
      criteria: [
        { id: cid(T1, 'a'), text: 'Responses include a nextCursor', done: true, source: 'checklist', status: 'verified', auto: true, evidence: [ev.pass('invoices > paginates with a cursor'), ev.commit('c1', 'feat(api): cursor pagination for invoices'), ev.file('apps/api/src/invoices.ts')] },
        { id: cid(T1, 'b'), text: 'Empty page past the end', done: true, source: 'checklist', status: 'failed', auto: true, evidence: [ev.fail('invoices > returns an empty page past the end', 'apps/api/src/invoices.test.ts', 58)] },
        { id: cid(T1, 'c'), text: 'Page size capped at 100', done: true, source: 'checklist', status: 'untested', auto: true, evidence: [ev.commit('c1', 'feat(api): cursor pagination for invoices')] },
        { id: cid(T1, 'd'), text: 'Docs updated in `docs/api.md`', done: false, source: 'checklist', status: 'incomplete', auto: true, evidence: [] },
      ] },
    { id: T2, title: 'Harden login', status: 'review', source: 'md', path: 'TASKS.md', line: 15, labels: ['auth'],
      criteria: [
        { id: cid(T2, 'a'), text: 'Logout clears the session', done: true, source: 'checklist', status: 'verified', auto: true, evidence: [ev.pass('auth > logout clears the session')] },
        { id: cid(T2, 'b'), text: 'Rate limit login attempts', done: true, source: 'checklist', status: 'failed', auto: true, evidence: [ev.fail('auth > rate limits login attempts', 'apps/api/src/auth/limit.test.ts', 22)] },
        { id: cid(T2, 'c'), text: 'Lockout email sent', done: null, source: 'description', status: 'verified', auto: false, evidence: [{ kind: 'manual', ref: cid(T2, 'c'), label: 'marked verified: checked in staging', at: now - 2 * H }] },
        { id: cid(T2, 'd'), text: 'Remember-me cookie is httpOnly', done: true, source: 'checklist', status: 'untested', auto: true, evidence: [ev.file('apps/api/src/auth/session.ts')] },
      ] },
  ];
  const summarize = (cs) => { const s = { criteria: cs.length, verified: 0, incomplete: 0, untested: 0, failed: 0 }; for (const c of cs) s[c.status]++; return s; };
  const scope = () => {
    const ts = tasks().map((t) => ({ ...t, commits: [], summary: summarize(t.criteria) }));
    return { tasks: ts, totals: { tasks: ts.length, ...summarize(ts.flatMap((t) => t.criteria)) } };
  };

  const changed = [
    { path: 'apps/api/src/invoices.ts', status: 'M', added: 84, removed: 21 },
    { path: 'apps/api/src/invoices.test.ts', status: 'M', added: 52, removed: 3 },
    { path: 'apps/api/src/auth/limit.ts', status: '?', added: 61, removed: 0 },
    { path: 'apps/api/src/auth/limit.test.ts', status: '?', added: 38, removed: 0 },
    { path: 'apps/api/src/auth/session.ts', status: 'M', added: 9, removed: 4 },
    { path: 'apps/web/src/pages/Invoices.tsx', status: 'M', added: 47, removed: 30 },
    { path: 'database/migrations/2026_10_20_120000_add_cursor_index.php', status: '?', added: 22, removed: 0 },
    { path: 'package.json', status: 'M', added: 2, removed: 1 },
  ];

  const F = (id, severity, category, title, why, fix, path, line) => ({ id: `${id}:${path || ''}:${line || 0}`, rule: id, severity, category, title, why, fix, location: { path: path || null, line: line || null } });
  const readinessData = () => {
    const findings = [
      F('env-committed', 'high', 'env', '.env.production is committed', 'Env files hold credentials and per-machine settings; committed ones leak and override deploy config.', 'git rm --cached .env.production, add it to .gitignore, rotate any credentials it contained, and commit a .env.example with key names only.', '.env.production'),
      F('secret', 'high', 'secrets', 'Stripe live key in the repository', 'Anyone with read access to the repository (and every clone, fork and CI log) gets this credential.', 'Remove it, rotate the credential, and load it from an environment variable or secret manager.', 'apps/api/src/billing/client.ts', 12),
      F('release-todo', 'high', 'release', 'TODO marked "before release"', 'The code itself says it is not ready to ship.', 'Resolve the TODO or move it to a tracked task with a decision.', 'apps/api/src/auth/limit.ts', 4),
      F('env-undocumented', 'medium', 'env', 'RATE_LIMIT_WINDOW is used but not in .env.example or deploy config', 'A deployment built from the example will not set it, so the code falls back to undefined.', 'Add RATE_LIMIT_WINDOW= to .env.example (and to the deploy config).', 'apps/api/src/auth/limit.ts', 9),
      F('cors-any', 'medium', 'cors', 'CORS allows any origin', "Any website can call this API from a visitor's browser.", 'List the allowed origins explicitly (from config per environment).', 'apps/api/src/server.ts', 31),
      F('migration-pending', 'medium', 'migrations', 'New migration: database/migrations/2026_10_20_120000_add_cursor_index.php', 'The deploy must run migrations before the new code serves traffic.', 'Commit it and make sure the deploy runs migrations (e.g. php artisan migrate --force, prisma migrate deploy).', 'database/migrations/2026_10_20_120000_add_cursor_index.php'),
      F('lockfile-stale', 'medium', 'dependencies', 'pnpm-lock.yaml is out of sync with package.json (1 missing)', 'CI and production install from the lockfile, so these dependencies may be missing or resolve differently.', 'Run the install command and commit pnpm-lock.yaml (missing: rate-limiter-flexible).', 'pnpm-lock.yaml'),
      F('debug-example', 'low', 'debug', 'APP_DEBUG=true in the env example', 'Deployments copied from the example start with debug pages that show stack traces and config.', 'Set APP_DEBUG=false in the example and enable it only locally.', '.env.example', 3),
    ];
    const counts = { high: 3, medium: 4, low: 1 };
    return { generatedAt: now, ready: false, blockers: counts.high, counts, findings, scanned: { files: 412, scanned: 412, skipped: 3, truncated: false, ms: 184 } };
  };
  const placeholdersData = () => {
    const P = (rule, severity, title, why, fix, path, line) => ({ ...F(rule, severity, 'placeholder', title, why, fix, path, line) });
    const findings = [
      P('mock-auth', 'high', 'Auth check always returns true', 'Every request passes the check, so the protection is not real.', 'Implement the check (session/token/permission lookup).', 'apps/web/src/lib/guard.ts', 8),
      P('not-implemented', 'high', 'Code path throws "not implemented"', 'Calling this path fails at runtime.', 'Implement it, or make sure nothing reachable calls it.', 'apps/api/src/invoices/export.ts', 17),
      P('empty-handler', 'medium', 'Event handler does nothing', 'The control looks interactive but nothing happens when it is used.', 'Implement the handler or remove/disable the control.', 'apps/web/src/pages/Invoices.tsx', 112),
      P('alert-todo', 'medium', 'Feature replaced by an alert', 'The feature shows a "coming soon/TODO" alert instead of working.', 'Implement the feature or hide the entry point until it exists.', 'apps/web/src/pages/Invoices.tsx', 140),
      P('fake-api', 'medium', 'Request to a placeholder API', 'The call goes to a demo/placeholder endpoint, not the real backend.', 'Point it at the real endpoint (from config) or remove it.', 'apps/web/src/lib/currency.ts', 5),
      P('dead-link', 'low', 'Link or button points to "#"', 'Clicking it goes nowhere (or jumps to the top of the page).', 'Give it a real destination, or use a <button> with a handler.', 'apps/web/src/components/Footer.tsx', 21),
      P('lorem', 'low', 'Lorem ipsum text', 'Placeholder copy ends up in front of users.', 'Replace it with real content.', 'apps/web/src/pages/Pricing.tsx', 44),
      P('demo-data', 'low', 'Hard-coded demo data in app code', 'The UI may show fixed sample data instead of real data.', 'Load the data from the real source; keep samples in tests/fixtures.', 'apps/web/src/pages/Dashboard.tsx', 9),
    ];
    return { generatedAt: now, count: findings.length, counts: { high: 2, medium: 3, low: 3 }, findings, scanned: { files: 412, scanned: 412, skipped: 3, truncated: false, ms: 184 } };
  };

  const report = (base = 'HEAD') => {
    const cs = checks();
    const s = scope();
    const criteria = s.tasks.flatMap((t) => t.criteria.map((c) => ({ ...c, task: { id: t.id, title: t.title, status: t.status } })));
    const files = base === 'HEAD' ? changed : [...changed, { path: 'apps/api/src/db.ts', status: 'M', added: 6, removed: 2 }];
    return {
      generatedAt: now, base, head, git: { available: true, error: null }, verdict: 'failing',
      reasons: [
        { level: 'err', code: 'check-failed', text: 'pnpm run test failed (2 failing)' },
        { level: 'err', code: 'criteria-failed', text: '2 acceptance criteria have failing tests' },
        { level: 'warn', code: 'check-never', text: 'pnpm run build has never run here' },
        { level: 'warn', code: 'check-stale', text: 'pnpm run lint ran before the latest changes' },
        { level: 'warn', code: 'criteria-incomplete', text: '1 criterion is not done' },
        { level: 'warn', code: 'criteria-untested', text: '2 criteria have no test evidence' },
        { level: 'ok', code: 'check-passed', text: 'pnpm run typecheck passed' },
      ],
      changedFiles: files, totals: { files: files.length, added: files.reduce((a, f) => a + f.added, 0), removed: files.reduce((a, f) => a + f.removed, 0) },
      checks: cs, criteria, criteriaSummary: summarize(criteria),
      failures: latest('pnpm:test').failures.map((f) => ({ check: 'pnpm:test', kind: 'test', run: 'r00mock0004a1b2c3', ...f })),
      evidence: base === 'HEAD' ? [] : [{ kind: 'commit', ref: hex('c1'), label: `${hex('c1', 7)} feat(api): cursor pagination for invoices`, at: now - 5 * H }],
      run: runGate(), override: override(),
    };
  };

  return {
    '/api/ship/summary': () => {
      const r = readinessData();
      const s = scope();
      return { generatedAt: now, verdict: 'failing', reasons: report().reasons, readiness: { ready: r.ready, blockers: r.blockers, counts: r.counts }, placeholders: { count: 8, counts: { high: 2, medium: 3, low: 3 } },
        lastRuns: ['pnpm:test', 'pnpm:typecheck', 'pnpm:lint'].map((c) => summaryRun(latest(c))), scope: { tasks: s.tasks.length, ...s.totals }, changed: report().totals };
    },
    '/api/ship/checks': () => ({ checks: checks(), run: runGate() }),
    '/api/ship/runs': () => ({ runs: runs.map(summaryRun) }),
    '/api/ship/run': (q) => {
      const r = runs.find((x) => x.id === q.id);
      if (!q.id || !/^r[0-9a-z]{6,40}$/.test(q.id)) throw badReq('invalid run id');
      if (!r) throw notFound('run not found');
      const admin = role() === 'admin';
      const log = r.failed ? ` RUN  v2.1.0 /work/app\n\n ✓ invoices > paginates with a cursor\n ✕ invoices > returns an empty page past the end\n ✕ auth > rate limits login attempts\n\n Tests  ${r.failed} failed | ${r.passed} passed (${r.passed + r.failed})\n` : `$ ${r.command}\ndone\n`;
      return { ...r, log: admin ? log : '', logHidden: !admin };
    },
    '/api/ship/report': (q) => report(q.base || 'HEAD'),
    '/api/ship/scope': (q) => {
      const s = scope();
      if (q.task) {
        const t = s.tasks.find((x) => x.id === q.task);
        if (!t) throw notFound('task not found');
        return { tasks: [t], totals: { tasks: 1, ...t.summary }, override: override() };
      }
      return { ...s, override: override() };
    },
    '/api/ship/readiness': () => readinessData(),
    '/api/ship/placeholders': () => placeholdersData(),
  };
}
