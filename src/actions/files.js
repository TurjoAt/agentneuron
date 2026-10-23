// File actions (edit level).
import { getOps } from '../files/ops.js';

const parseVars = (v) => { if (v && typeof v === 'object') return v; try { return v ? JSON.parse(v) : {}; } catch { return {}; } };

export default function register(registry, ctx) {
  const ops = () => getOps(ctx);
  registry.register({
    id: 'files.create', title: 'Create file', category: 'files', level: 'edit',
    description: 'Create a new project file, optionally from a template. Never overwrites.',
    params: {
      path: { type: 'path', label: 'Path' },
      template: { type: 'string', label: 'Template id' },
      content: { type: 'text', label: 'Content' },
      vars: { type: 'text', label: 'Template variables (JSON)' },
    },
    preview: (p) => ({ summary: `Create ${p.path || '(template default path)'}${p.template ? ` from template ${p.template}` : ''}` }),
    run: async (p) => ops().create({ path: p.path, content: p.content, template: p.template, vars: parseVars(p.vars) }),
  });
  registry.register({
    id: 'files.rename', title: 'Rename / move file', category: 'files', level: 'edit',
    description: 'Rename or move a file and rewrite links that point to it.',
    params: {
      from: { type: 'path', required: true, label: 'From' },
      to: { type: 'path', required: true, label: 'To' },
      rewriteLinks: { type: 'boolean', default: true, label: 'Rewrite links' },
      dryRun: { type: 'boolean', default: false, label: 'Dry run' },
    },
    preview: async (p) => {
      const r = await ops().rename({ ...p, rewriteLinks: p.rewriteLinks !== false, dryRun: true });
      return { summary: `Move ${r.from} to ${r.to}; rewrites ${r.rewritten.reduce((n, x) => n + x.count, 0)} link(s) in ${r.rewritten.length} file(s)` };
    },
    run: async (p) => ops().rename({ from: p.from, to: p.to, rewriteLinks: p.rewriteLinks !== false, dryRun: !!p.dryRun }),
  });
  registry.register({
    id: 'files.delete', title: 'Delete file (to trash)', category: 'files', level: 'edit',
    description: 'Move a file to .agentneuron/trash. Restorable.',
    params: { path: { type: 'path', required: true, label: 'Path' } },
    preview: (p) => ({ summary: `Move ${p.path} to .agentneuron/trash` }),
    run: async (p) => ops().remove({ path: p.path }),
  });
  registry.register({
    id: 'files.replace', title: 'Find and replace', category: 'files', level: 'edit',
    description: 'Replace text across project markdown files.',
    params: {
      q: { type: 'string', required: true, label: 'Find' },
      replace: { type: 'string', default: '', label: 'Replace with' },
      regex: { type: 'boolean', default: false },
      caseSensitive: { type: 'boolean', default: false },
      word: { type: 'boolean', default: false },
      paths: { type: 'string[]', label: 'Only these files' },
    },
    preview: async (p) => { const r = await ops().replace(p); return { summary: `${r.length} matching line(s)` }; },
    run: async (p) => ops().replace(p, { apply: true }),
  });
}
