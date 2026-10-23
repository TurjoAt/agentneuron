// agentneuron's own actions: rescan, history clear, metrics snapshot, terminal.
import fs from 'node:fs';
import path from 'node:path';

/**
 * Simple shell-words split (quotes + backslash escapes). Never passed to a shell.
 * On Windows a backslash is a path separator, so it only escapes a following quote.
 */
export function splitWords(line, { windows = process.platform === 'win32' } = {}) {
  const out = []; let cur = ''; let q = null; let has = false;
  const escapes = (next) => !windows || next === '"';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === q) q = null;
      else if (c === '\\' && q === '"' && i + 1 < line.length && escapes(line[i + 1])) cur += line[++i];
      else cur += c;
    } else if (c === '"' || c === "'") { q = c; has = true; }
    else if (c === '\\' && i + 1 < line.length && escapes(line[i + 1])) { cur += line[++i]; has = true; }
    else if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ''; has = false; }
    else cur += c;
  }
  if (q) throw new Error('unterminated quote');
  if (cur || has) out.push(cur);
  return out;
}

export default function register(registry, ctx) {
  registry.register({
    id: 'agentneuron.rescan', title: 'Rescan project', category: 'agentneuron', level: 'state',
    description: 'Re-read all tracked markdown files and recompute analysis.',
    preview: () => ({ command: null, summary: 'Rescans the project directory' }),
    async run(_p, c, job) {
      await c.store.init();
      c.invalidate();
      c.broadcast('files', { changed: true });
      job.log('info', `rescanned: ${c.store.files.size} files`);
      return { files: c.store.files.size };
    },
  });

  registry.register({
    id: 'agentneuron.history.clear', title: 'Clear file history', category: 'agentneuron', level: 'danger',
    description: 'Deletes all stored file versions in .agentneuron/history (cannot be undone).',
    preview: () => ({ command: null, summary: 'Removes .agentneuron/history/' }),
    async run(_p, c, job) {
      fs.rmSync(path.join(c.root, '.agentneuron', 'history'), { recursive: true, force: true });
      job.log('info', 'history cleared');
      try { await c.store.init(); } catch { /* best effort re-seed */ }
      return { cleared: true };
    },
  });

  registry.register({
    id: 'agentneuron.snapshot', title: 'Record metrics snapshot', category: 'agentneuron', level: 'state',
    description: 'Appends a metrics snapshot to .agentneuron/metrics.jsonl.',
    preview: () => ({ command: null, summary: 'Writes a metrics row' }),
    async run(_p, c) { return c.persist.metrics.snapshot(); },
  });

  registry.register({
    id: 'agentneuron.terminal', title: 'Run command', category: 'agentneuron', level: 'danger', flag: 'terminal',
    description: 'Runs a command line in the project (no shell: words are split and spawned directly).',
    params: {
      command: { type: 'text', required: true, label: 'Command', maxLength: 4000 },
      cwd: { type: 'path', label: 'Working directory', default: '.' },
    },
    preview(p) {
      let words = []; try { words = splitWords(p.command); } catch { /* shown empty */ }
      return { command: words, summary: `Runs: ${words.join(' ')}` };
    },
    async run(p, _c, job) {
      const words = splitWords(p.command);
      if (!words.length) throw new Error('empty command');
      const r = await job.exec(words[0], words.slice(1), { cwd: p.cwd || '.', timeoutMs: 300000 });
      if (r.code !== 0) throw new Error(`exit code ${r.code}`);
      return { code: r.code };
    },
  });
}
