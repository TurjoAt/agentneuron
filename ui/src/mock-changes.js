// Mock routes for Change review (agent B). Synthetic data only.
// mock.js merges these: changesRoutes({ role, sessions, files, commits }).
// `?role=viewer` exercises the admin-only checkpoint diff (403).
//
// The checkpoint actions are not in mock.js MOCK_ACTIONS yet; CHANGES_MOCK_ACTIONS, changesMockPreview and
// changesMockApply below are ready to be wired into MOCK_ACTIONS / preview() / applyEffects() there.

const MIN = 60_000;
const H = 60 * MIN;
const forbidden = (m) => Object.assign(new Error(m), { status: 403 });
const notFound = (m) => Object.assign(new Error(m), { status: 404 });
const bad = (m) => Object.assign(new Error(m), { status: 400 });
const clone = (v) => JSON.parse(JSON.stringify(v));
const R = (code, severity, message, line = null, side = 'new') => ({ code, severity, message, line, side });

const REVIEW_FILES = [
  { path: 'apps/api/src/auth/session.ts', status: 'M', added: 6, removed: 14, kind: 'source', group: 'refactor', risk: 'high',
    reasons: [R('area', 'medium', 'Touches authentication / sessions'), R('removed-check', 'high', 'Removed an authentication / permission condition', 42, 'old'), R('removed-check', 'high', 'Removed a 401/403 response', 44, 'old'), R('tests-not-updated', 'low', 'Has tests, but none of them changed')],
    hunks: [{ oldStart: 38, newStart: 38, added: 2, removed: 9, risk: 'high', codes: ['removed-check'] }, { oldStart: 80, newStart: 73, added: 4, removed: 5, risk: 'low', codes: [] }], tests: ['apps/api/test/session.test.ts'], missingTest: false },
  { path: 'apps/api/src/billing/refunds.ts', status: 'M', added: 48, removed: 12, kind: 'source', group: 'feature', risk: 'high',
    reasons: [R('area', 'medium', 'Touches payments / billing'), R('secret-added', 'high', 'Stripe secret key added', 17), R('risky-api', 'medium', 'Uses a dangerous API (eval, raw HTML, shell or raw SQL)', 61)],
    hunks: [{ oldStart: 10, newStart: 10, added: 20, removed: 4, risk: 'high', codes: ['secret-added'] }, { oldStart: 50, newStart: 58, added: 28, removed: 8, risk: 'medium', codes: ['risky-api'] }], tests: [], missingTest: true },
  { path: 'apps/api/test/checkout.test.ts', status: 'M', added: 3, removed: 1, kind: 'tests', group: 'tests', risk: 'high',
    reasons: [R('disabled-test', 'high', 'Skips or disables a test', 88)], hunks: [{ oldStart: 86, newStart: 86, added: 3, removed: 1, risk: 'high', codes: ['disabled-test'] }], tests: [], missingTest: false },
  { path: 'apps/api/src/server.ts', status: 'M', added: 4, removed: 1, kind: 'source', group: 'refactor', risk: 'medium',
    reasons: [R('widened-permission', 'medium', 'Allows any origin (CORS *)', 23), R('missing-test', 'low', 'No test file found for this source file')], hunks: [{ oldStart: 20, newStart: 20, added: 4, removed: 1, risk: 'medium', codes: ['widened-permission'] }], tests: [], missingTest: true },
  { path: 'database/migrations/2026_10_27_120000_add_refund_reason.php', status: 'A', untracked: true, added: 31, removed: 0, kind: 'source', group: 'feature', risk: 'medium',
    reasons: [R('area', 'medium', 'Touches database migrations / schema')], hunks: [{ oldStart: 0, newStart: 1, added: 31, removed: 0, risk: 'low', codes: [] }], tests: [], missingTest: false },
  { path: '.github/workflows/deploy.yml', status: 'M', added: 5, removed: 2, kind: 'config', group: 'config', risk: 'medium',
    reasons: [R('area', 'medium', 'Touches infrastructure / CI')], hunks: [{ oldStart: 30, newStart: 30, added: 5, removed: 2, risk: 'low', codes: [] }], tests: [], missingTest: false },
  { path: 'package.json', status: 'M', added: 2, removed: 1, kind: 'deps', group: 'deps', risk: 'medium',
    reasons: [R('area', 'medium', 'Touches dependency manifest')], hunks: [{ oldStart: 18, newStart: 18, added: 2, removed: 1, risk: 'low', codes: [] }], tests: [], missingTest: false },
  { path: 'pnpm-lock.yaml', status: 'M', added: 64, removed: 20, kind: 'deps', group: 'deps', risk: 'low', reasons: [R('lockfile', 'low', 'Lockfile changed: dependency versions moved')], hunks: [], tests: [], missingTest: false },
  { path: 'apps/web/src/components/RefundDialog.svelte', status: 'A', untracked: true, added: 112, removed: 0, kind: 'source', group: 'feature', risk: 'low',
    reasons: [R('missing-test', 'low', 'No test file found for this source file')], hunks: [{ oldStart: 0, newStart: 1, added: 112, removed: 0, risk: 'low', codes: [] }], tests: [], missingTest: true },
  { path: 'apps/web/src/lib/format.ts', status: 'M', added: 3, removed: 3, kind: 'source', group: 'refactor', risk: 'low', reasons: [], hunks: [{ oldStart: 12, newStart: 12, added: 3, removed: 3, risk: 'low', codes: [] }], tests: ['apps/web/src/lib/format.test.ts'], missingTest: false },
  { path: 'docs/refunds.md', status: 'A', untracked: true, added: 40, removed: 0, kind: 'docs', group: 'docs', risk: 'low', reasons: [], hunks: [], tests: [], missingTest: false },
];

function review(q) {
  const files = clone(REVIEW_FILES);
  const summary = { files: files.length, added: 0, removed: 0, high: 0, medium: 0, low: 0, missingTests: 0 };
  for (const f of files) { summary.added += f.added; summary.removed += f.removed; summary[f.risk]++; if (f.missingTest) summary.missingTests++; }
  const ORDER = ['feature', 'refactor', 'config', 'deps', 'tests', 'docs'];
  const groups = ORDER.map((kind) => ({ kind, files: files.filter((f) => f.group === kind).map((f) => f.path) })).filter((g) => g.files.length);
  const readFirst = files.filter((f) => (f.risk !== 'low' && f.kind !== 'deps') || f.risk === 'high').slice(0, 8).map((f) => f.path);
  return { available: true, base: q.base || 'HEAD', head: null, generatedAt: Date.now(), summary, groups, files, readFirst, truncated: false };
}

function impact(q) {
  const paths = (q.paths || '').split(',').map((s) => s.trim()).filter(Boolean);
  const target = paths[0] || 'apps/api/src/billing/refunds.ts';
  const F = (p, extra = {}) => ({ id: `file:${p}`, kind: p.includes('/test/') || /\.test\./.test(p) ? 'test' : 'file', label: p.slice(p.lastIndexOf('/') + 1), path: p, ...extra });
  const S = (name, line, extra = {}) => ({ id: `sym:${target}#${name}`, kind: 'symbol', label: name, path: target, symbolKind: 'function', line, removed: false, ...extra });
  const nodes = [
    F(target, { changed: true }), F('apps/api/src/auth/session.ts', { changed: true }),
    S('issueRefund', 24), S('refundableAmount', 61), S('RefundReason', 8, { symbolKind: 'type' }), S('legacyRefund', 90, { removed: true }),
    { id: 'sym:apps/api/src/auth/session.ts#requireUser', kind: 'symbol', label: 'requireUser', path: 'apps/api/src/auth/session.ts', symbolKind: 'function', line: 38, removed: false },
    F('apps/api/src/routes/refunds.ts'), F('apps/api/src/webhooks/stripe.ts'), F('apps/api/src/jobs/reconcile.ts'), F('apps/web/src/lib/api.ts'),
    F('apps/api/src/routes/orders.ts'), F('apps/api/src/routes/admin.ts'), F('apps/api/test/refunds.test.ts'), F('apps/api/test/session.test.ts'),
    { id: 'route:POST /api/orders/:id/refund', kind: 'route', label: 'POST /api/orders/:id/refund', path: 'apps/api/src/routes/refunds.ts', method: 'POST', uri: '/api/orders/:id/refund' },
    { id: 'route:GET /api/refunds', kind: 'route', label: 'GET /api/refunds', path: 'apps/api/src/routes/refunds.ts', method: 'GET', uri: '/api/refunds' },
    { id: 'route:ANY /api/admin', kind: 'route', label: '/api/admin', path: 'apps/api/src/routes/admin.ts', method: 'ANY', uri: '/api/admin' },
    { id: 'contract:docs/openapi.yaml', kind: 'contract', label: 'openapi.yaml', path: 'docs/openapi.yaml' },
  ];
  const E = (from, to, kind) => ({ from, to, kind });
  const t = `file:${target}`;
  const edges = [
    E(t, `sym:${target}#issueRefund`, 'defines'), E(t, `sym:${target}#refundableAmount`, 'defines'), E(t, `sym:${target}#RefundReason`, 'defines'), E(t, `sym:${target}#legacyRefund`, 'defines'),
    E('file:apps/api/src/auth/session.ts', 'sym:apps/api/src/auth/session.ts#requireUser', 'defines'),
    E('file:apps/api/src/routes/refunds.ts', `sym:${target}#issueRefund`, 'calls'), E('file:apps/api/src/routes/refunds.ts', t, 'imports'),
    E('file:apps/api/src/webhooks/stripe.ts', `sym:${target}#refundableAmount`, 'calls'), E('file:apps/api/src/webhooks/stripe.ts', t, 'imports'),
    E('file:apps/api/src/jobs/reconcile.ts', t, 'imports'), E('file:apps/web/src/lib/api.ts', `sym:${target}#RefundReason`, 'calls'),
    E('file:apps/api/src/routes/orders.ts', 'sym:apps/api/src/auth/session.ts#requireUser', 'calls'), E('file:apps/api/src/routes/admin.ts', 'sym:apps/api/src/auth/session.ts#requireUser', 'calls'),
    E('file:apps/api/test/refunds.test.ts', t, 'covers'), E('file:apps/api/test/session.test.ts', 'file:apps/api/src/auth/session.ts', 'covers'),
    E('route:POST /api/orders/:id/refund', 'file:apps/api/src/routes/refunds.ts', 'serves'), E('route:GET /api/refunds', 'file:apps/api/src/routes/refunds.ts', 'serves'),
    E('route:ANY /api/admin', 'file:apps/api/src/routes/admin.ts', 'serves'), E('contract:docs/openapi.yaml', 'route:POST /api/orders/:id/refund', 'documents'),
  ];
  const A = (kind, label, path, confidence, via) => ({ kind, label, path, confidence, via });
  const affected = [
    A('file', 'apps/api/src/routes/refunds.ts', 'apps/api/src/routes/refunds.ts', 'high', `calls issueRefund from ${target}`),
    A('file', 'apps/api/src/webhooks/stripe.ts', 'apps/api/src/webhooks/stripe.ts', 'high', `calls refundableAmount from ${target}`),
    A('file', 'apps/api/src/routes/orders.ts', 'apps/api/src/routes/orders.ts', 'high', 'calls requireUser from apps/api/src/auth/session.ts'),
    A('file', 'apps/api/src/routes/admin.ts', 'apps/api/src/routes/admin.ts', 'high', 'calls requireUser from apps/api/src/auth/session.ts'),
    A('test', 'apps/api/test/refunds.test.ts', 'apps/api/test/refunds.test.ts', 'high', `imports ${target}`),
    A('route', 'POST /api/orders/:id/refund', 'apps/api/src/routes/refunds.ts', 'medium', `defined in apps/api/src/routes/refunds.ts, which imports ${target}`),
    A('route', 'GET /api/refunds', 'apps/api/src/routes/refunds.ts', 'medium', `defined in apps/api/src/routes/refunds.ts, which imports ${target}`),
    A('route', 'ANY /api/admin', 'apps/api/src/routes/admin.ts', 'medium', 'defined in apps/api/src/routes/admin.ts, which imports apps/api/src/auth/session.ts'),
    A('contract', 'docs/openapi.yaml', 'docs/openapi.yaml', 'medium', 'documents /api/orders/{id}/refund'),
    A('contract', 'type RefundReason', target, 'medium', `exported from ${target}`),
    A('file', 'apps/api/src/jobs/reconcile.ts', 'apps/api/src/jobs/reconcile.ts', 'medium', `imports ${target}`),
    A('test', 'apps/api/test/session.test.ts', 'apps/api/test/session.test.ts', 'medium', 'named after apps/api/src/auth/session.ts'),
    A('file', 'apps/web/src/lib/api.ts', 'apps/web/src/lib/api.ts', 'low', 'mentions RefundReason (no import found)'),
  ];
  return {
    available: true,
    changed: [
      { path: target, status: 'M', symbols: [{ name: 'issueRefund', kind: 'function', line: 24, exported: true }, { name: 'refundableAmount', kind: 'function', line: 61, exported: true }, { name: 'RefundReason', kind: 'type', line: 8, exported: true }, { name: 'legacyRefund', kind: 'function', line: 90, exported: false, removed: true }] },
      { path: 'apps/api/src/auth/session.ts', status: 'M', symbols: [{ name: 'requireUser', kind: 'function', line: 38, exported: true }] },
    ],
    nodes, edges, affected, truncated: false, stats: { indexed: 812, changed: 2, importers: 6 },
  };
}

// ---- checkpoints (in-memory) -------------------------------------------------------
const now = Date.now();
const base = 'c0ffee1234567890abcdef1234567890abcdef12';
let checkpoints = [
  { id: '20261027-101500000-a1b2c3', label: 'before refund refactor', createdAt: now - 2 * H, base, files: ['apps/api/src/billing/refunds.ts', 'apps/api/src/auth/session.ts', 'docs/refunds.md'], source: 'manual', task: 'T-142', session: null, branch: 'feat/refunds' },
  { id: '20261027-093000000-d4e5f6', label: 'before restoring 1 file(s) from 20261026-171200000-0a0b0c', createdAt: now - 3 * H, base, files: ['apps/api/src/server.ts'], source: 'auto', task: null, session: null, branch: 'feat/refunds' },
  { id: '20261026-171200000-0a0b0c', label: 'green tests', createdAt: now - 20 * H, base: 'badc0ffee0123456789abcdef0123456789abcd', files: ['apps/api/src/server.ts', 'apps/web/src/lib/format.ts'], source: 'task', task: 'T-139', session: null, branch: 'feat/refunds' },
].map((c) => ({ ...c, ref: `refs/agentneuron/checkpoints/${c.id}`, hash: c.id.replace(/\D/g, '').padEnd(40, '0').slice(0, 40), filesTruncated: false }));
const CP_FILES = {
  '20261027-101500000-a1b2c3': [
    { path: 'apps/api/src/billing/refunds.ts', status: 'changed', added: 48, removed: 12 },
    { path: 'apps/api/src/auth/session.ts', status: 'changed', added: 6, removed: 14 },
    { path: 'apps/web/src/components/RefundDialog.svelte', status: 'added', added: 0, removed: 0 },
    { path: 'apps/api/src/billing/legacy.ts', status: 'deleted', added: 0, removed: 0 },
    { path: 'docs/refunds.md', status: 'same', added: 0, removed: 0 },
  ],
};
const BEFORE = 'export async function issueRefund(order, amount) {\n  if (!order.paid) throw new Error("not paid");\n  const max = refundableAmount(order);\n  if (amount > max) throw new Error("too much");\n  return stripe.refunds.create({ payment_intent: order.intent, amount });\n}\n';
const AFTER = 'export async function issueRefund(order, amount, reason = "requested_by_customer") {\n  const max = refundableAmount(order);\n  return stripe.refunds.create({ payment_intent: order.intent, amount: Math.min(amount, max), reason });\n}\n';

function cpFiles(id) {
  const c = checkpoints.find((x) => x.id === id);
  if (!c) throw notFound('checkpoint not found');
  if (!CP_FILES[id]) CP_FILES[id] = c.files.map((p, i) => ({ path: p, status: i % 2 ? 'same' : 'changed', added: i % 2 ? 0 : 3, removed: i % 2 ? 0 : 1 }));
  return CP_FILES[id];
}

export const CHANGES_MOCK_ACTIONS = [
  { id: 'changes.checkpoint.create', title: 'Create checkpoint', category: 'changes', level: 'edit', description: 'Snapshot the working tree (tracked and untracked files) as a git ref.', params: { label: { type: 'string', label: 'Label' } } },
  { id: 'changes.checkpoint.restore', title: 'Restore files from checkpoint', category: 'changes', level: 'danger', description: 'Restore only the chosen paths; an undo checkpoint is taken first.', params: { id: { type: 'string', required: true, label: 'Checkpoint id' }, paths: { type: 'string[]', required: true, label: 'Paths' } } },
  { id: 'changes.checkpoint.delete', title: 'Delete checkpoint', category: 'changes', level: 'edit', description: 'Delete one checkpoint ref.', params: { id: { type: 'string', required: true, label: 'Checkpoint id' } } },
  { id: 'changes.checkpoint.prune', title: 'Prune checkpoints', category: 'changes', level: 'edit', description: 'Keep the newest N checkpoints.', params: { keep: { type: 'number', default: 20, label: 'Keep newest' } } },
];
function restorePlan(p) {
  const files = cpFiles(p.id);
  return (p.paths || []).map((path) => {
    const f = files.find((x) => x.path === path);
    const action = !f || f.status === 'same' ? 'skip' : f.status === 'added' ? 'delete' : f.status === 'deleted' ? 'create' : 'overwrite';
    return action === 'skip' ? { path, action, reason: 'unchanged since the checkpoint' } : { path, action };
  });
}
/** -> { command, summary, files? } | null for ids this module does not own */
export function changesMockPreview(id, p = {}) {
  if (id === 'changes.checkpoint.create') return { command: ['git', 'update-ref', 'refs/agentneuron/checkpoints/<new id>', '<snapshot of the working tree>'], summary: `Create checkpoint${p.label ? ` "${p.label}"` : ''}` };
  if (id === 'changes.checkpoint.restore') { const files = restorePlan(p); return { command: ['restore', p.id, '--', ...files.filter((f) => f.action !== 'skip').map((f) => f.path)], summary: 'Restore the chosen files; an undo checkpoint is taken first', files }; }
  if (id === 'changes.checkpoint.delete') return { command: ['git', 'update-ref', '-d', `refs/agentneuron/checkpoints/${p.id}`], summary: `Delete checkpoint ${p.id}` };
  if (id === 'changes.checkpoint.prune') return { command: null, summary: `Keep the newest ${p.keep ?? 20} checkpoints` };
  return null;
}
function newCp(label, source) {
  const iso = new Date().toISOString();
  const id = `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 23).replace(/[:.]/g, '')}-${Math.random().toString(16).slice(2, 8)}`;
  const c = { id, ref: `refs/agentneuron/checkpoints/${id}`, hash: Math.random().toString(16).slice(2).padEnd(40, '0').slice(0, 40), label, createdAt: Date.now(), base, files: REVIEW_FILES.slice(0, 4).map((f) => f.path), filesTruncated: false, source, task: null, session: null, branch: 'feat/refunds' };
  checkpoints = [c, ...checkpoints];
  return c;
}
/** Apply a checkpoint action to the in-memory state -> job result (null for ids this module does not own). */
export function changesMockApply(id, p = {}) {
  if (id === 'changes.checkpoint.create') return { ...newCp(p.label || '', 'manual'), skipped: [] };
  if (id === 'changes.checkpoint.restore') {
    const plan = restorePlan(p);
    const undo = newCp(`before restoring ${plan.filter((f) => f.action !== 'skip').length} file(s) from ${p.id}`, 'auto');
    const files = cpFiles(p.id);
    for (const f of plan) { const x = files.find((y) => y.path === f.path); if (x && f.action !== 'skip') Object.assign(x, { status: 'same', added: 0, removed: 0 }); }
    return { restored: plan.filter((f) => f.action !== 'skip'), skipped: plan.filter((f) => f.action === 'skip'), undo: { id: undo.id, ref: undo.ref } };
  }
  if (id === 'changes.checkpoint.delete') { checkpoints = checkpoints.filter((c) => c.id !== p.id); return { id: p.id, deleted: true }; }
  if (id === 'changes.checkpoint.prune') { const keep = Number(p.keep ?? 20); const gone = checkpoints.slice(keep).map((c) => c.id); checkpoints = checkpoints.slice(0, keep); return { kept: checkpoints.length, deleted: gone }; }
  return null;
}

// ---- packages ----------------------------------------------------------------------
const POPULAR = { npm: ['react', 'react-dom', 'express', 'lodash', 'axios', 'zod', 'vite', 'vitest', 'stripe', 'dayjs', 'next', 'svelte', 'typescript'], packagist: ['laravel/framework', 'guzzlehttp/guzzle', 'stripe/stripe-php'], pypi: ['requests', 'django', 'fastapi', 'numpy', 'pandas'] };
const ECO = { npm: 'npm', pnpm: 'npm', yarn: 'npm', bun: 'npm', composer: 'packagist', pip: 'pypi', poetry: 'pypi' };
function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[b.length];
}
const FINDINGS = [
  { severity: 'high', manager: 'pnpm', name: 'stripe-node-sdk', version: '^2.1.0', code: 'suffix-clone', message: 'Name adds a prefix/suffix to the popular package "stripe"', fix: 'Check whether you meant "stripe".', manifest: 'apps/api/package.json' },
  { severity: 'high', manager: 'pnpm', name: 'axois', version: '^1.7.0', code: 'lookalike', message: 'One or two letters away from the popular package "axios" (possible typosquat)', fix: 'Check whether you meant "axios".', manifest: 'apps/web/package.json' },
  { severity: 'medium', manager: 'pnpm', name: 'refund-utils', version: '^0.3.0', code: 'not-in-lockfile', message: 'Declared in apps/api/package.json but missing from pnpm-lock.yaml', fix: 'Run the install command so pnpm-lock.yaml pins it, then review the lockfile diff.', manifest: 'apps/api/package.json' },
  { severity: 'medium', manager: 'pnpm', name: 'ui-kit', version: 'github:acme-internal/ui-kit', code: 'url-dep', message: 'Installed from a git repository / URL instead of the registry', fix: 'Prefer a published registry version so the lockfile pins an integrity hash.', manifest: 'apps/web/package.json' },
  { severity: 'medium', manager: 'pnpm', name: 'date-helpers', version: 'latest', code: 'unpinned', message: 'Tracks the "latest" tag: any new release is installed', fix: 'Pin a version range (e.g. ^1.2.3) so a compromised new release is not picked up silently.', manifest: 'package.json' },
  { severity: 'low', manager: 'pnpm', name: 'esbuild', version: null, code: 'install-script', message: 'Runs an install script when installed', fix: 'Expected for native modules; otherwise consider --ignore-scripts or an allow-list.', manifest: 'pnpm-lock.yaml' },
  { severity: 'low', manager: 'pnpm', name: 'sharp', version: null, code: 'install-script', message: 'Runs an install script when installed', fix: 'Expected for native modules; otherwise consider --ignore-scripts or an allow-list.', manifest: 'pnpm-lock.yaml' },
].map((f) => ({ id: `${f.code}:${f.manager}:${f.name}`, ...f }));

function checkOne(q) {
  const manager = q.manager, name = String(q.name || '').trim();
  if (!ECO[manager]) throw bad(`unknown manager: ${manager}`);
  if (!name || !/^[@\w./-]+$/.test(name)) throw bad(`invalid package name for ${manager}: ${name}`);
  const pop = POPULAR[ECO[manager]];
  const reasons = [];
  let verdict = 'unknown';
  if (pop.includes(name)) { reasons.push({ code: 'popular', severity: 'info', message: 'On the bundled list of widely used packages' }); verdict = 'ok'; }
  else {
    const near = pop.find((p) => lev(p, name) <= (name.length >= 8 ? 2 : 1) || name.replace(/(-js|js-|-node)$/, '') === p);
    if (near) { reasons.push({ code: 'lookalike', severity: 'high', message: `One or two letters away from the popular package "${near}" (possible typosquat)`, fix: `Did you mean "${near}"?` }); verdict = 'block'; }
    else reasons.push({ code: 'offline', severity: 'info', message: 'Not on the bundled list and not in this project; registry lookups are off (packages.online)' });
  }
  if (q.version === 'latest' || q.version === '*') { reasons.push({ code: 'unpinned', severity: 'medium', message: 'Any version is accepted', fix: 'Pin a version range.' }); if (verdict !== 'block') verdict = 'warn'; }
  return { manager, name, version: q.version || null, ecosystem: ECO[manager], verdict, reasons, known: { popular: verdict === 'ok', inManifest: false, inLockfile: false }, registry: null, online: false };
}

export function changesRoutes(deps = {}) {
  const role = () => (typeof deps.role === 'function' ? deps.role() : 'admin');
  return {
    '/api/changes/review': (q = {}) => review(q),
    '/api/changes/impact': (q = {}) => impact(q),
    '/api/changes/checkpoints': () => ({ checkpoints: clone(checkpoints) }),
    '/api/changes/checkpoint': ({ id } = {}) => {
      const c = checkpoints.find((x) => x.id === id);
      if (!c) throw notFound('checkpoint not found');
      return { checkpoint: clone(c), files: clone(cpFiles(id)), truncated: false };
    },
    '/api/changes/checkpoint/diff': ({ id, path } = {}) => {
      if (role() !== 'admin') throw forbidden('checkpoint file content is admin-only (live.viewerDiffs)');
      const f = cpFiles(id).find((x) => x.path === path);
      if (!f) throw notFound('not in this checkpoint');
      return { path, before: f.status === 'added' ? null : BEFORE, after: f.status === 'deleted' ? null : AFTER, binary: false, truncated: false };
    },
    '/api/changes/packages': () => ({ online: false, deps: 64, findings: clone(FINDINGS), lockfiles: ['pnpm-lock.yaml'], onlineChecked: 0 }),
    '/api/changes/package': (q = {}) => checkOne(q),
  };
}
