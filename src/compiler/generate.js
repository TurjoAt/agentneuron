// Generate a starter AGENTS.md / CLAUDE.md / ... from what the code shows. Every content line cites its source;
// anything that cannot be detected is left out.
import { detectProject } from '../project/index.js';
import { buildIndex } from '../project/fsindex.js';
import { parseToml } from '../project/util.js';
import { FileError } from '../files/paths.js';

export const GEN_TARGETS = {
  agents: { path: 'AGENTS.md' }, codex: { path: 'AGENTS.md' }, claude: { path: 'CLAUDE.md' }, gemini: { path: 'GEMINI.md' },
  copilot: { path: '.github/copilot-instructions.md' },
  cursor: { path: '.cursor/rules/project.mdc', fm: '---\ndescription: "Project overview, commands and conventions"\nglobs:\nalwaysApply: true\n---\n' },
  windsurf: { path: '.windsurf/rules/project.md', fm: '---\ntrigger: always_on\ndescription: "Project overview, commands and conventions"\n---\n' },
};

const DIRS = {
  src: 'source code', lib: 'library code', app: 'application code', test: 'tests', tests: 'tests', __tests__: 'tests', spec: 'tests', e2e: 'end-to-end tests',
  docs: 'documentation', doc: 'documentation', scripts: 'build and maintenance scripts', examples: 'examples', example: 'examples', bin: 'executables / CLI entry points',
  public: 'static files served as-is', static: 'static files served as-is', assets: 'assets', config: 'configuration', packages: 'workspace packages', apps: 'workspace applications',
  routes: 'route definitions', database: 'migrations, seeders and factories', migrations: 'database migrations', resources: 'views and front-end resources',
  ui: 'front-end', web: 'front-end', frontend: 'front-end', client: 'client code', server: 'server code', backend: 'back-end code', api: 'API code',
  components: 'UI components', pages: 'pages / routes', cmd: 'Go command entry points', internal: 'private packages', pkg: 'packages', include: 'headers',
  infra: 'infrastructure', deploy: 'deployment', terraform: 'infrastructure as code', k8s: 'Kubernetes manifests', fixtures: 'test fixtures', tools: 'developer tools',
  '.github': 'GitHub workflows and repository config', bootstrap: 'framework bootstrap', storage: 'runtime storage', vendor: 'third-party dependencies',
};
const SCRIPT_ORDER = ['install', 'dev', 'start', 'serve', 'build', 'test', 'test:unit', 'test:e2e', 'lint', 'lint:fix', 'typecheck', 'type-check', 'check', 'format', 'fmt'];
const CATS = new Set(['language', 'runtime', 'framework', 'testing', 'db', 'ai']);

/** Strip // and /* *\/ comments and trailing commas from JSONC (tsconfig.json). */
export function parseJsonc(text) {
  let out = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { out += c; if (c === '\\') out += text[++i] ?? ''; else if (c === '"') q = false; continue; }
    if (c === '"') { q = true; out += c; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  try { return JSON.parse(out.replace(/^﻿/, '').replace(/,(\s*[}\]])/g, '$1')); } catch { return null; }
}

function runCmd(pm, name) {
  if (pm === 'npm') return ['test', 'start'].includes(name) ? `npm ${name}` : `npm run ${name}`;
  if (pm === 'bun') return `bun run ${name}`;
  return `${pm} ${name}`;
}
const tick = (s) => `\`${String(s).replace(/`/g, "'").replace(/\s+/g, ' ').slice(0, 160)}\``;

/**
 * Build the document. -> { tool, path, content, items: [{ section, text, source }] }
 */
export async function generateContext(root, { tool = 'agents' } = {}) {
  const target = GEN_TARGETS[tool];
  if (!target) throw new FileError(400, `unknown tool "${tool}" (valid: ${Object.keys(GEN_TARGETS).join(', ')})`);
  const [proj, idx] = await Promise.all([detectProject(root), buildIndex(root, { cap: 20000 })]);
  const sections = { Commands: [], Stack: [], 'Project layout': [], Conventions: [] };
  const add = (sec, text, source) => { if (!sections[sec].some((x) => x.text === text)) sections[sec].push({ text, source }); };
  const pkg = idx.has('package.json') ? await idx.readJson('package.json') : null;
  const has = (p) => idx.has(p);
  const first = (list) => list.find(has);

  // ---- commands
  if (pkg && typeof pkg === 'object') {
    const lock = [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lockb', 'bun'], ['bun.lock', 'bun'], ['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm']].find(([f]) => has(f));
    const pmField = typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : null;
    const pm = lock ? lock[1] : ['npm', 'pnpm', 'yarn', 'bun'].includes(pmField) ? pmField : 'npm';
    const pmSrc = lock ? lock[0] : pmField ? 'package.json#packageManager' : 'package.json';
    add('Commands', `Install dependencies: ${tick(pm === 'npm' && lock ? 'npm ci' : `${pm} install`)}${lock || pmField ? '' : ' (no lockfile found)'}`, pmSrc);
    const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
    const names = Object.keys(scripts);
    const known = SCRIPT_ORDER.filter((n) => names.includes(n));
    for (const n of known) add('Commands', `${n[0].toUpperCase()}${n.slice(1)}: ${tick(runCmd(pm, n))} (runs ${tick(scripts[n])})`, `package.json#scripts.${n}`);
    for (const n of names.filter((x) => !known.includes(x) && !/^(pre|post)/.test(x)).slice(0, 8)) add('Commands', `${tick(runCmd(pm, n))}: runs ${tick(scripts[n])}`, `package.json#scripts.${n}`);
  }
  if (has('composer.json')) {
    const c = await idx.readJson('composer.json');
    add('Commands', `Install PHP dependencies: ${tick('composer install')}`, has('composer.lock') ? 'composer.lock' : 'composer.json');
    for (const [n, v] of Object.entries(c?.scripts || {}).slice(0, 8)) if (!/^(pre|post)-/.test(n)) add('Commands', `${tick(`composer ${n}`)}: runs ${tick(Array.isArray(v) ? v.join(' && ') : v)}`, `composer.json#scripts.${n}`);
  }
  if (has('artisan')) {
    add('Commands', `Dev server: ${tick('php artisan serve')}`, 'artisan');
    if (idx.find((p) => p.startsWith('database/migrations/')).length) add('Commands', `Run migrations: ${tick('php artisan migrate')}`, 'database/migrations/');
    if (has('phpunit.xml') || has('phpunit.xml.dist') || has('tests/Pest.php')) add('Commands', `Tests: ${tick('php artisan test')}`, first(['tests/Pest.php', 'phpunit.xml', 'phpunit.xml.dist']));
  } else if (has('phpunit.xml') || has('phpunit.xml.dist')) add('Commands', `Tests: ${tick('vendor/bin/phpunit')}`, first(['phpunit.xml', 'phpunit.xml.dist']));
  let py = null;
  if (has('pyproject.toml')) { const t = await idx.read('pyproject.toml'); py = t ? parseToml(t) : null; }
  if (has('uv.lock')) add('Commands', `Install: ${tick('uv sync')}`, 'uv.lock');
  else if (has('poetry.lock') || py?.tool?.poetry) add('Commands', `Install: ${tick('poetry install')}`, has('poetry.lock') ? 'poetry.lock' : 'pyproject.toml#tool.poetry');
  else if (has('Pipfile')) add('Commands', `Install: ${tick('pipenv install')}`, 'Pipfile');
  else if (has('requirements.txt')) add('Commands', `Install: ${tick('pip install -r requirements.txt')}`, 'requirements.txt');
  const reqTxt = has('requirements.txt') ? (await idx.read('requirements.txt')) || '' : '';
  const pyDeps = JSON.stringify([py?.project?.dependencies, py?.project?.['optional-dependencies'], py?.tool?.poetry, py?.['dependency-groups']]);
  if (py?.tool?.pytest || has('pytest.ini') || /(^|\n)pytest\b/i.test(reqTxt) || /"pytest\b/.test(pyDeps)) add('Commands', `Tests: ${tick('pytest')}`, py?.tool?.pytest ? 'pyproject.toml#tool.pytest' : has('pytest.ini') ? 'pytest.ini' : /"pytest/.test(pyDeps) ? 'pyproject.toml' : 'requirements.txt');
  if (py?.tool?.ruff || has('ruff.toml')) add('Commands', `Lint: ${tick('ruff check .')}`, py?.tool?.ruff ? 'pyproject.toml#tool.ruff' : 'ruff.toml');
  if (has('manage.py')) add('Commands', `Dev server: ${tick('python manage.py runserver')}`, 'manage.py');
  if (has('go.mod')) { add('Commands', `Build: ${tick('go build ./...')}`, 'go.mod'); add('Commands', `Tests: ${tick('go test ./...')}`, 'go.mod'); }
  if (has('Cargo.toml')) { add('Commands', `Build: ${tick('cargo build')}`, 'Cargo.toml'); add('Commands', `Tests: ${tick('cargo test')}`, 'Cargo.toml'); }
  if (has('Gemfile')) add('Commands', `Install: ${tick('bundle install')}`, 'Gemfile');
  const mk = first(['Makefile', 'makefile', 'GNUmakefile']);
  if (mk) {
    const t = (await idx.read(mk)) || '';
    const targets = [...t.matchAll(/^([A-Za-z][\w.-]*)\s*:(?!=)/gm)].map((m) => m[1]).filter((n, i, a) => a.indexOf(n) === i && !n.startsWith('.'));
    for (const n of targets.filter((x) => /^(install|setup|dev|run|serve|build|test|lint|fmt|format|check|ci|clean)$/.test(x))) add('Commands', `${tick(`make ${n}`)}`, `${mk}#${n}`);
  }
  const compose = first(['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml']);
  if (compose) add('Commands', `Start services: ${tick('docker compose up')}`, compose);

  // ---- stack
  const MANIFEST = /(package\.json|composer\.(json|lock)|pyproject\.toml|requirements[^ ]*\.txt|Pipfile|go\.mod|Cargo\.toml|Gemfile|pom\.xml|build\.gradle(\.kts)?|\.csproj|deno\.jsonc?|artisan)\b/;
  for (const s of proj.stacks.filter((x) => CATS.has(x.category) && x.confidence >= 0.7 && MANIFEST.test(String(x.source || '')))) {
    add('Stack', `${s.name}${s.version ? ` ${s.version}` : ''}`, String(s.source).replace(/ (dependencies|devDependencies|require|require-dev|engines)\b/, '#$1').replace(/\s+/g, ' '));
  }

  // ---- layout
  const top = new Map();
  for (const f of idx.files) { const i = f.path.indexOf('/'); if (i > 0) { const d = f.path.slice(0, i); top.set(d, (top.get(d) || 0) + 1); } }
  for (const [d, n] of [...top].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (d.startsWith('.') && d !== '.github') continue;
    let purpose = null, src = null;
    const sub = has(`${d}/package.json`) ? await idx.readJson(`${d}/package.json`) : null;
    if (sub?.description) { purpose = String(sub.description); src = `${d}/package.json#description`; }
    if (!purpose && has(`${d}/README.md`)) {
      const t = (await idx.read(`${d}/README.md`, 64 * 1024)) || '';
      const line = t.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !/^(#|<|!\[|```|---|\|)/.test(l));
      if (line) { purpose = sentence(line); src = `${d}/README.md`; }
    }
    if (!purpose && DIRS[d]) { purpose = DIRS[d]; src = `directory name ${d}/`; }
    add('Project layout', `${tick(`${d}/`)}${purpose ? `: ${purpose}` : ''} (${n} file${n === 1 ? '' : 's'})`, src || `file tree ${d}/`);
  }

  // ---- conventions
  if (pkg?.type === 'module') add('Conventions', 'ES modules: use `import` / `export`, not `require`', 'package.json#type');
  if (has('tsconfig.json')) {
    const ts = parseJsonc((await idx.read('tsconfig.json')) || '');
    if (ts?.compilerOptions?.strict === true) add('Conventions', 'TypeScript strict mode is on: keep code type-safe, avoid `any`', 'tsconfig.json#compilerOptions.strict');
  }
  const eslint = first(['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml']);
  if (eslint) add('Conventions', `Lint with ESLint (config: ${tick(eslint)})`, eslint);
  else if (pkg?.eslintConfig) add('Conventions', 'Lint with ESLint', 'package.json#eslintConfig');
  const prettier = first(['.prettierrc', '.prettierrc.json', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.mjs', '.prettierrc.yml', '.prettierrc.yaml', 'prettier.config.js', 'prettier.config.mjs', 'prettier.config.cjs']);
  if (prettier) add('Conventions', `Format with Prettier (config: ${tick(prettier)})`, prettier);
  else if (pkg?.prettier) add('Conventions', 'Format with Prettier', 'package.json#prettier');
  const biome = first(['biome.json', 'biome.jsonc']);
  if (biome) add('Conventions', `Lint and format with Biome (config: ${tick(biome)})`, biome);
  if (has('.editorconfig')) {
    const t = (await idx.read('.editorconfig')) || '';
    const star = /^\[\*\]\s*$([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(t)?.[1] || '';
    const style = /^\s*indent_style\s*=\s*(\w+)/m.exec(star)?.[1], size = /^\s*indent_size\s*=\s*(\d+)/m.exec(star)?.[1];
    if (style) add('Conventions', `Indent with ${style === 'tab' ? 'tabs' : `${size || ''} spaces`.trim()}`, '.editorconfig#[*]');
  }
  const testScript = typeof pkg?.scripts?.test === 'string' ? pkg.scripts.test : '';
  if (/\bnode\s+(?:[^|&;]*\s)?--test\b/.test(testScript)) add('Conventions', "Tests use Node's built-in test runner (`node:test`)", 'package.json#scripts.test');
  for (const s of proj.stacks.filter((x) => x.category === 'testing' && x.source)) add('Conventions', `Tests use ${s.name}`, String(s.source).replace(/ (dependencies|devDependencies|require|require-dev)\b/, '#$1'));
  const ws = pkg?.workspaces ? (Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages) : null;
  if (Array.isArray(ws) && ws.length) add('Conventions', `Monorepo workspaces: ${ws.slice(0, 6).map(tick).join(', ')}`, 'package.json#workspaces');
  else if (has('pnpm-workspace.yaml')) add('Conventions', 'Monorepo (pnpm workspaces)', 'pnpm-workspace.yaml');
  if (py?.project?.['requires-python']) add('Conventions', `Python ${tick(py.project['requires-python'])}`, 'pyproject.toml#project.requires-python');
  if (py?.tool?.black) add('Conventions', 'Format Python with Black', 'pyproject.toml#tool.black');
  if (py?.tool?.mypy || has('mypy.ini')) add('Conventions', 'Type-check Python with mypy', py?.tool?.mypy ? 'pyproject.toml#tool.mypy' : 'mypy.ini');
  if (has('pint.json')) add('Conventions', `Format PHP with Laravel Pint (${tick('vendor/bin/pint')})`, 'pint.json');
  const stan = first(['phpstan.neon', 'phpstan.neon.dist']);
  if (stan) add('Conventions', `Static analysis with PHPStan (${tick('vendor/bin/phpstan analyse')})`, stan);
  if (idx.find((p) => p.startsWith('.husky/')).length) add('Conventions', 'Git hooks run through Husky (`.husky/`)', '.husky/');
  for (const w of idx.find((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)).slice(0, 5)) add('Conventions', `CI runs ${tick(w)} on GitHub Actions`, w);

  // ---- render
  const L = [];
  if (target.fm) L.push(target.fm.trimEnd(), '');
  L.push(`# ${proj.name || 'Project'}`, '');
  const desc = (pkg?.description && ['package.json#description', pkg.description]) || null;
  if (desc) L.push(`${String(desc[1]).replace(/\s+/g, ' ').slice(0, 300)} <!-- from ${desc[0]} -->`, '');
  const items = [];
  for (const [name, list] of Object.entries(sections)) {
    if (!list.length) continue;
    L.push(`## ${name}`, '');
    for (const it of list) { L.push(`- ${it.text} <!-- from ${safeCite(it.source)} -->`); items.push({ section: name, ...it }); }
    L.push('');
  }
  L.push('<!-- Generated by agentneuron generate: every line cites the file it came from. Review, trim and add what only humans know. -->', '');
  return { tool, path: target.path, content: L.join('\n'), items };
}

const sentence = (s) => { const t = String(s).replace(/\s+/g, ' ').trim(); const m = /^.{10,160}?[.!?](?=\s|$)/.exec(t); return m ? m[0] : t.length > 140 ? `${t.slice(0, 137).replace(/\s+\S*$/, '')}...` : t; };
const safeCite = (s) => String(s).replace(/--+>?|[<>\r\n]/g, '').slice(0, 160);
