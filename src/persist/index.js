// ctx.persist: events.jsonl, metrics.jsonl, audit.
import fs from 'node:fs';
import path from 'node:path';
import { createJsonl, filterRange } from './jsonl.js';
import { createAudit } from './audit.js';

const DEBOUNCE_MS = 5 * 60 * 1000;
const HOURLY = 60 * 60 * 1000;

export function createPersist(ctx, opts = {}) {
  const dir = path.join(ctx.root, '.agentneuron');
  const evLog = createJsonl(path.join(dir, 'events.jsonl'), opts);
  const mLog = createJsonl(path.join(dir, 'metrics.jsonl'), opts);
  const audit = createAudit(ctx.root, opts);
  let lastSnap = 0; let lastScore = null; let timer = null; let snapping = null;

  const events = {
    append(ev) {
      const { file, ...rest } = ev || {};
      return evLog.append({ ...rest, kind: file?.kind, tool: file?.tool });
    },
    query({ from, to, limit = 1000 } = {}) { return filterRange(evLog.readAll(), { from, to, limit }); },
  };

  async function snapshot() {
    if (snapping) return snapping;
    snapping = (async () => {
      const a = await ctx.analysis();
      const files = ctx.allFiles();
      const byTool = {}, byKind = {}; let tokens = 0;
      for (const f of files) {
        tokens += f.tokens || 0;
        byTool[f.tool] = (byTool[f.tool] || 0) + 1;
        byKind[f.kind] = (byKind[f.kind] || 0) + 1;
      }
      let gitDirty = 0;
      if (a.gitAvail) { try { gitDirty = (await ctx.repoInfo())?.dirty || 0; } catch { /* ignore */ } }
      const row = {
        ts: Date.now(), files: files.length, tokens,
        health: a.health.score, grade: a.health.grade,
        errors: a.health.counts.error, warns: a.health.counts.warn, infos: a.health.counts.info,
        tasksOpen: a.tasks.filter((t) => !t.done).length, tasksDone: a.tasks.filter((t) => t.done).length,
        gitDirty, byTool, byKind,
      };
      mLog.append(row);
      lastSnap = row.ts; lastScore = row.health;
      return row;
    })().finally(() => { snapping = null; });
    return snapping;
  }

  const metrics = {
    snapshot,
    query({ from, to, limit } = {}) { return filterRange(mLog.readAll(), { from, to, limit }); },
    /** Call after each analysis recompute; snapshots when health changed (debounced 5 min). */
    onHealth(score) {
      if (score === lastScore || Date.now() - lastSnap < DEBOUNCE_MS) return;
      snapshot().catch(() => {});
    },
  };

  return {
    events, metrics, audit,
    start() {
      try { // keep generated data out of git
        const gi = path.join(dir, '.gitignore');
        let cur = null;
        try { cur = fs.readFileSync(gi, 'utf8'); } catch { /* no .gitignore: nothing to extend */ }
        if (cur !== null) {
          const add = ['trash/', '*.jsonl', '*.jsonl.*', '*.bak'].filter((l) => !cur.split('\n').includes(l));
          if (add.length) fs.appendFileSync(gi, (cur.endsWith('\n') ? '' : '\n') + add.join('\n') + '\n');
        }
      } catch { /* read-only is fine */ }
      snapshot().catch(() => {});
      timer = setInterval(() => snapshot().catch(() => {}), HOURLY);
      timer.unref?.();
    },
    stop() { clearInterval(timer); },
  };
}
