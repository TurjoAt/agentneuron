// Docker/compose, CI, hosting, tooling config files, AI tools.
import YAML from 'yaml';
import { stack } from '../util.js';

const parseYaml = (t) => { try { return YAML.parse(t) || {}; } catch { return {}; } };

export const docker = {
  id: 'docker',
  async detect(root, idx) {
    const dockerfiles = idx.find((p) => /(^|\/)(Dockerfile(\.[\w.-]+)?|[\w.-]+\.Dockerfile)$/.test(p) && p.split('/').length <= 3);
    const composeFiles = idx.find((p) => /(^|\/)(docker-)?compose[\w.-]*\.ya?ml$/.test(p) && p.split('/').length <= 2);
    if (!dockerfiles.length && !composeFiles.length) return {};
    const services = [];
    for (const f of composeFiles) {
      const y = parseYaml((await idx.read(f)) || '');
      for (const [name, s] of Object.entries(y.services || {})) {
        if (!s || typeof s !== 'object') continue;
        const build = typeof s.build === 'string' ? s.build : s.build?.context || null;
        const ports = (s.ports || []).map((p) => (typeof p === 'object' ? `${p.published ?? ''}:${p.target ?? ''}` : String(p)));
        services.push({ name, image: s.image || null, build, ports, file: f });
      }
    }
    const st = [stack('docker', 'Docker', 'infra', { confidence: 0.95, source: dockerfiles[0] || composeFiles[0] })];
    if (composeFiles.length) st.push(stack('docker-compose', 'Docker Compose', 'infra', { confidence: 0.95, source: composeFiles[0] }));
    return { stacks: st, docker: { files: [...dockerfiles, ...composeFiles], services } };
  },
};

function triggersOf(on) {
  if (!on) return [];
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  return Object.keys(on);
}

export const ci = {
  id: 'ci',
  async detect(root, idx) {
    const out = []; const st = [];
    for (const f of idx.find((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p))) {
      const y = parseYaml((await idx.read(f)) || '');
      out.push({ provider: 'github-actions', path: f, name: y.name || f.split('/').pop(), triggers: triggersOf(y.on ?? y[true]), jobs: Object.keys(y.jobs || {}) });
    }
    if (idx.has('.gitlab-ci.yml')) {
      const y = parseYaml((await idx.read('.gitlab-ci.yml')) || '');
      const reserved = new Set(['stages', 'variables', 'default', 'include', 'workflow', 'image', 'services', 'cache', 'before_script', 'after_script']);
      const jobs = Object.keys(y).filter((k) => !reserved.has(k) && !k.startsWith('.') && y[k] && typeof y[k] === 'object');
      out.push({ provider: 'gitlab-ci', path: '.gitlab-ci.yml', name: 'GitLab CI', triggers: [], jobs });
    }
    for (const [p, provider, name] of [['.circleci/config.yml', 'circleci', 'CircleCI'], ['azure-pipelines.yml', 'azure-pipelines', 'Azure Pipelines'], ['Jenkinsfile', 'jenkins', 'Jenkins'], ['.travis.yml', 'travis', 'Travis CI'], ['bitbucket-pipelines.yml', 'bitbucket', 'Bitbucket Pipelines']]) {
      if (!idx.has(p)) continue;
      let jobs = [];
      if (/\.ya?ml$/.test(p)) { const y = parseYaml((await idx.read(p)) || ''); jobs = Object.keys(y.jobs || {}); }
      out.push({ provider, path: p, name, triggers: [], jobs });
    }
    if (out.some((c) => c.provider === 'github-actions')) st.push(stack('github-actions', 'GitHub Actions', 'ci', { confidence: 0.98, source: '.github/workflows' }));
    if (out.some((c) => c.provider === 'gitlab-ci')) st.push(stack('gitlab-ci', 'GitLab CI', 'ci', { confidence: 0.98, source: '.gitlab-ci.yml' }));
    for (const c of out) if (!['github-actions', 'gitlab-ci'].includes(c.provider) && !st.some((s) => s.id === c.provider)) st.push(stack(c.provider, c.name, 'ci', { confidence: 0.95, source: c.path }));
    return out.length ? { ci: out, stacks: st } : {};
  },
};

const CONFIG_FILES = [
  [/^tsconfig(\.[\w-]+)?\.json$/, 'typescript', 'TypeScript', 'language', 0.9],
  [/^(\.eslintrc(\.[\w]+)?|eslint\.config\.[cm]?[jt]s)$/, 'eslint', 'ESLint', 'tool', 0.95],
  [/^(\.prettierrc(\.[\w]+)?|prettier\.config\.[cm]?[jt]s)$/, 'prettier', 'Prettier', 'tool', 0.95],
  [/^tailwind\.config\.[cm]?[jt]s$/, 'tailwind', 'Tailwind CSS', 'tool', 0.95],
  [/^vite\.config\.[cm]?[jt]s$/, 'vite', 'Vite', 'tool', 0.9],
  [/^next\.config\.[cm]?[jt]s$/, 'next', 'Next.js', 'framework', 0.95],
  [/^nuxt\.config\.[cm]?[jt]s$/, 'nuxt', 'Nuxt', 'framework', 0.95],
  [/^astro\.config\.[cm]?[jt]s$/, 'astro', 'Astro', 'framework', 0.95],
  [/^svelte\.config\.[cm]?js$/, 'svelte', 'Svelte', 'framework', 0.8],
  [/^remix\.config\.[cm]?js$/, 'remix', 'Remix', 'framework', 0.95],
  [/^angular\.json$/, 'angular', 'Angular', 'framework', 0.95],
  [/^playwright\.config\.[cm]?[jt]s$/, 'playwright', 'Playwright', 'testing', 0.95],
  [/^jest\.config\.[cm]?[jt]s$/, 'jest', 'Jest', 'testing', 0.95],
  [/^vitest\.config\.[cm]?[jt]s$/, 'vitest', 'Vitest', 'testing', 0.95],
  [/^cypress\.config\.[cm]?[jt]s$/, 'cypress', 'Cypress', 'testing', 0.95],
  [/^phpunit\.xml(\.dist)?$/, 'phpunit', 'PHPUnit', 'testing', 0.95],
  [/^drizzle\.config\.[cm]?[jt]s$/, 'drizzle', 'Drizzle', 'db', 0.95],
  [/^\.editorconfig$/, 'editorconfig', 'EditorConfig', 'tool', 1],
  [/^vercel\.json$/, 'vercel', 'Vercel', 'infra', 0.95],
  [/^netlify\.toml$/, 'netlify', 'Netlify', 'infra', 0.95],
  [/^fly\.toml$/, 'fly', 'Fly.io', 'infra', 0.95],
  [/^Procfile$/, 'procfile', 'Procfile', 'infra', 0.8],
  [/^(nginx\.conf|nginx\/.*\.conf)$/, 'nginx', 'nginx', 'infra', 0.8],
  [/^Makefile$/, 'make', 'Make', 'tool', 0.9],
  [/^justfile$/i, 'just', 'just', 'tool', 0.9],
  [/^(pint\.json)$/, 'pint', 'Pint', 'tool', 0.95],
  [/^(\.php-cs-fixer(\.dist)?\.php)$/, 'php-cs-fixer', 'PHP CS Fixer', 'tool', 0.95],
  [/^phpstan(\.dist)?\.neon$/, 'phpstan', 'PHPStan', 'tool', 0.95],
  [/^(\.pre-commit-config\.yaml)$/, 'pre-commit', 'pre-commit', 'tool', 0.95],
  [/^(\.nvmrc|\.node-version)$/, 'node', 'Node.js', 'runtime', 0.5],
  [/^renovate\.json5?$|^\.github\/dependabot\.ya?ml$/, 'dependency-bot', 'Dependabot/Renovate', 'tool', 0.9],
];

export const tooling = {
  id: 'tooling',
  async detect(root, idx) {
    const st = [];
    const add = (s) => { if (!st.some((x) => x.id === s.id)) st.push(s); };
    for (const f of idx.files) {
      const p = f.path;
      if (p.split('/').length > 2) continue;
      for (const [re, id, name, cat, conf] of CONFIG_FILES) if (re.test(p)) add(stack(id, name, cat, { confidence: conf, source: p }));
    }
    if (idx.dirExists('.husky')) add(stack('husky', 'Husky', 'tool', { confidence: 0.98, source: '.husky' }));
    if (idx.dirExists('.devcontainer') || idx.has('.devcontainer.json')) add(stack('devcontainer', 'Dev Container', 'infra', { confidence: 0.98, source: '.devcontainer' }));
    if (idx.has('prisma/schema.prisma')) add(stack('prisma', 'Prisma', 'db', { confidence: 0.98, source: 'prisma/schema.prisma' }));
    if (idx.find((p) => /^tests\/.*Pest\.php$/.test(p)).length) add(stack('pest', 'Pest', 'testing', { confidence: 0.9, source: 'tests/Pest.php' }));
    if (idx.has('bun.lockb') || idx.has('bun.lock')) add(stack('bun', 'Bun', 'runtime', { confidence: 0.9, source: 'bun.lockb' }));
    return { stacks: st };
  },
};

const AI = [
  ['claude', (i) => i.has('CLAUDE.md') || i.dirExists('.claude') || i.has('.mcp.json')], ['codex', (i) => i.has('AGENTS.md') || i.dirExists('.codex')],
  ['cursor', (i) => i.has('.cursorrules') || i.dirExists('.cursor')], ['copilot', (i) => i.has('.github/copilot-instructions.md')],
  ['windsurf', (i) => i.has('.windsurfrules') || i.dirExists('.windsurf')], ['gemini', (i) => i.has('GEMINI.md') || i.dirExists('.gemini')],
  ['cline', (i) => i.has('.clinerules') || i.dirExists('.clinerules')], ['roo', (i) => i.dirExists('.roo') || i.has('.roorules')],
  ['aider', (i) => i.has('.aider.conf.yml') || i.has('CONVENTIONS.md')], ['continue', (i) => i.dirExists('.continue')],
  ['zed', (i) => i.dirExists('.zed') || i.has('.rules')], ['junie', (i) => i.dirExists('.junie')], ['amazonq', (i) => i.dirExists('.amazonq')],
];
export const ai = {
  id: 'ai',
  async detect(root, idx) {
    const tools = AI.filter(([, fn]) => fn(idx)).map(([id]) => id);
    if (!tools.length) return {};
    const s = stack('ai-tools', `AI tools (${tools.length})`, 'ai', { confidence: 0.9, source: tools.join(', ') });
    s.count = tools.length; s.tools = tools;
    return { stacks: [s], framework: { ai: { count: tools.length, tools } } };
  },
};
