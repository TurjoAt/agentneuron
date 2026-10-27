// Path classification shared by the review guardian and the impact analyzer.
import path from 'node:path';

export const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.php', '.py', '.go', '.rb', '.java', '.kt', '.rs', '.cs', '.swift', '.scala', '.c', '.cc', '.cpp', '.h', '.hpp']);
export const GRAPH_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.php', '.py', '.go']);

const TEST_RE = /(^|\/)(__tests__|__test__|tests?|spec|specs|e2e|cypress)\/|\.(test|spec|e2e)\.[cm]?[jt]sx?$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$|Tests?\.php$|_spec\.rb$|Test\.(java|kt|cs)$/i;
const MANIFESTS = new Set(['package.json', 'composer.json', 'pyproject.toml', 'Pipfile', 'setup.py', 'setup.cfg', 'go.mod', 'Cargo.toml', 'Gemfile', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'deno.json']);
const LOCKFILES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'composer.lock', 'poetry.lock', 'Pipfile.lock', 'uv.lock', 'go.sum', 'Cargo.lock', 'Gemfile.lock']);
const DOC_RE = /\.(md|mdx|markdown|rst|adoc|txt)$/i;
const GENERATED_RE = /(^|\/)(dist|build|out|\.next|\.nuxt|vendor|generated|__generated__|coverage)\/|\.min\.(js|css)$|\.map$|\.pb\.go$|_pb2\.py$|\.snap$/i;
const INFRA_RE = /(^|\/)(\.github\/workflows|\.circleci|\.gitlab-ci\.ya?ml|Jenkinsfile|Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|compose\.ya?ml|terraform|k8s|kubernetes|helm|charts|nginx|Procfile|fly\.toml|vercel\.json|netlify\.toml|render\.ya?ml|serverless\.ya?ml)(\/|$)|\.tf$|\.tfvars$/i;
const ENV_RE = /(^|\/)\.env(\.[\w.-]+)?$/i;
const CONFIG_RE = /(^|\/)(config|conf|settings)(\/|\.[a-z]+$)|\.config\.[cm]?[jt]s$|(^|\/)\.[\w-]+rc(\.\w+)?$|\.(ya?ml|toml|ini|cfg|conf|properties)$|(^|\/)tsconfig[^/]*\.json$|(^|\/)(vite|webpack|rollup|babel|jest|vitest|eslint|tailwind|next|nuxt|svelte)\.config/i;

export const isTest = (p) => TEST_RE.test(p);
export const isManifest = (p) => MANIFESTS.has(path.posix.basename(p)) || /(^|\/)requirements[^/]*\.txt$/i.test(p);
export const isLockfile = (p) => LOCKFILES.has(path.posix.basename(p));
export const isGenerated = (p) => GENERATED_RE.test(p);
export const isDoc = (p) => DOC_RE.test(p) && !/(^|\/)requirements[^/]*\.txt$/i.test(p);
export const isInfra = (p) => INFRA_RE.test(p);
export const isEnv = (p) => ENV_RE.test(p);
export const isCode = (p) => CODE_EXT.has(path.posix.extname(p).toLowerCase());

/** 'tests' | 'deps' | 'docs' | 'config' | 'source' | 'other' */
export function fileKind(p) {
  if (isManifest(p) || isLockfile(p)) return 'deps';
  if (isTest(p)) return 'tests';
  if (isDoc(p)) return 'docs';
  if (isInfra(p) || isEnv(p) || CONFIG_RE.test(p)) return 'config';
  if (isCode(p)) return 'source';
  return 'other';
}

/** Lower-case word tokens of a path ("app/Http/AuthController.php" -> app, http, auth, controller, php). */
export function pathTokens(p) {
  return String(p).split(/[/._\-\s]+/).flatMap((s) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(' ')).map((s) => s.toLowerCase()).filter(Boolean);
}

const AREAS = [
  ['auth', 'authentication / sessions', ['auth', 'authentication', 'authorization', 'authn', 'authz', 'login', 'logout', 'signin', 'signup', 'session', 'sessions', 'password', 'passwords', 'oauth', 'sso', 'saml', 'jwt', 'guard', 'guards', 'middleware', 'middlewares', 'csrf', 'otp', 'mfa', '2fa']],
  ['permissions', 'permissions / policies', ['policy', 'policies', 'permission', 'permissions', 'acl', 'rbac', 'gate', 'gates', 'ability', 'abilities', 'roles']],
  ['payments', 'payments / billing', ['payment', 'payments', 'billing', 'stripe', 'checkout', 'invoice', 'invoices', 'paypal', 'subscription', 'subscriptions', 'refund', 'refunds', 'wallet', 'braintree', 'paddle']],
  ['crypto', 'cryptography / keys', ['crypto', 'cryptography', 'encrypt', 'encryption', 'decrypt', 'cipher', 'hashing', 'signature', 'signing', 'certificate', 'certificates', 'certs', 'keystore', 'hmac', 'kms']],
  ['migrations', 'database migrations / schema', ['migration', 'migrations', 'migrate']],
];

/** Sensitive areas a path touches: [{ area, label }] */
export function sensitiveAreas(p) {
  const t = new Set(pathTokens(p));
  const out = [];
  for (const [area, label, words] of AREAS) if (words.some((w) => t.has(w))) out.push({ area, label });
  if (!out.some((a) => a.area === 'migrations') && (/\.sql$/i.test(p) || /(^|\/)schema\.prisma$/.test(p) || /(^|\/)alembic\/versions\//.test(p))) out.push({ area: 'migrations', label: 'database migrations / schema' });
  if (isInfra(p)) out.push({ area: 'infra', label: 'infrastructure / CI' });
  if (isEnv(p)) out.push({ area: 'env', label: 'environment file' });
  else if (fileKind(p) === 'config') out.push({ area: 'config', label: 'configuration' });
  if (isManifest(p)) out.push({ area: 'deps', label: 'dependency manifest' });
  else if (isLockfile(p)) out.push({ area: 'lockfile', label: 'lockfile' });
  return out;
}

/** Name a test file is "about": "src/__tests__/userService.test.ts" -> "userservice". */
export function testStem(p) {
  let b = path.posix.basename(p).replace(/\.[^.]+$/, '');
  b = b.replace(/\.(test|spec|e2e)$/i, '').replace(/^test_/i, '').replace(/_(test|spec)$/i, '').replace(/Tests?$/, '');
  return b.toLowerCase().replace(/[-_.]/g, '');
}
/** Comparable stem of a source file. */
export function sourceStem(p) {
  const b = path.posix.basename(p).replace(/\.[^.]+$/, '');
  return (b === 'index' || b === '__init__' ? path.posix.basename(path.posix.dirname(p)) : b).toLowerCase().replace(/[-_.]/g, '');
}
