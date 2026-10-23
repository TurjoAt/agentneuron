// Mock routes for UI-B endpoints (owner: UI-B). mock.js (UI-A) merges these:
//
//   import { insightRoutes } from './mock-insight.js';
//   Object.assign(routes, insightRoutes({ graph, files: filesList, sessions: () => sessions, health }));
//   ...and call handlers as  fn(params || {}, init)  so POST bodies reach them.
//
// Every ctx accessor is optional; without ctx the data falls back to the seed.
// Data is deterministic per time bucket (stable across reloads) yet trends and
// fluctuates like a real project.

import { SEED, PROJECT, sessions as seedSessions } from './mock-data.js';

const H = 3600_000;
const DAY = 24 * H;

// ---------------------------------------------------------------- deterministic noise
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
const noise = (...k) => hash(k.join('|'));
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** activity factor for a moment in time: work hours, weekdays, gentle growth */
function activity(ts) {
  const d = new Date(ts);
  const h = d.getHours();
  const wd = d.getDay();
  const hour = h >= 8 && h <= 19 ? 1 - Math.abs(h - 13.5) / 9 : h >= 20 && h <= 23 ? 0.25 : 0.06;
  const week = wd === 0 || wd === 6 ? 0.35 : 1;
  const growth = 1 + Math.max(0, 1 - (Date.now() - ts) / (120 * DAY)) * 0.6;
  return { hour, week, growth };
}

const BUCKET_MS = { hour: H, day: DAY, week: 7 * DAY };

function bucketsFor(from, to, bucket) {
  const ms = BUCKET_MS[bucket] || DAY;
  const out = [];
  const start = new Date(from);
  if (bucket === 'hour') start.setMinutes(0, 0, 0);
  else start.setHours(0, 0, 0, 0);
  if (bucket === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  for (let t = start.getTime(); t <= to; t += ms) out.push(t);
  return out;
}

const SPLITS = {
  tool: [['claude', 0.42], ['codex', 0.2], ['cursor', 0.12], ['copilot', 0.06], ['generic', 0.2]],
  kind: [['context', 0.22], ['plan', 0.18], ['doc', 0.24], ['todo', 0.14], ['rules', 0.1], ['agent', 0.06], ['decision', 0.06]],
  author: [['Maja Lind', 0.3], ['Jonas Ek', 0.22], ['Claude', 0.26], ['Codex', 0.14], ['Ola Berg', 0.08]],
  session: [['Implement PaymentIntent module', 0.38], ['Review docs for stale commands', 0.2], ['Add webhook retry docs', 0.24], ['Release 2.14.0', 0.08], ['Refactor cart service', 0.1]],
};

/** count-like metric per bucket */
function countAt(metric, ts, bucket, key = '', scale = 1) {
  const { hour, week, growth } = activity(ts);
  const base = { changes: 9, commits: 1.4, agents: 6, opened: 1.3, closed: 1.1, added: 60, removed: 22 }[metric] || 5;
  const n = noise(metric, key, Math.floor(ts / (BUCKET_MS[bucket] || DAY)), bucket);
  const burst = n > 0.92 ? 2.4 : 1;
  let v;
  if (bucket === 'hour') v = base * 0.5 * hour * week * growth * (0.4 + n * 1.3) * burst;
  else v = base * 6 * week * growth * (0.45 + n * 1.1) * burst * (bucket === 'week' ? 6.2 : 1);
  return Math.max(0, Math.round(v * scale));
}

function levelAt(metric, ts, key = '') {
  const age = (Date.now() - ts) / DAY;
  if (metric === 'tokens') {
    const share = { claude: 0.46, codex: 0.2, cursor: 0.12, copilot: 0.08, windsurf: 0.04, gemini: 0.04, generic: 0.06 }[key] ?? 1;
    const t = 41800 - age * 92 + Math.sin(age / 4) * 600 + (noise('tok', Math.floor(ts / (6 * H))) - 0.5) * 380;
    return Math.max(1000, Math.round(t * share));
  }
  if (metric === 'health') {
    const s = 84 - Math.sin(age / 9) * 5 - (age < 3 ? (3 - age) * 1.4 : 0) + (noise('hp', Math.floor(ts / (4 * H))) - 0.5) * 4;
    return Math.max(40, Math.min(100, Math.round(s)));
  }
  return 0;
}

function series({ from, to, bucket = 'day', metric = 'changes', split = 'none' }) {
  from = +from || Date.now() - 7 * DAY;
  to = +to || Date.now();
  const buckets = bucketsFor(from, to, bucket);
  const level = metric === 'tokens' || metric === 'health';
  const counts = (key, scale, sub = metric) => buckets.map((t) => countAt(sub, t, bucket, key, scale));
  let out;
  if (metric === 'lines') out = [{ key: 'added', values: counts('', 1, 'added') }, { key: 'removed', values: counts('', 1, 'removed') }];
  else if (metric === 'tasks') out = [{ key: 'opened', values: counts('', 1, 'opened') }, { key: 'closed', values: counts('', 1, 'closed') }];
  else if (level) {
    if (metric === 'tokens' && split === 'tool') out = ['claude', 'codex', 'cursor', 'copilot', 'generic'].map((k) => ({ key: k, values: buckets.map((t) => levelAt('tokens', t + (BUCKET_MS[bucket] || DAY) - 1, k)) }));
    else out = [{ key: metric, values: buckets.map((t) => levelAt(metric, Math.min(Date.now(), t + (BUCKET_MS[bucket] || DAY) - 1))) }];
  } else if (split !== 'none' && SPLITS[split]) {
    out = SPLITS[split].map(([k, w]) => ({ key: k, values: counts(k, w * 1.15) }));
  } else if (metric === 'agents' && split === 'none') {
    out = [{ key: 'agent edits', values: counts('') }];
  } else out = [{ key: metric, values: counts('') }];
  return { buckets, series: out };
}

function sumSeries(s) {
  return s.series.reduce((a, x) => a + x.values.reduce((b, v) => b + v, 0), 0);
}

function kpisFor(from, to) {
  const bucket = to - from > 3 * DAY ? 'day' : 'hour';
  const q = { from, to, bucket };
  const lines = series({ ...q, metric: 'lines' });
  const tasks = series({ ...q, metric: 'tasks' });
  const tok = series({ ...q, metric: 'tokens' }).series[0].values;
  const hp = series({ ...q, metric: 'health' }).series[0].values;
  const changes = sumSeries(series({ ...q, metric: 'changes' }));
  return {
    changes,
    filesTouched: Math.min(64, Math.round(changes * 0.17) + 4),
    linesAdded: lines.series[0].values.reduce((a, b) => a + b, 0),
    linesRemoved: lines.series[1].values.reduce((a, b) => a + b, 0),
    tokensNow: tok[tok.length - 1],
    tokensDelta: tok[tok.length - 1] - tok[0],
    healthNow: hp[hp.length - 1],
    healthDelta: hp[hp.length - 1] - hp[0],
    tasksOpened: tasks.series[0].values.reduce((a, b) => a + b, 0),
    tasksClosed: tasks.series[1].values.reduce((a, b) => a + b, 0),
    commits: sumSeries(series({ ...q, metric: 'commits' })),
    agentEdits: sumSeries(series({ ...q, metric: 'agents' })),
    activeSessions: Math.max(1, Math.round(((to - from) / DAY) * 1.6 * (0.7 + noise('ses', Math.floor(from / DAY)) * 0.6))),
  };
}

// ---------------------------------------------------------------- tiny line diff
function lineDiff(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hunks = [];
  let i = 0, j = 0, added = 0, removed = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { hunks.push({ type: 'ctx', line: j + 1, text: B[j] }); i++; j++; }
    else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { hunks.push({ type: 'add', line: j + 1, text: B[j] }); j++; added++; }
    else { hunks.push({ type: 'del', line: i + 1, text: A[i] }); i++; removed++; }
  }
  return { added, removed, hunks };
}

// ---------------------------------------------------------------- static fixtures
const PROJECT_INFO = {
  name: 'acme-commerce', description: 'Headless commerce platform — storefront, API and admin.', version: '2.14.0',
  stacks: [
    { id: 'node', name: 'Node.js', version: '22.11', category: 'runtime', confidence: 1, source: '.nvmrc' },
    { id: 'pnpm', name: 'pnpm', version: '9.12.3', category: 'tool', confidence: 1, source: 'package.json#packageManager' },
    { id: 'typescript', name: 'TypeScript', version: '5.6.3', category: 'language', confidence: 1, source: 'tsconfig.json' },
    { id: 'next', name: 'Next.js', version: '15.0.2', category: 'framework', confidence: 1, source: 'apps/web/package.json' },
    { id: 'react', name: 'React', version: '19.0.0-rc', category: 'framework', confidence: 0.95, source: 'apps/web/package.json' },
    { id: 'fastify', name: 'Fastify', version: '5.1.0', category: 'framework', confidence: 1, source: 'apps/api/package.json' },
    { id: 'laravel', name: 'Laravel', version: '11.31', category: 'framework', confidence: 1, source: 'apps/admin/composer.json' },
    { id: 'php', name: 'PHP', version: '8.3', category: 'language', confidence: 1, source: 'apps/admin/composer.json' },
    { id: 'tailwind', name: 'Tailwind CSS', version: '4.0.0-beta', category: 'tool', confidence: 1, source: 'apps/web/tailwind.config.ts' },
    { id: 'turbo', name: 'Turborepo', version: '2.2.3', category: 'tool', confidence: 1, source: 'turbo.json' },
    { id: 'vitest', name: 'Vitest', version: '2.1.4', category: 'testing', confidence: 1, source: 'vitest.workspace.ts' },
    { id: 'playwright', name: 'Playwright', version: '1.48.2', category: 'testing', confidence: 1, source: 'playwright.config.ts' },
    { id: 'pest', name: 'Pest', version: '3.5', category: 'testing', confidence: 0.9, source: 'apps/admin/composer.json' },
    { id: 'drizzle', name: 'Drizzle ORM', version: '0.36.0', category: 'db', confidence: 1, source: 'drizzle.config.ts' },
    { id: 'postgres', name: 'PostgreSQL', version: '16', category: 'db', confidence: 0.8, source: 'docker-compose.yml' },
    { id: 'docker', name: 'Docker Compose', version: null, category: 'infra', confidence: 1, source: 'docker-compose.yml' },
    { id: 'gha', name: 'GitHub Actions', version: null, category: 'ci', confidence: 1, source: '.github/workflows' },
    { id: 'vercel', name: 'Vercel', version: null, category: 'infra', confidence: 0.9, source: 'apps/web/vercel.json' },
    { id: 'eslint', name: 'ESLint', version: '9.14', category: 'tool', confidence: 1, source: 'eslint.config.js' },
    { id: 'prettier', name: 'Prettier', version: '3.3.3', category: 'tool', confidence: 1, source: '.prettierrc' },
    { id: 'husky', name: 'Husky', version: '9.1', category: 'tool', confidence: 1, source: '.husky/' },
    { id: 'ai', name: 'AI tools', version: '6', category: 'ai', confidence: 1, source: 'CLAUDE.md, AGENTS.md, .cursor/…' },
  ],
  manifests: [
    { path: 'package.json', type: 'npm', name: 'acme-commerce', version: '2.14.0', scripts: { dev: 'turbo dev', build: 'turbo build', test: 'turbo test', lint: 'eslint . --cache', 'db:migrate': 'drizzle-kit migrate', typecheck: 'tsc -b', e2e: 'playwright test' },
      deps: [
        ['turbo', '^2.2.3', true], ['typescript', '^5.6.3', true], ['eslint', '^9.14.0', true], ['prettier', '^3.3.3', true], ['husky', '^9.1.6', true], ['lint-staged', '^15.2.10', true],
        ['vitest', '^2.1.4', true], ['@playwright/test', '^1.48.2', true], ['drizzle-kit', '^0.27.1', true], ['zod', '^3.23.8', false], ['dotenv', '^16.4.5', false],
      ].map(([name, version, dev]) => ({ name, version, dev, manager: 'npm' })) },
    { path: 'apps/web/package.json', type: 'npm', name: '@acme/web', version: '2.14.0', scripts: { dev: 'next dev --turbo', build: 'next build', start: 'next start' },
      deps: [['next', '15.0.2', false], ['react', '19.0.0-rc-69d4b800-20241021', false], ['react-dom', '19.0.0-rc-69d4b800-20241021', false], ['@acme/ui', 'workspace:*', false], ['@tanstack/react-query', '^5.59.16', false], ['stripe', '^17.3.0', false], ['tailwindcss', '4.0.0-beta.2', true], ['@types/react', '^18.3.12', true]]
        .map(([name, version, dev]) => ({ name, version, dev, manager: 'npm' })) },
    { path: 'apps/api/package.json', type: 'npm', name: '@acme/api', version: '2.14.0', scripts: { dev: 'tsx watch src/server.ts', build: 'tsup', test: 'vitest run' },
      deps: [['fastify', '^5.1.0', false], ['@fastify/cors', '^10.0.1', false], ['drizzle-orm', '^0.36.0', false], ['pg', '^8.13.1', false], ['pino', '^9.5.0', false], ['bullmq', '^5.21.2', false], ['tsx', '^4.19.2', true], ['tsup', '^8.3.5', true]]
        .map(([name, version, dev]) => ({ name, version, dev, manager: 'npm' })) },
    { path: 'apps/admin/composer.json', type: 'composer', name: 'acme/admin', version: '1.8.0', scripts: { test: 'pest', 'post-autoload-dump': '@php artisan package:discover --ansi' },
      deps: [['php', '^8.3', false], ['laravel/framework', '^11.31', false], ['laravel/sanctum', '^4.0', false], ['filament/filament', '^3.2', false], ['spatie/laravel-permission', '^6.10', false], ['pestphp/pest', '^3.5', true], ['laravel/pint', '^1.18', true], ['nunomaduro/collision', '^8.5', true]]
        .map(([name, version, dev]) => ({ name, version, dev, manager: 'composer' })) },
  ],
  packageManagers: [
    { id: 'pnpm', lockfile: 'pnpm-lock.yaml', manifest: 'package.json', available: true },
    { id: 'composer', lockfile: 'apps/admin/composer.lock', manifest: 'apps/admin/composer.json', available: true },
  ],
  env: {
    files: ['.env.example', '.env.local', 'apps/admin/.env.example', 'apps/admin/.env'],
    exampleKeys: ['DATABASE_URL', 'REDIS_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'NEXT_PUBLIC_API_URL', 'SENTRY_DSN', 'RESEND_API_KEY', 'S3_BUCKET', 'APP_KEY'],
    presentKeys: ['DATABASE_URL', 'REDIS_URL', 'STRIPE_SECRET_KEY', 'NEXT_PUBLIC_API_URL', 'S3_BUCKET', 'APP_KEY', 'LOG_LEVEL'],
    missing: ['STRIPE_WEBHOOK_SECRET', 'SENTRY_DSN', 'RESEND_API_KEY'],
    extra: ['LOG_LEVEL'],
  },
  docker: {
    files: ['docker-compose.yml', 'apps/api/Dockerfile', 'apps/admin/Dockerfile'],
    services: [
      { name: 'postgres', image: 'postgres:16-alpine', build: null, ports: ['5433:5432'] },
      { name: 'redis', image: 'redis:7', build: null, ports: ['6379:6379'] },
      { name: 'api', image: null, build: 'apps/api', ports: ['4000:4000'] },
      { name: 'admin', image: null, build: 'apps/admin', ports: ['8080:80'] },
      { name: 'mailpit', image: 'axllent/mailpit', build: null, ports: ['8025:8025', '1025:1025'] },
    ],
  },
  ci: [
    { provider: 'github', path: '.github/workflows/ci.yml', name: 'CI', triggers: ['push', 'pull_request'], jobs: ['lint', 'typecheck', 'test', 'e2e'] },
    { provider: 'github', path: '.github/workflows/release.yml', name: 'Release', triggers: ['push: tags v*'], jobs: ['build', 'publish', 'deploy'] },
    { provider: 'github', path: '.github/workflows/claude.yml', name: 'Claude review', triggers: ['pull_request'], jobs: ['review'] },
  ],
  dotfolders: [
    { name: '.github', purpose: 'GitHub workflows, Copilot instructions', tool: 'copilot', files: 7, bytes: 9_420 },
    { name: '.claude', purpose: 'Claude Code agents, skills, commands, settings', tool: 'claude', files: 6, bytes: 6_880 },
    { name: '.cursor', purpose: 'Cursor rules + MCP config', tool: 'cursor', files: 3, bytes: 2_310 },
    { name: '.codex', purpose: 'Codex config & profiles', tool: 'codex', files: 1, bytes: 640 },
    { name: '.husky', purpose: 'Git hooks (pre-commit: lint-staged)', tool: null, files: 2, bytes: 220 },
    { name: '.vscode', purpose: 'Editor settings & recommended extensions', tool: null, files: 2, bytes: 1_140 },
    { name: '.devcontainer', purpose: 'Dev container definition', tool: null, files: 2, bytes: 1_890 },
    { name: '.turbo', purpose: 'Turborepo cache (generated)', tool: null, files: 412, bytes: 48_200_000 },
    { name: '.next', purpose: 'Next.js build output (generated)', tool: null, files: 1_860, bytes: 212_000_000 },
    { name: '.mdctl', purpose: 'mdctl state: history, metrics, board', tool: null, files: 9, bytes: 1_420_000 },
  ],
  framework: {
    laravel: { version: '11.31.0', routes: 48, migrations: 23, models: 14, providers: 6, root: 'apps/admin' },
    next: { version: '15.0.2', router: 'app', pages: 37, root: 'apps/web' },
    vite: null,
  },
  stats: {
    languages: [
      { lang: 'TypeScript', files: 612, lines: 74_210, bytes: 2_610_000 },
      { lang: 'PHP', files: 238, lines: 21_480, bytes: 812_000 },
      { lang: 'TSX', files: 284, lines: 31_900, bytes: 1_240_000 },
      { lang: 'Markdown', files: 58, lines: 4_870, bytes: 186_000 },
      { lang: 'Blade', files: 41, lines: 3_120, bytes: 118_000 },
      { lang: 'CSS', files: 12, lines: 1_480, bytes: 41_000 },
      { lang: 'SQL', files: 23, lines: 1_130, bytes: 38_000 },
      { lang: 'YAML', files: 19, lines: 860, bytes: 24_000 },
      { lang: 'JSON', files: 44, lines: 2_940, bytes: 96_000 },
      { lang: 'Shell', files: 7, lines: 310, bytes: 9_000 },
    ],
    totalFiles: 1_338, totalLines: 142_300,
    largest: [
      ['pnpm-lock.yaml', 812_000], ['apps/admin/composer.lock', 412_000], ['apps/web/public/hero.webp', 388_000], ['apps/api/src/modules/orders/service.ts', 48_200],
      ['apps/web/app/(shop)/checkout/page.tsx', 41_700], ['packages/ui/src/DataTable.tsx', 36_900], ['apps/admin/app/Filament/Resources/OrderResource.php', 31_200], ['docs/api.md', 18_400],
    ].map(([path, bytes]) => ({ path, bytes })),
    dirs: [
      ['apps/web', 418, 3_920_000], ['apps/api', 296, 2_140_000], ['apps/admin', 352, 1_810_000], ['packages/ui', 164, 980_000], ['docs', 41, 212_000], ['scripts', 18, 64_000], ['.github', 7, 9_420], ['.claude', 6, 6_880],
    ].map(([path, files, bytes]) => ({ path, files, bytes })),
  },
};
PROJECT_INFO.scripts = PROJECT_INFO.manifests.flatMap((m) => Object.entries(m.scripts || {}).map(([name, command]) => ({ manager: m.type === 'composer' ? 'composer' : 'pnpm', name, command, source: m.path })));

const LARAVEL_ROUTES = [
  ['GET', '/', 'HomeController@index', 'home', ['web']], ['GET', '/login', 'Auth\\LoginController@show', 'login', ['web', 'guest']],
  ['POST', '/login', 'Auth\\LoginController@store', null, ['web', 'guest']], ['POST', '/logout', 'Auth\\LoginController@destroy', 'logout', ['web', 'auth']],
  ['GET', '/admin/orders', 'OrderController@index', 'orders.index', ['web', 'auth']], ['GET', '/admin/orders/{order}', 'OrderController@show', 'orders.show', ['web', 'auth']],
  ['PATCH', '/admin/orders/{order}', 'OrderController@update', 'orders.update', ['web', 'auth', 'can:orders.edit']], ['POST', '/admin/orders/{order}/refund', 'RefundController', 'orders.refund', ['web', 'auth', 'can:refunds']],
  ['GET', '/admin/customers', 'CustomerController@index', 'customers.index', ['web', 'auth']], ['GET', '/admin/products', 'ProductController@index', 'products.index', ['web', 'auth']],
  ['POST', '/admin/products', 'ProductController@store', 'products.store', ['web', 'auth']], ['DELETE', '/admin/products/{product}', 'ProductController@destroy', 'products.destroy', ['web', 'auth']],
  ['GET', '/api/v1/health', 'HealthController', null, ['api']], ['POST', '/api/v1/webhooks/stripe', 'StripeWebhookController', 'webhooks.stripe', ['api']],
  ['GET', '/api/v1/reports/sales', 'Reports\\SalesController@index', 'reports.sales', ['api', 'auth:sanctum']], ['PUT', '/api/v1/settings', 'SettingsController@update', 'settings.update', ['api', 'auth:sanctum']],
].map(([method, uri, action, name, middleware], i) => ({ method, uri, action, name, middleware, file: uri.startsWith('/api') ? 'apps/admin/routes/api.php' : 'apps/admin/routes/web.php', line: 8 + i * 3 }));

const MIGRATIONS = [
  ['0001_01_01_000000_create_users_table.php', 'users', '2024-03-02'], ['0001_01_01_000001_create_cache_table.php', 'cache', '2024-03-02'],
  ['0001_01_01_000002_create_jobs_table.php', 'jobs', '2024-03-02'], ['2024_03_10_101500_create_products_table.php', 'products', '2024-03-10'],
  ['2024_03_11_090000_create_orders_table.php', 'orders', '2024-03-11'], ['2024_04_02_131200_create_customers_table.php', 'customers', '2024-04-02'],
  ['2024_06_19_080000_add_payment_provider_to_orders.php', 'orders', '2024-06-19'], ['2024_09_05_160000_create_refunds_table.php', 'refunds', '2024-09-05'],
  ['2026_10_20_094500_create_payment_intents_table.php', 'payment_intents', '2026-10-20'],
].map(([file, table, ts]) => ({ file: 'apps/admin/database/migrations/' + file, table, ts: Date.parse(ts) }));

const OUTDATED = {
  npm: [
    ['next', '15.0.2', '15.0.3', '15.1.0', false], ['typescript', '5.6.3', '5.6.3', '5.7.2', true], ['eslint', '9.14.0', '9.15.0', '9.15.0', true], ['vitest', '2.1.4', '2.1.5', '2.1.5', true],
    ['drizzle-orm', '0.36.0', '0.36.4', '0.37.0', false], ['stripe', '17.3.0', '17.4.0', '17.4.0', false], ['@types/react', '18.3.12', '18.3.12', '19.0.1', true],
  ].map(([name, current, wanted, latest, dev]) => ({ name, current, wanted, latest, dev })),
  composer: [['laravel/framework', '11.31.0', '11.34.2', '11.34.2', false], ['filament/filament', '3.2.115', '3.2.124', '3.2.124', false], ['pestphp/pest', '3.5.1', '3.5.1', '3.6.0', true]]
    .map(([name, current, wanted, latest, dev]) => ({ name, current, wanted, latest, dev })),
};
const AUDIT = { npm: { critical: 0, high: 1, moderate: 2, low: 3, items: [{ name: 'cookie', severity: 'high', title: 'cookie accepts cookie name, path, and domain with out of bounds characters', via: 'next', fixAvailable: true }, { name: 'cross-spawn', severity: 'moderate', title: 'ReDoS in cross-spawn', via: 'husky', fixAvailable: true }] }, composer: { critical: 0, high: 0, moderate: 0, low: 0, items: [] } };

const DRIFT = [
  { doc: 'docs/api.md', mentions: ['apps/api/src/modules/orders/routes.ts', 'apps/api/src/schemas/order.ts'], docChangedAt: Date.now() - 35 * 60_000 - 9 * DAY, codeChangedAt: Date.now() - 2 * H, commitsSince: 14, severity: 'high' },
  { doc: 'docs/architecture.md', mentions: ['apps/api/src/server.ts', 'turbo.json'], docChangedAt: Date.now() - 3 * H - 21 * DAY, codeChangedAt: Date.now() - 4 * DAY, commitsSince: 6, severity: 'medium' },
  { doc: 'apps/api/CLAUDE.md', mentions: ['apps/api/src/db.ts'], docChangedAt: Date.now() - 6 * DAY, codeChangedAt: Date.now() - 1 * DAY, commitsSince: 3, severity: 'medium' },
  { doc: 'README.md', mentions: ['scripts/seed.ts', 'docker-compose.yml'], docChangedAt: Date.now() - 50 * DAY, codeChangedAt: Date.now() - 12 * DAY, commitsSince: 2, severity: 'low' },
];

const TOOL_DEFS = [
  ['claude', 'Claude Code'], ['codex', 'Codex'], ['cursor', 'Cursor'], ['copilot', 'GitHub Copilot'], ['windsurf', 'Windsurf'], ['gemini', 'Gemini CLI'],
  ['cline', 'Cline'], ['roo', 'Roo Code'], ['aider', 'Aider'], ['continue', 'Continue'], ['zed', 'Zed'], ['junie', 'Junie'], ['amazonq', 'Amazon Q'],
];
const cap = (items) => ({ count: items.length, items });
function agentSetup() {
  const t = {
    claude: {
      files: [['CLAUDE.md', 'instructions', 'project'], ['CLAUDE.local.md', 'instructions', 'local'], ['apps/api/CLAUDE.md', 'instructions', 'project'], ['apps/web/CLAUDE.md', 'instructions', 'project'], ['.claude/settings.json', 'settings', 'project'], ['.claude/settings.local.json', 'settings', 'local'], ['.mcp.json', 'mcp', 'project'], ['.claude/agents/reviewer.md', 'agent', 'project'], ['.claude/agents/test-writer.md', 'agent', 'project'], ['.claude/skills/release/SKILL.md', 'skill', 'project'], ['.claude/commands/deploy.md', 'command', 'project']],
      capabilities: {
        instructions: cap([{ path: 'CLAUDE.md', tokens: 412 }, { path: 'CLAUDE.local.md', tokens: 64 }, { path: 'apps/api/CLAUDE.md', tokens: 118 }, { path: 'apps/web/CLAUDE.md', tokens: 70 }]),
        rules: cap([{ path: '.claude/rules/style.md', imported: true }]),
        mcp: cap([{ name: 'github', type: 'stdio', command: 'npx -y @modelcontextprotocol/server-github', source: '.mcp.json' }, { name: 'postgres', type: 'stdio', command: 'npx -y @modelcontextprotocol/server-postgres', source: '.mcp.json' }, { name: 'playwright', type: 'http', url: 'http://localhost:8931/mcp', source: '.mcp.json' }]),
        hooks: cap([{ event: 'PostToolUse', matcher: 'Edit|Write', command: 'pnpm lint --fix', source: '.claude/settings.json' }, { event: 'PreToolUse', matcher: 'Bash', command: './scripts/guard.sh', source: '.claude/settings.local.json' }, { event: 'Stop', command: 'say "Claude is done"', source: '.claude/settings.local.json' }]),
        permissions: cap([{ rule: 'Bash(pnpm test:*)', mode: 'allow' }, { rule: 'Bash(pnpm lint:*)', mode: 'allow' }, { rule: 'Read(**)', mode: 'allow' }, { rule: 'Edit(apps/**)', mode: 'allow' }, { rule: 'Bash(git push:*)', mode: 'ask' }, { rule: 'Bash(rm -rf:*)', mode: 'deny' }, { rule: 'Read(.env*)', mode: 'deny' }]),
        agents: cap([{ name: 'reviewer', description: 'Reviews diffs for correctness, security and style before commit.', tools: 'Read, Grep, Glob, Bash', model: 'opus', path: '.claude/agents/reviewer.md' }, { name: 'test-writer', description: 'Writes focused vitest tests for new code.', tools: 'Read, Write, Edit, Bash', model: 'inherit', path: '.claude/agents/test-writer.md' }]),
        skills: cap([{ name: 'release', description: 'Cut a release — bump versions, update CHANGELOG, tag.', files: 1, path: '.claude/skills/release/SKILL.md' }]),
        commands: cap([{ name: 'deploy', description: 'Deploy the current branch to staging', argumentHint: '[app]', path: '.claude/commands/deploy.md' }]),
        ignore: cap([]),
      },
    },
    codex: {
      files: [['AGENTS.md', 'instructions', 'project'], ['apps/api/AGENTS.md', 'instructions', 'project'], ['.codex/config.toml', 'settings', 'project']],
      capabilities: { instructions: cap([{ path: 'AGENTS.md', tokens: 236 }, { path: 'apps/api/AGENTS.md', tokens: 38 }]), rules: cap([]), mcp: cap([{ name: 'docs', type: 'stdio', command: 'node tools/docs-mcp.js', source: '.codex/config.toml' }]), hooks: cap([]), permissions: cap([{ rule: 'sandbox: workspace-write', mode: 'allow' }, { rule: 'approval: on-request', mode: 'ask' }]), agents: cap([]), skills: cap([]), commands: cap([]), ignore: cap([]) },
    },
    cursor: {
      files: [['.cursorrules', 'rules', 'project'], ['.cursor/rules/frontend.mdc', 'rules', 'project'], ['.cursor/rules/testing.mdc', 'rules', 'project'], ['.cursor/mcp.json', 'mcp', 'project'], ['.cursorignore', 'ignore', 'project']],
      capabilities: {
        instructions: cap([{ path: '.cursorrules', tokens: 40, legacy: true }]),
        rules: cap([{ path: '.cursor/rules/frontend.mdc', description: 'Frontend conventions for apps/web', globs: ['apps/web/**/*.tsx'], alwaysApply: false }, { path: '.cursor/rules/testing.mdc', description: 'Testing rules', globs: [], alwaysApply: true }]),
        mcp: cap([{ name: 'linear', type: 'sse', url: 'https://mcp.linear.app/sse', source: '.cursor/mcp.json' }]), hooks: cap([]), permissions: cap([]), agents: cap([]), skills: cap([]), commands: cap([]),
        ignore: cap([{ path: '.cursorignore', patterns: ['dist/', '.next/', '*.lock'] }]),
      },
    },
    copilot: {
      files: [['.github/copilot-instructions.md', 'instructions', 'project'], ['.github/instructions/api.instructions.md', 'rules', 'project']],
      capabilities: { instructions: cap([{ path: '.github/copilot-instructions.md', tokens: 52 }]), rules: cap([{ path: '.github/instructions/api.instructions.md', applyTo: 'apps/api/**', globs: ['apps/api/**'] }]), mcp: cap([]), hooks: cap([]), permissions: cap([]), agents: cap([]), skills: cap([]), commands: cap([]), ignore: cap([]) },
    },
    windsurf: { files: [['.windsurfrules', 'rules', 'project']], capabilities: { instructions: cap([]), rules: cap([{ path: '.windsurfrules', alwaysApply: true }]), mcp: cap([]), hooks: cap([]), permissions: cap([]), agents: cap([]), skills: cap([]), commands: cap([]), ignore: cap([]) } },
    gemini: { files: [['GEMINI.md', 'instructions', 'project']], capabilities: { instructions: cap([{ path: 'GEMINI.md', tokens: 30 }]), rules: cap([]), mcp: cap([]), hooks: cap([]), permissions: cap([]), agents: cap([]), skills: cap([]), commands: cap([]), ignore: cap([]) } },
  };
  const tools = TOOL_DEFS.map(([id, name]) => {
    const d = t[id];
    const empty = Object.fromEntries(['instructions', 'rules', 'mcp', 'hooks', 'permissions', 'agents', 'skills', 'commands', 'ignore'].map((k) => [k, cap([])]));
    return { id, name, detected: !!d, files: (d?.files || []).map(([path, kind, scope]) => ({ path, kind, scope })), capabilities: d?.capabilities || empty };
  });
  const totals = { tools: tools.filter((x) => x.detected).length, files: tools.reduce((a, x) => a + x.files.length, 0), mcp: tools.reduce((a, x) => a + x.capabilities.mcp.count, 0) };
  return { tools, totals };
}

const TEMPLATES = [
  ['claude-md', 'CLAUDE.md', 'context', 'claude', 'CLAUDE.md', 'Project guide for Claude Code: commands, conventions, workflow.'],
  ['agents-md', 'AGENTS.md', 'context', 'codex', 'AGENTS.md', 'Cross-tool agent instructions (Codex, Jules, Amp…).'],
  ['gemini-md', 'GEMINI.md', 'context', 'gemini', 'GEMINI.md', 'Context file for Gemini CLI.'],
  ['cursor-rule', 'Cursor rule (.mdc)', 'rules', 'cursor', '.cursor/rules/{{name}}.mdc', 'Scoped rule with globs, description and alwaysApply.'],
  ['copilot-instructions', 'Copilot instructions', 'rules', 'copilot', '.github/copilot-instructions.md', 'Repository-wide custom instructions for GitHub Copilot.'],
  ['claude-skill', 'Claude skill', 'agents', 'claude', '.claude/skills/{{name}}/SKILL.md', 'Reusable capability with instructions and resources.'],
  ['claude-agent', 'Claude subagent', 'agents', 'claude', '.claude/agents/{{name}}.md', 'Specialised subagent with its own tools and model.'],
  ['slash-command', 'Slash command', 'agents', 'claude', '.claude/commands/{{name}}.md', 'Custom /command with argument hints.'],
  ['adr', 'ADR', 'docs', 'generic', 'docs/adr/{{number}}-{{slug}}.md', 'Architecture decision record (context, decision, consequences).'],
  ['plan', 'Plan', 'docs', 'generic', 'docs/plans/{{slug}}.md', 'Implementation plan with phases and checkboxes.'],
  ['prd', 'PRD', 'docs', 'generic', 'docs/prd/{{slug}}.md', 'Product requirements: problem, goals, non-goals, metrics.'],
  ['todo', 'TODO list', 'tasks', 'generic', 'TODO.md', 'Checkbox task list mdctl can sync to the board.'],
  ['decision-log', 'Decision log', 'docs', 'generic', 'DECISIONS.md', 'Running log of small decisions with status.'],
  ['handoff', 'Session handoff', 'agents', 'generic', 'docs/handoff/{{date}}.md', 'What was done, what is next, open questions — for the next agent.'],
  ['readme', 'README', 'docs', 'generic', 'README.md', 'Project README with setup, scripts and structure.'],
].map(([id, name, category, tool, defaultPath, description]) => ({
  id, name, category, tool, defaultPath, description,
  vars: [
    ...(defaultPath.includes('{{name}}') ? [{ name: 'name', label: 'Name', default: 'my-' + id.split('-').pop() }] : []),
    ...(defaultPath.includes('{{slug}}') ? [{ name: 'slug', label: 'Slug', default: 'new-' + id }] : []),
    ...(defaultPath.includes('{{number}}') ? [{ name: 'number', label: 'Number', default: '0004' }] : []),
    { name: 'project', label: 'Project name', default: PROJECT.name },
  ],
}));

function renderTemplate(id, vars = {}) {
  const t = TEMPLATES.find((x) => x.id === id) || TEMPLATES[0];
  const v = Object.fromEntries(t.vars.map((x) => [x.name, vars[x.name] ?? x.default]));
  v.date = new Date().toISOString().slice(0, 10);
  const path = t.defaultPath.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k] ?? k);
  const bodies = {
    'claude-md': `# ${v.project} — guide for Claude Code\n\n## Commands\n- \`pnpm dev\` — start everything\n- \`pnpm test\` — run tests\n\n## Conventions\n- TypeScript strict mode.\n- Keep functions small.\n\n## Workflow\n- Read [the plan](docs/plan.md) before large changes.\n`,
    'cursor-rule': `---\ndescription: ${v.name} conventions\nglobs: src/**/*.ts\nalwaysApply: false\n---\n\n- Describe the rule here.\n`,
    'claude-skill': `---\nname: ${v.name}\ndescription: What this skill does and when to use it.\n---\n\n# ${v.name}\n\n1. Step one\n2. Step two\n`,
    'claude-agent': `---\nname: ${v.name}\ndescription: When Claude should delegate to this agent.\ntools: Read, Grep, Glob\nmodel: sonnet\n---\n\nYou are a focused ${v.name} agent for ${v.project}.\n`,
    'slash-command': `---\ndescription: Describe the command\nargument-hint: [arg]\n---\n\nDo the thing with $ARGUMENTS.\n`,
    adr: `# ADR ${v.number}: ${v.slug}\n\nStatus: proposed\nDate: ${v.date}\n\n## Context\n\n## Decision\n\n## Consequences\n`,
  };
  return { path, content: bodies[id] || `# ${t.name}\n\n_${t.description}_\n\n- [ ] Fill me in\n` };
}

function rulesFor(path = '') {
  const out = [];
  const dirs = [''];
  const parts = dirOf(path).split('/').filter(Boolean);
  parts.reduce((acc, s) => { const d = acc ? `${acc}/${s}` : s; dirs.push(d); return d; }, '');
  const files = new Set(SEED.map((s) => s[0]));
  for (const d of dirs) {
    for (const [nm, tool] of [['CLAUDE.md', 'claude'], ['CLAUDE.local.md', 'claude'], ['AGENTS.md', 'codex'], ['GEMINI.md', 'gemini']]) {
      const p = d ? `${d}/${nm}` : nm;
      if (files.has(p)) out.push({ tool, path: p, reason: d ? 'hierarchy' : 'always' });
    }
  }
  out.push({ tool: 'cursor', path: '.cursor/rules/testing.mdc', reason: 'always' });
  out.push({ tool: 'cursor', path: '.cursorrules', reason: 'always' });
  if (/^apps\/web\/.*\.tsx$/.test(path)) out.push({ tool: 'cursor', path: '.cursor/rules/frontend.mdc', reason: 'glob', glob: 'apps/web/**/*.tsx' });
  out.push({ tool: 'copilot', path: '.github/copilot-instructions.md', reason: 'always' });
  if (path.startsWith('apps/api/')) out.push({ tool: 'copilot', path: '.github/instructions/api.instructions.md', reason: 'glob', glob: 'apps/api/**' });
  out.push({ tool: 'windsurf', path: '.windsurfrules', reason: 'always' });
  return out;
}

const SYNC = {
  files: [
    { path: 'CLAUDE.md', tool: 'claude', tokens: 412 }, { path: 'AGENTS.md', tool: 'codex', tokens: 236 }, { path: '.cursorrules', tool: 'cursor', tokens: 40 },
    { path: '.github/copilot-instructions.md', tool: 'copilot', tokens: 52 }, { path: '.windsurfrules', tool: 'windsurf', tokens: 28 }, { path: 'GEMINI.md', tool: 'gemini', tokens: 30 },
  ],
  pairs: [
    { a: 'CLAUDE.md', b: 'AGENTS.md', similarity: 0.46, shared: 6, onlyA: 11, onlyB: 7 },
    { a: 'CLAUDE.md', b: '.cursorrules', similarity: 0.21, shared: 1, onlyA: 16, onlyB: 2 },
    { a: 'CLAUDE.md', b: '.github/copilot-instructions.md', similarity: 0.18, shared: 1, onlyA: 16, onlyB: 3 },
    { a: 'CLAUDE.md', b: '.windsurfrules', similarity: 0.33, shared: 1, onlyA: 16, onlyB: 2 },
    { a: 'CLAUDE.md', b: 'GEMINI.md', similarity: 0.12, shared: 0, onlyA: 17, onlyB: 2 },
    { a: 'AGENTS.md', b: '.cursorrules', similarity: 0.29, shared: 1, onlyA: 12, onlyB: 2 },
    { a: 'AGENTS.md', b: '.github/copilot-instructions.md', similarity: 0.24, shared: 1, onlyA: 12, onlyB: 3 },
    { a: 'AGENTS.md', b: '.windsurfrules', similarity: 0.19, shared: 1, onlyA: 12, onlyB: 2 },
    { a: 'AGENTS.md', b: 'GEMINI.md', similarity: 0.31, shared: 1, onlyA: 12, onlyB: 1 },
    { a: '.cursorrules', b: '.windsurfrules', similarity: 0.52, shared: 1, onlyA: 2, onlyB: 2 },
    { a: '.github/copilot-instructions.md', b: 'GEMINI.md', similarity: 0.27, shared: 1, onlyA: 2, onlyB: 1 },
    { a: '.cursorrules', b: 'GEMINI.md', similarity: 0.15, shared: 0, onlyA: 3, onlyB: 2 },
    { a: '.cursorrules', b: '.github/copilot-instructions.md', similarity: 0.14, shared: 0, onlyA: 3, onlyB: 3 },
    { a: '.windsurfrules', b: 'GEMINI.md', similarity: 0.2, shared: 1, onlyA: 2, onlyB: 1 },
    { a: '.windsurfrules', b: '.github/copilot-instructions.md', similarity: 0.1, shared: 0, onlyA: 3, onlyB: 3 },
  ],
};

const PRICING = { opus: [15, 75, 1.5, 18.75], sonnet: [3, 15, 0.3, 3.75], haiku: [0.8, 4, 0.08, 1], gpt: [1.25, 10, 0.125, 0] };
function costOf(t, model) {
  const fam = /opus/.test(model) ? 'opus' : /haiku/.test(model) ? 'haiku' : /gpt|codex/.test(model) ? 'gpt' : 'sonnet';
  const p = PRICING[fam];
  return ((t.input || 0) * p[0] + (t.output || 0) * p[1] + (t.cacheRead || 0) * p[2] + (t.cacheWrite || 0) * p[3]) / 1e6;
}

function sessionTimeline(s) {
  const types = ['prompt', 'tool', 'tool', 'edit', 'tool', 'edit', 'summary'];
  const tools = ['Read', 'Grep', 'Edit', 'Bash', 'Glob', 'Write'];
  const prompts = [s.lastPrompt, 'Now update the plan with what changed', 'Run the tests and fix whatever fails', 'Also document the edge cases in docs/api.md', 'Looks good — commit it'];
  const out = [];
  const span = Math.max(10 * 60_000, s.lastAt - s.startedAt);
  const n = 34;
  for (let i = 0; i < n; i++) {
    const ts = s.startedAt + (span * i) / (n - 1);
    const r = noise(s.sessionId, i);
    let type = i % 9 === 0 ? 'prompt' : types[Math.floor(r * types.length)];
    if (i === n - 1) type = 'summary';
    const path = s.filesTouched[Math.floor(r * 97) % s.filesTouched.length];
    if (type === 'prompt') out.push({ ts, type, text: prompts[(i / 9) | 0] || prompts[0] });
    else if (type === 'edit') out.push({ ts, type, path, tool: r > 0.5 ? 'Edit' : 'Write', text: `Updated ${path} (+${3 + Math.floor(r * 30)} −${Math.floor(r * 9)})` });
    else if (type === 'tool') { const tool = tools[Math.floor(r * 31) % tools.length]; out.push({ ts, type, tool, path: tool === 'Bash' ? undefined : path, text: tool === 'Bash' ? 'pnpm test --filter api' : tool === 'Grep' ? 'PaymentIntent' : path }); }
    else out.push({ ts, type, text: 'Implemented the change, updated docs and tests. 2 follow-ups added to TODO.md.' });
  }
  return out;
}

function contextVersion(tool, ts) {
  const file = tool === 'codex' ? 'AGENTS.md' : 'CLAUDE.md';
  const content = SEED.find((s) => s[0] === file)?.[4] || '';
  const lines = content.split('\n');
  const age = Math.max(0, (Date.now() - ts) / DAY);
  const drop = Math.min(lines.length - 4, Math.round(age * 1.3));
  const kept = lines.filter((l, i) => i < 3 || noise(file, i) * 30 > drop || l.startsWith('#'));
  return kept.join('\n');
}

const WORKSPACE = (now) => ({
  root: '/home/dev', current: PROJECT.root,
  projects: [
    { name: 'acme-commerce', path: PROJECT.root, stacks: ['Next.js', 'Fastify', 'Laravel', 'pnpm'], aiTools: ['claude', 'codex', 'cursor', 'copilot', 'windsurf', 'gemini'], mdFiles: 38, lastModified: now - 3 * 60_000, hasMdctl: true, git: { branch: 'feat/checkout-v2', dirty: 4 }, running: { url: location.origin + location.pathname + location.search } },
    { name: 'acme-mobile', path: '/home/dev/acme-mobile', stacks: ['Expo', 'React Native'], aiTools: ['claude', 'cursor'], mdFiles: 14, lastModified: now - 5 * H, hasMdctl: true, git: { branch: 'main', dirty: 0 }, running: null },
    { name: 'billing-service', path: '/home/dev/billing-service', stacks: ['Go'], aiTools: ['codex'], mdFiles: 9, lastModified: now - 2 * DAY, hasMdctl: false, git: { branch: 'main', dirty: 1 }, running: null },
    { name: 'design-system', path: '/home/dev/design-system', stacks: ['Vite', 'React', 'Storybook'], aiTools: ['claude', 'copilot'], mdFiles: 22, lastModified: now - 4 * DAY, hasMdctl: false, git: { branch: 'next', dirty: 0 }, running: null },
    { name: 'infra', path: '/home/dev/infra', stacks: ['Terraform', 'Docker'], aiTools: ['claude'], mdFiles: 6, lastModified: now - 11 * DAY, hasMdctl: false, git: { branch: 'main', dirty: 0 }, running: null },
    { name: 'shop-admin-legacy', path: '/home/dev/shop-admin-legacy', stacks: ['Laravel', 'PHP'], aiTools: [], mdFiles: 3, lastModified: now - 140 * DAY, hasMdctl: false, git: { branch: 'master', dirty: 0 }, running: null },
  ],
});

// ---------------------------------------------------------------- routes
export function insightRoutes(ctx = {}) {
  const filePaths = () => {
    try {
      const f = ctx.files?.();
      if (Array.isArray(f) && f.length) return f.map((x) => ({ path: x.path, tool: x.tool, kind: x.kind, tokens: x.tokens, mtime: x.mtime }));
    } catch { /* fall back */ }
    return SEED.map(([path, tool, kind, age, content]) => ({ path, tool, kind, tokens: Math.ceil(content.length / 4), mtime: Date.now() - age * 60_000 }));
  };
  const graphEdges = () => {
    try { return ctx.graph?.().edges || []; } catch { return []; }
  };
  const sessionList = () => {
    try { const s = typeof ctx.sessions === 'function' ? ctx.sessions() : ctx.sessions; if (Array.isArray(s) && s.length) return s; } catch { /* ignore */ }
    return seedSessions(Date.now());
  };
  const range = (q) => {
    const to = +q.to || Date.now();
    const from = +q.from || to - 7 * DAY;
    return { from, to };
  };
  const body = (init) => {
    try { return typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body || {}; } catch { return {}; }
  };

  return {
    // ------------------------------------------------ reports
    '/api/reports/summary': (q) => {
      const { from, to } = range(q);
      const span = to - from;
      return { range: { from, to }, prevRange: { from: from - span, to: from }, kpis: kpisFor(from, to), prev: kpisFor(from - span, from) };
    },
    '/api/reports/series': (q) => {
      const { from, to } = range(q);
      return series({ from, to, bucket: q.bucket || (to - from > 3 * DAY ? 'day' : 'hour'), metric: q.metric || 'changes', split: q.split || 'none' });
    },
    '/api/reports/top': (q) => {
      const by = q.by || 'churn';
      const files = filePaths();
      const edges = graphEdges();
      if (by === 'churn') {
        return files.map((f) => {
          const hot = /plan|TODO|CLAUDE|AGENTS|api\.md|notes/.test(f.path) ? 3.2 : 1;
          const changes = Math.round(noise('churn', f.path) * 26 * hot) + (hot > 1 ? 6 : 0);
          return { path: f.path, tool: f.tool, changes, added: changes * (4 + Math.round(noise('a', f.path) * 9)), removed: changes * Math.round(noise('r', f.path) * 4), last: Date.now() - noise('l', f.path) * 3 * DAY };
        }).filter((r) => r.changes > 0).sort((a, b) => b.changes - a.changes).slice(0, 25);
      }
      if (by === 'links') {
        const m = new Map(files.map((f) => [f.path, { path: f.path, tool: f.tool, inbound: 0, outbound: 0 }]));
        for (const e of edges) { if (m.has(e.to)) m.get(e.to).inbound++; if (m.has(e.from)) m.get(e.from).outbound++; }
        const rows = [...m.values()];
        if (!edges.length) rows.forEach((r) => { r.inbound = Math.round(noise('in', r.path) * 9); r.outbound = Math.round(noise('out', r.path) * 6); });
        return rows.sort((a, b) => b.inbound - a.inbound || b.outbound - a.outbound).slice(0, 25);
      }
      if (by === 'stale') return files.map((f) => ({ path: f.path, tool: f.tool, kind: f.kind, mtime: f.mtime, ageDays: Math.round((Date.now() - f.mtime) / DAY) })).sort((a, b) => a.mtime - b.mtime).slice(0, 25);
      return files.map((f) => ({ path: f.path, tool: f.tool, kind: f.kind, tokens: f.tokens })).sort((a, b) => b.tokens - a.tokens).slice(0, 25);
    },
    '/api/reports/heatmap': (q) => {
      const days = Math.min(730, +q.days || 365);
      const out = [];
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      for (let i = days - 1; i >= 0; i--) {
        const t = d.getTime() - i * DAY;
        const dd = new Date(t);
        const ramp = i > 300 ? 0.25 : i > 200 ? 0.55 : 1;
        const c = noise('hm', Math.floor(t / DAY)) < 0.18 * (2 - ramp) ? 0 : countAt('changes', t, 'day', '', ramp);
        out.push({ date: `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`, count: c });
      }
      return out;
    },
    '/api/reports/export': (q) => {
      const { from, to } = range(q);
      const k = kpisFor(from, to);
      const fmt = q.format || 'md';
      const rows = Object.entries(k);
      const stamp = new Date(to).toISOString().slice(0, 10);
      if (fmt === 'csv') return { filename: `mdctl-report-${stamp}.csv`, mime: 'text/csv', content: 'metric,value\n' + rows.map(([a, b]) => `${a},${b}`).join('\n') + '\n' };
      if (fmt === 'html') return { filename: `mdctl-report-${stamp}.html`, mime: 'text/html', content: `<!doctype html><meta charset="utf-8"><title>mdctl report</title><h1>${PROJECT.name}</h1><table>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>` };
      return { filename: `mdctl-report-${stamp}.md`, mime: 'text/markdown', content: `# ${PROJECT.name} report\n\n| Metric | Value |\n|---|---|\n${rows.map(([a, b]) => `| ${a} | ${b} |`).join('\n')}\n` };
    },

    // ------------------------------------------------ git stats (reports + overview)
    '/api/git/stats': (q) => {
      const { from, to } = range(q);
      const s = series({ from, to, bucket: 'day', metric: 'commits', split: 'author' });
      return {
        byAuthor: s.series.map((x) => ({ author: x.key, commits: x.values.reduce((a, b) => a + b, 0), added: Math.round(noise('ga', x.key) * 2400), removed: Math.round(noise('gr', x.key) * 900) })).sort((a, b) => b.commits - a.commits),
        byDay: s.buckets.map((t, i) => ({ date: new Date(t).toISOString().slice(0, 10), commits: s.series.reduce((a, x) => a + x.values[i], 0) })),
        topFiles: filePaths().slice(0, 10).map((f) => ({ path: f.path, commits: 2 + Math.round(noise('gf', f.path) * 18) })).sort((a, b) => b.commits - a.commits),
      };
    },

    // ------------------------------------------------ project
    '/api/project': () => PROJECT_INFO,
    '/api/project/stats': () => PROJECT_INFO.stats,
    '/api/project/deps': (q) => PROJECT_INFO.manifests.filter((m) => !q.manager || m.type === q.manager || (q.manager === 'npm' && m.type === 'npm')).flatMap((m) => m.deps.map((d) => ({ ...d, manifest: m.path }))),
    '/api/project/routes': () => LARAVEL_ROUTES,
    '/api/project/migrations': () => MIGRATIONS,
    '/api/project/drift': () => DRIFT,
    '/api/project/outdated': () => ({ ts: Date.now() - 3 * H, results: OUTDATED, audit: AUDIT }),

    // ------------------------------------------------ agent center
    '/api/agents/setup': () => agentSetup(),
    '/api/agents/rules-for': (q) => rulesFor(q.path || ''),
    '/api/agents/templates': () => TEMPLATES,
    '/api/agents/template/render': (q) => {
      let vars = {};
      try { vars = q.vars ? JSON.parse(q.vars) : {}; } catch { /* ignore */ }
      return renderTemplate(q.id, vars);
    },
    '/api/agents/sync/status': () => SYNC,
    '/api/agents/sync/plan': (_q, init) => {
      const b = body(init);
      const src = SEED.find((s) => s[0] === (b.source || 'CLAUDE.md'))?.[4] || '';
      return (b.targets || []).map((target) => {
        const cur = SEED.find((s) => s[0] === target)?.[4];
        const content = `<!-- synced from ${b.source} by mdctl -->\n` + src.replace(/^@.*\n/gm, '');
        return { target, exists: cur != null, content, diff: lineDiff(cur || '', content) };
      });
    },
    '/api/agents/session': (q) => {
      const s = sessionList().find((x) => x.sessionId === q.id) || sessionList()[0];
      return { session: s, timeline: sessionTimeline(s) };
    },
    '/api/agents/costs': (q) => {
      const { from, to } = range({ from: q.from, to: q.to });
      const list = sessionList().map((s) => {
        const model = s.tool === 'codex' ? 'gpt-5-codex' : noise('m', s.sessionId) > 0.6 ? 'claude-opus-4' : 'claude-sonnet-4.5';
        return { id: s.sessionId, tool: s.tool, title: s.title, model, ...s.tokens, usd: +costOf(s.tokens, model).toFixed(2), startedAt: s.startedAt, lastAt: s.lastAt };
      });
      const days = [];
      for (let t = from - (from % DAY); t <= to; t += DAY) {
        const usd = +(countAt('agents', t, 'day') * 0.9 * (0.6 + noise('usd', t))).toFixed(2);
        days.push({ date: new Date(t).toISOString().slice(0, 10), ts: t, usd, input: Math.round(usd * 52_000), output: Math.round(usd * 6_400), cacheRead: Math.round(usd * 410_000), cacheWrite: Math.round(usd * 21_000) });
      }
      const total = list.reduce((a, s) => { for (const k of ['input', 'output', 'cacheRead', 'cacheWrite', 'usd']) a[k] += s[k] || 0; return a; }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0 });
      total.usd = +total.usd.toFixed(2);
      return { range: { from, to }, total, sessions: list, days, pricing: PRICING };
    },
    '/api/context/at': (q) => {
      const ts = +q.ts || Date.now();
      const text = contextVersion(q.tool || 'claude', ts);
      return { dir: q.dir || '', tool: q.tool || 'claude', ts, text, tokens: Math.ceil(text.length / 4), chain: [{ path: (q.tool === 'codex' ? 'AGENTS.md' : 'CLAUDE.md'), reason: 'root', tokens: Math.ceil(text.length / 4) }] };
    },
    '/api/context/diff': (q) => {
      const tool = q.tool || 'claude';
      const a = contextVersion(tool, +q.from || Date.now() - 14 * DAY);
      const b = contextVersion(tool, +q.to || Date.now());
      return { from: { ts: +q.from, tokens: Math.ceil(a.length / 4) }, to: { ts: +q.to, tokens: Math.ceil(b.length / 4) }, diff: lineDiff(a, b) };
    },

    // ------------------------------------------------ workspace
    '/api/workspace': () => WORKSPACE(Date.now()),
    '/api/workspace/instances': () => [{ path: PROJECT.root, url: location.origin + location.pathname, pid: 4242, startedAt: Date.now() - 3 * H }],
  };
}
