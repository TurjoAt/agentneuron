import { getBoard } from '../board/index.js';

export default function register(registry, ctx) {
  registry.register({
    id: 'tasks.export', title: 'Export native tasks to markdown', category: 'tasks', level: 'edit',
    description: 'Write native board tasks to a markdown file (default TASKS.md).',
    params: { path: { type: 'path', default: 'TASKS.md', label: 'Path' } },
    preview: (p) => ({ summary: `Write native tasks to ${p.path || 'TASKS.md'}` }),
    run: async (p) => getBoard(ctx).exportMd(p.path || 'TASKS.md'),
  });
}
