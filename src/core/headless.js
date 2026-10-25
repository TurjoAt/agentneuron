// Lightweight server-shaped ctx for one-shot CLI work (export, doctor, lint): no HTTP server,
// no watcher, no timers, nothing written to the project (no history, no persist.start()).
import { loadConfig } from './config.js';
import { createStore } from './store.js';
import { createAnalyzer } from './analyze.js';
import { createGit } from '../analysis/git.js';
import { createSessions } from '../agents/sessions.js';
import { createPersist } from '../persist/index.js';

export async function createHeadlessCtx(root, overrides = {}, { git: useGit = true } = {}) {
  const config = loadConfig(root, overrides);
  root = config.root;
  const store = createStore(root, config, { record: false });
  await store.init();
  const git = useGit ? createGit(root) : null;
  const warn = (what, e) => { if (process.env.AGENTNEURON_DEBUG) console.error(`[agentneuron] ${what}:`, e); };
  const analyzer = createAnalyzer({ root, store, git, warn });
  const noop = () => {};
  const ctx = {
    root, config, store, git, sessions: createSessions(root), startedAt: Date.now(), headless: true,
    analysis: analyzer.analysis, invalidate: analyzer.invalidate,
    allFiles: () => [...store.files.values()],
    repoInfo: async () => (git && (await git.available()) ? git.repoInfo().catch(() => null) : null),
    broadcast: noop, notify: noop, warn, can: () => false,
  };
  ctx.persist = createPersist(ctx); // only its readers are used: start() is never called
  return ctx;
}
