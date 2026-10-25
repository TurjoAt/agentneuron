// Project analysis shared by the server, the CLI and headless contexts: graph, lint, health,
// git status, tasks and decisions, cached until invalidated.
import { buildGraph } from '../analysis/graph.js';
import { extractTasks } from '../analysis/tasks.js';
import { extractDecisions } from '../analysis/decisions.js';
import { lint } from '../health/lint.js';
import { healthScore } from '../health/score.js';

/** One-shot analysis of a file set. git is optional ({ available(), status() }). */
export async function computeAnalysis({ root, files, contents, git = null, warn = () => {} }) {
  let graph = { nodes: [], edges: [] };
  try { graph = buildGraph(files, contents); } catch (e) { warn('graph', e); }
  let issues = [];
  try { issues = lint({ root, files, contents, links: graph.edges }) || []; } catch (e) { warn('lint', e); }
  let health = { score: 100, grade: 'A', counts: { error: 0, warn: 0, info: 0 }, byRule: {} };
  try { health = healthScore(issues, files); } catch (e) { warn('score', e); }
  let gitStatus = new Map(); let gitAvail = false;
  if (git) { try { gitAvail = await git.available(); if (gitAvail) gitStatus = await git.status(); } catch (e) { warn('git', e); } }
  const tasks = [], decisions = [];
  for (const f of files) {
    const c = contents.get(f.path); if (c == null) continue;
    try { for (const t of extractTasks(f.path, c)) tasks.push(t); } catch (e) { warn('tasks', e); }
    try { for (const d of extractDecisions(f.path, c, f.kind)) decisions.push(d); } catch (e) { warn('decisions', e); }
  }
  return { graph, issues, health, gitStatus, gitAvail, tasks, decisions };
}

/**
 * Cached analysis over a live store. invalidate() marks it stale; a change that lands while a
 * compute is in flight (e.g. during `git status`) is not lost: the next analysis() recomputes.
 */
export function createAnalyzer({ root, store, git = null, warn = () => {} }) {
  let gen = 0, cache = null, cacheGen = -1, computing = null;
  async function run() {
    for (let i = 0; i < 3; i++) { // bounded: a constantly-changing tree still gets a (slightly stale) answer
      const g = gen;
      const a = await computeAnalysis({ root, files: [...store.files.values()], contents: store.contents, git, warn });
      cache = a; cacheGen = g;
      if (g === gen) break;
    }
    return cache;
  }
  function analysis() {
    if (cache && cacheGen === gen) return Promise.resolve(cache);
    if (!computing) computing = run().finally(() => { computing = null; });
    return computing;
  }
  return { analysis, invalidate() { gen++; }, get dirty() { return cacheGen !== gen; } };
}
