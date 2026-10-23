import { stack, cleanVersion, hasBinary } from '../util.js';

const DEP_STACKS = [
  ['next', 'next', 'Next.js', 'framework'], ['nuxt', 'nuxt', 'Nuxt', 'framework'], ['nuxt3', 'nuxt', 'Nuxt', 'framework'],
  ['vite', 'vite', 'Vite', 'tool'], ['astro', 'astro', 'Astro', 'framework'], ['@sveltejs/kit', 'sveltekit', 'SvelteKit', 'framework'],
  ['@remix-run/react', 'remix', 'Remix', 'framework'], ['@remix-run/node', 'remix', 'Remix', 'framework'], ['@remix-run/dev', 'remix', 'Remix', 'framework'],
  ['@angular/core', 'angular', 'Angular', 'framework'], ['react', 'react', 'React', 'framework'], ['vue', 'vue', 'Vue', 'framework'],
  ['svelte', 'svelte', 'Svelte', 'framework'], ['solid-js', 'solid', 'Solid', 'framework'],
  ['express', 'express', 'Express', 'framework'], ['@nestjs/core', 'nest', 'NestJS', 'framework'], ['fastify', 'fastify', 'Fastify', 'framework'],
  ['koa', 'koa', 'Koa', 'framework'], ['hono', 'hono', 'Hono', 'framework'], ['electron', 'electron', 'Electron', 'framework'],
  ['tailwindcss', 'tailwind', 'Tailwind CSS', 'tool'], ['typescript', 'typescript', 'TypeScript', 'language'],
  ['eslint', 'eslint', 'ESLint', 'tool'], ['prettier', 'prettier', 'Prettier', 'tool'], ['@biomejs/biome', 'biome', 'Biome', 'tool'],
  ['jest', 'jest', 'Jest', 'testing'], ['vitest', 'vitest', 'Vitest', 'testing'], ['mocha', 'mocha', 'Mocha', 'testing'],
  ['@playwright/test', 'playwright', 'Playwright', 'testing'], ['playwright', 'playwright', 'Playwright', 'testing'], ['cypress', 'cypress', 'Cypress', 'testing'],
  ['prisma', 'prisma', 'Prisma', 'db'], ['@prisma/client', 'prisma', 'Prisma', 'db'], ['drizzle-orm', 'drizzle', 'Drizzle', 'db'],
  ['mongoose', 'mongoose', 'Mongoose', 'db'], ['typeorm', 'typeorm', 'TypeORM', 'db'], ['sequelize', 'sequelize', 'Sequelize', 'db'],
  ['husky', 'husky', 'Husky', 'tool'], ['lint-staged', 'lint-staged', 'lint-staged', 'tool'],
  ['webpack', 'webpack', 'Webpack', 'tool'], ['esbuild', 'esbuild', 'esbuild', 'tool'], ['rollup', 'rollup', 'Rollup', 'tool'],
  ['storybook', 'storybook', 'Storybook', 'tool'], ['@storybook/react', 'storybook', 'Storybook', 'tool'],
  ['@anthropic-ai/sdk', 'anthropic-sdk', 'Anthropic SDK', 'ai'], ['openai', 'openai-sdk', 'OpenAI SDK', 'ai'], ['ai', 'vercel-ai', 'Vercel AI SDK', 'ai'],
  ['@modelcontextprotocol/sdk', 'mcp-sdk', 'MCP SDK', 'ai'], ['langchain', 'langchain', 'LangChain', 'ai'],
  ['@trpc/server', 'trpc', 'tRPC', 'framework'], ['graphql', 'graphql', 'GraphQL', 'framework'],
];

export function pmFromIndex(idx, pkg) {
  const pmField = typeof pkg?.packageManager === 'string' ? pkg.packageManager.split('@')[0] : null;
  const order = [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lockb', 'bun'], ['bun.lock', 'bun'], ['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm']];
  for (const [f, id] of order) if (idx.has(f)) return { id, lockfile: f };
  if (pmField && ['npm', 'pnpm', 'yarn', 'bun'].includes(pmField)) return { id: pmField, lockfile: null };
  return { id: 'npm', lockfile: null };
}

export default {
  id: 'node',
  async detect(root, idx) {
    const pkgPaths = idx.find((p) => /(^|\/)package\.json$/.test(p) && p.split('/').length <= 3);
    if (!pkgPaths.length) return {};
    const res = { stacks: [], manifests: [], packageManagers: [], scripts: [], framework: {} };
    const rootPkg = await idx.readJson('package.json');
    const pm = pmFromIndex(idx, rootPkg);
    res.packageManagers.push({ id: pm.id, lockfile: pm.lockfile, manifest: 'package.json', available: hasBinary(pm.id) });
    const seen = new Map();
    for (const p of pkgPaths.sort()) {
      const pkg = p === 'package.json' ? rootPkg : await idx.readJson(p);
      if (!pkg || typeof pkg !== 'object') continue;
      const deps = [];
      for (const [k, dev] of [['dependencies', false], ['devDependencies', true]]) {
        for (const [name, version] of Object.entries(pkg[k] || {})) deps.push({ name, version: String(version), dev, manager: pm.id });
      }
      res.manifests.push({ path: p, type: 'npm', name: pkg.name || null, version: pkg.version || null, scripts: pkg.scripts || {}, deps });
      for (const [name, command] of Object.entries(pkg.scripts || {})) res.scripts.push({ manager: pm.id, name, command: String(command), source: p });
      for (const d of deps) {
        for (const [dep, id, nm, cat] of DEP_STACKS) {
          if (d.name !== dep || seen.has(id)) continue;
          seen.set(id, true);
          res.stacks.push(stack(id, nm, cat, { version: cleanVersion(d.version), confidence: 0.95, source: `${p} ${d.dev ? 'devDependencies' : 'dependencies'}` }));
        }
      }
      if (p === 'package.json') {
        if (pkg.engines?.node) res.stacks.push(stack('node', 'Node.js', 'runtime', { version: pkg.engines.node, confidence: 0.8, source: 'package.json engines' }));
        else res.stacks.push(stack('node', 'Node.js', 'runtime', { confidence: 0.7, source: 'package.json' }));
        if (!deps.some((d) => d.name === 'typescript') && !idx.has('tsconfig.json')) res.stacks.push(stack('javascript', 'JavaScript', 'language', { confidence: 0.6, source: 'package.json' }));
        res.stacks.push(stack(pm.id, pm.id, 'tool', { confidence: 0.9, source: pm.lockfile || 'package.json' }));
        if (pkg.workspaces) res.framework.workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages || true;
      }
    }
    const ver = (id) => res.stacks.find((s) => s.id === id)?.version || null;
    if (seen.has('next')) res.framework.next = { version: ver('next'), router: idx.find((p) => /^(src\/)?app\/(layout|page)\.\w+$/.test(p)).length ? 'app' : idx.find((p) => /^(src\/)?pages\//.test(p)).length ? 'pages' : null };
    if (seen.has('nuxt')) res.framework.nuxt = { version: ver('nuxt') };
    if (seen.has('vite')) res.framework.vite = { version: ver('vite') };
    if (seen.has('astro')) res.framework.astro = { version: ver('astro') };
    if (seen.has('sveltekit')) res.framework.sveltekit = { version: ver('sveltekit') };
    if (seen.has('remix')) res.framework.remix = { version: ver('remix') };
    if (seen.has('angular')) res.framework.angular = { version: ver('angular') };
    if (seen.has('nest')) res.framework.nest = { version: ver('nest') };
    if (seen.has('express')) res.framework.express = { version: ver('express') };
    if (rootPkg) { res.name = rootPkg.name; res.description = rootPkg.description; res.version = rootPkg.version; }
    return res;
  },
};
