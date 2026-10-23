import fsp from 'node:fs/promises';
import path from 'node:path';

const KNOWN = {
  '.github': ['CI, issue templates, Copilot instructions', 'github'], '.vscode': ['VS Code settings and tasks', 'vscode'], '.idea': ['JetBrains IDE settings', 'jetbrains'],
  '.husky': ['Git hooks (Husky)', 'husky'], '.devcontainer': ['Dev container definition', 'devcontainer'], '.docker': ['Docker support files', 'docker'],
  '.next': ['Next.js build output', 'next'], '.nuxt': ['Nuxt build output', 'nuxt'], '.vercel': ['Vercel project link', 'vercel'], '.svelte-kit': ['SvelteKit output', 'sveltekit'],
  '.claude': ['Claude Code settings, agents, skills, commands', 'claude'], '.cursor': ['Cursor rules and MCP', 'cursor'], '.codex': ['Codex CLI config', 'codex'],
  '.gemini': ['Gemini CLI config', 'gemini'], '.windsurf': ['Windsurf rules', 'windsurf'], '.continue': ['Continue config', 'continue'], '.roo': ['Roo Code rules', 'roo'],
  '.clinerules': ['Cline rules', 'cline'], '.zed': ['Zed settings', 'zed'], '.junie': ['JetBrains Junie guidelines', 'junie'], '.amazonq': ['Amazon Q rules', 'amazonq'],
  '.mdctl': ['mdctl state, history and cache', 'mdctl'], '.gitlab': ['GitLab templates', 'gitlab'], '.circleci': ['CircleCI config', 'circleci'], '.config': ['Tool config', null],
  '.storybook': ['Storybook config', 'storybook'], '.turbo': ['Turborepo cache', 'turbo'], '.cache': ['Tool cache', null], '.venv': ['Python virtualenv', 'python'], '.yarn': ['Yarn releases/cache', 'yarn'],
  '.changeset': ['Changesets', 'changesets'], '.aider.tags.cache.v3': ['Aider cache', 'aider'],
};
const SKIP = new Set(['.git', 'node_modules']);

async function sizeOf(dir, budget) {
  const files = []; let bytes = 0; const stack = [[dir, '']];
  while (stack.length && budget.n > 0) {
    const [d, rel] = stack.pop();
    let ents; try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (SKIP.has(e.name) || e.name === 'worktrees') continue;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) stack.push([path.join(d, e.name), p]);
      else if (e.isFile()) {
        budget.n--;
        try { bytes += (await fsp.stat(path.join(d, e.name))).size; } catch { /* skip */ }
        if (files.length < 25) files.push(p);
        if (budget.n <= 0) break;
      }
    }
  }
  return { files: files.sort(), bytes };
}

export async function detectDotfolders(root) {
  let ents; try { ents = await fsp.readdir(root, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of ents) {
    if (!e.isDirectory() || !e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const { files, bytes } = await sizeOf(path.join(root, e.name), { n: 3000 });
    const [purpose, tool] = KNOWN[e.name] || ['Project dot-folder', null];
    out.push({ name: e.name, purpose, tool, files, bytes });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
