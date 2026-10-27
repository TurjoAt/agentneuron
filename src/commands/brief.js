// agentneuron resume | preflight | pack | debug (agent C). Read-only; see docs/brief.md.
import path from 'node:path';
import { createHeadlessCtx } from '../core/headless.js';
import { briefCtx, buildResume, checkAction, buildPack, buildDebug, MAX_ERROR } from '../brief/index.js';
import { maskDeep } from '../server/mask.js';

const str = (v) => (typeof v === 'string' ? v : '');
const out = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(maskDeep(v), null, 2));
const fail = (e) => { console.error(`agentneuron: ${e?.message || e}`); return e?.status === 404 || e?.status === 400 ? 1 : 1; };

async function ctxFor(root) {
  const c = await createHeadlessCtx(root, {}, { git: false });
  return briefCtx({ ...c, usageBudgetMs: Infinity });
}

/**
 * Read all of stdin (bounded); '' when stdin is a TTY, empty, or sends nothing within `wait` ms
 * (harnesses may leave an open pipe that never closes; hooks write their event and close at once).
 */
export function readStdin(max = MAX_ERROR, stream = process.stdin, { wait = 400 } = {}) {
  if (!stream || stream.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    const chunks = []; let n = 0; let done = false;
    const finish = () => {
      if (done) return; done = true; clearTimeout(timer);
      stream.off?.('data', onData); stream.off?.('end', finish); stream.off?.('error', finish);
      stream.pause?.(); if (stream === process.stdin) stream.destroy?.();
      resolve(Buffer.concat(chunks).toString('utf8').slice(0, max));
    };
    const timer = setTimeout(() => { if (!n) finish(); }, wait);
    const onData = (c) => { const buf = Buffer.isBuffer(c) ? c : Buffer.from(String(c)); n += buf.length; chunks.push(buf); if (n > max * 2) finish(); };
    stream.on('data', onData); stream.once('end', finish); stream.once('error', finish);
  });
}

const tick = (i) => {
  const parts = [i.label, i.title, i.command && `\`${i.command}\``, i.quote && `"${i.quote}"`].filter(Boolean);
  return `  - ${parts.join(' ')}`;
};

export async function cmdResume(root, flags = {}) {
  try {
    const b = await ctxFor(root);
    const r = await buildResume(b, { session: str(flags.session) || null, task: str(flags.task) || null });
    if (flags.json) { out(r); return 0; }
    if (flags.md) { out(r.markdown); return 0; }
    console.log(`Resume brief: ${r.title || r.source.session || r.source.task || 'latest session'}`);
    if (r.goal.prompt) console.log(`Goal: ${r.goal.prompt.slice(0, 300)}`);
    for (const [name, list] of [['Done', r.done], ['Failed attempts', r.failed], ['Decisions', r.decisions], ['Next steps', r.next]]) {
      console.log(`\n${name} (${list.length})`);
      for (const i of list.slice(0, 15)) console.log(tick(i));
    }
    console.log(`\nFiles: ${r.files.slice(0, 15).map((f) => f.path).join(', ') || 'none'}`);
    console.log(`Runs: ${r.runs.map((x) => `${x.kind} ${x.failed ? `${x.failed} failing` : x.exitCode === 0 ? 'ok' : `exit ${x.exitCode}`}`).join(', ') || 'none recorded'}`);
    console.log('\nUse --md for a Markdown brief to paste into another agent.');
    return 0;
  } catch (e) { return fail(e); }
}

/**
 * Hook input (Claude Code PreToolUse, JSON on stdin): { tool_name, tool_input: { command } | { file_path } | ... }.
 * Returns { command, paths } or null.
 */
export function hookAction(json, root) {
  let o;
  try { o = JSON.parse(json); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const ti = o.tool_input && typeof o.tool_input === 'object' ? o.tool_input : {};
  const cwd = typeof o.cwd === 'string' ? o.cwd : root;
  const rel = (p) => { if (typeof p !== 'string' || !p) return null; const abs = path.resolve(cwd, p); const r = path.relative(root, abs); return !r || r.startsWith('..') || path.isAbsolute(r) ? null : r.split(path.sep).join('/'); };
  if (typeof ti.command === 'string') return { command: ti.command, paths: [] };
  const fp = ti.file_path || ti.notebook_path || ti.path;
  const r = rel(fp);
  return r ? { command: '', paths: [r] } : { command: '', paths: [] };
}

/** Exit 2 on a blocking warning (PreToolUse hooks block on 2 and show stderr to the agent). Fails open. */
export async function cmdPreflight(root, flags = {}, { stdin = process.stdin } = {}) {
  try {
    let command = str(flags.command), paths = str(flags.paths);
    const hook = !command && !paths;
    if (hook) {
      const a = hookAction(await readStdin(256 * 1024, stdin), path.resolve(root));
      if (!a) { if (!flags.json) console.error('agentneuron preflight: pass --command "..." or --paths a,b (or hook JSON on stdin)'); return flags.json ? (out({ warnings: [], blocking: false }), 0) : 0; }
      command = a.command; paths = a.paths.join(',');
    }
    const b = await ctxFor(root);
    const r = await checkAction(b, { command, paths, task: str(flags.task) });
    if (flags.json) out(r);
    else if (!hook || r.warnings.length) {
      const print = r.blocking || hook ? console.error : console.log;
      if (!r.warnings.length) print('preflight: no warnings');
      for (const w of r.warnings) print(`[${w.severity}] ${w.title}\n    why: ${w.why}\n    fix: ${w.fix}${w.source?.file ? `\n    source: ${w.source.file}${w.source.line ? `:${w.source.line}` : ''}` : ''}`);
    }
    return r.blocking ? 2 : 0;
  } catch (e) {
    if (process.env.AGENTNEURON_DEBUG) console.error(`agentneuron preflight: ${e?.message || e}`);
    return 0; // never block an agent because the checker itself failed
  }
}

export async function cmdPack(root, flags = {}) {
  try {
    const task = str(flags.task).trim();
    if (!task) { console.error('agentneuron pack: --task "describe the task" is required'); return 1; }
    const b = await ctxFor(root);
    const r = await buildPack(b, { task, budget: flags.budget });
    if (flags.json) { out(r); return 0; }
    if (flags.md) { out(r.markdown); return 0; }
    console.log(`Context pack: ${r.items.length} items, ~${r.tokens}/${r.budget} tokens`);
    for (const i of r.items) console.log(`  ${i.kind.padEnd(5)} ${String(i.path || '').padEnd(40)} ${String(i.tokens).padStart(6)}t  ${i.reason || i.text || ''}`.slice(0, 200));
    if (r.skipped.length) console.log(`  (${r.skipped.length} more did not fit; raise --budget)`);
    return 0;
  } catch (e) { return fail(e); }
}

export async function cmdDebug(root, flags = {}, { stdin = process.stdin } = {}) {
  try {
    let error = str(flags.error);
    if (!error && flags.error !== true) error = await readStdin(MAX_ERROR, stdin);
    const b = await ctxFor(root);
    const r = await buildDebug(b, { error, run: error.trim() ? null : 'last' });
    if (flags.json) { out(r); return 0; }
    if (flags.md) { out(r.markdown); return 0; }
    console.log(`${r.error.type}: ${r.error.quote}`);
    const own = r.frames.filter((f) => f.inProject);
    if (own.length) console.log(`Frames: ${own.slice(0, 6).map((f) => `${f.path}:${f.line}${f.recent ? '*' : ''}`).join(', ')}${own.some((f) => f.recent) ? '  (* changed recently)' : ''}`);
    if (!r.hypotheses.length) console.log('No hypothesis has supporting evidence.');
    r.hypotheses.forEach((h, i) => {
      console.log(`\n${i + 1}. ${h.title} (${Math.round(h.confidence * 100)}%)`);
      for (const e of h.evidence.slice(0, 4)) console.log(`   - ${e.label}${e.ref ? ` [${e.ref}]` : ''}`);
      console.log(`   confirm: ${h.check}`);
    });
    return 0;
  } catch (e) { return fail(e); }
}
