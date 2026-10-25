// `agentneuron compile`, `agentneuron rules import|list`, `agentneuron generate`.
import fs from 'node:fs';
import path from 'node:path';
import { createHeadlessCtx } from '../core/headless.js';
import { ensureAgentneuronDir } from '../core/config.js';
import { planCompile, applyCompile, applyMergeBack, planImport, applyImport, generateContext, GEN_TARGETS, loadRules } from '../compiler/index.js';

const ICON = { create: '+', update: '~', delete: '-', skip: '!', none: '=' };

/** Print a compact diff (changed lines with 1 line of context). */
function printDiff(log, diff, max = 200) {
  const h = diff?.hunks || [];
  const changed = (i) => !!h[i] && h[i].type !== 'ctx';
  const keep = h.map((x, i) => changed(i) || changed(i - 1) || changed(i + 1));
  let n = 0, gap = false;
  for (let i = 0; i < h.length && n < max; i++) {
    if (!keep[i]) { if (!gap) { log.log('    ...'); gap = true; } continue; }
    gap = false; n++;
    log.log(`    ${h[i].type === 'add' ? '+' : h[i].type === 'del' ? '-' : ' '} ${h[i].text}`);
  }
  if (n >= max) log.log('    ... (diff truncated)');
}

function report(log, plan, { diff = false } = {}) {
  for (const r of plan.invalid) log.log(`! ${r.file}: ${r.errors.join('; ')}`);
  for (const o of plan.outputs) {
    const notes = [...o.conflicts, ...(o.error ? [o.error] : [])];
    const edited = o.regions.filter((r) => r.status === 'edited').map((r) => r.slug);
    if (o.action === 'none' && !notes.length && !edited.length) continue;
    log.log(`${ICON[o.action] || '?'} ${o.path}${o.action !== 'none' ? ` (${o.action})` : ''}${edited.length ? `  edited by hand: ${edited.join(', ')}` : ''}`);
    for (const n of notes) log.log(`    ${n}`);
    if (diff && o.diff) printDiff(log, o.diff);
  }
}

export async function cmdCompile(root, flags, log = console) {
  const ctx = await createHeadlessCtx(root, {}, { git: false });
  const tools = typeof flags.tools === 'string' ? flags.tools : undefined;
  let plan = planCompile(ctx, { tools, force: flags.force === true });
  if (flags.json && !flags['merge-back'] && (flags.check || flags['dry-run'])) {
    log.log(JSON.stringify({ ok: plan.ok, stale: plan.stale, invalid: plan.invalid, outputs: plan.outputs.map(({ content: _c, diff: _d, ...o }) => o), mergeBack: plan.mergeBack.map(({ content: _c, diff: _d, copies: _x, frontmatter: _f, ...m }) => m) }, null, 2));
    return flags.check && !plan.ok ? 1 : 0;
  }
  if (!plan.rules.length && !plan.outputs.length) { log.error(`no source rules in ${plan.rulesDir}/ (create some, or run: agentneuron rules import)`); return flags.check ? 1 : 0; }
  if (!flags.check && !flags['dry-run']) ensureAgentneuronDir(root); // writes keep history/trash in .agentneuron/ (gitignored)
  if (flags['merge-back']) {
    if (!plan.mergeBack.length) log.log('nothing to merge back');
    for (const m of plan.mergeBack) {
      log.log(`< ${m.file} from ${m.paths.join(', ')}${m.conflict ? '  CONFLICT: copies differ' : ''}`);
      printDiff(log, m.diff);
    }
    if (flags['dry-run']) return 0;
    const r = applyMergeBack(ctx, plan);
    for (const s of r.skipped) log.error(`skipped ${s.slug}: ${s.reason}`);
    if (r.merged.length) log.log(`merged ${r.merged.length} rule(s) back into ${plan.rulesDir}/`);
    plan = planCompile(ctx, { tools });
  }
  if (flags.check) {
    report(log, plan);
    log.log(plan.ok ? 'compiled outputs are up to date' : `${plan.stale} output(s) out of date${plan.edited.length ? `, ${plan.edited.length} region(s) edited by hand` : ''}: run agentneuron compile${plan.edited.length ? ' --merge-back' : ''}`);
    return plan.ok ? 0 : 1;
  }
  report(log, plan, { diff: flags['dry-run'] === true });
  if (flags['dry-run']) { log.log(`${plan.stale} file(s) would change (dry run)`); return 0; }
  const r = await applyCompile(ctx, plan);
  for (const e of r.errors) log.error(`error ${e.path}: ${e.error}`);
  log.log(`wrote ${r.written.length} file(s)${r.deleted.length ? `, moved ${r.deleted.length} to trash` : ''}${plan.edited.length ? `; ${plan.edited.length} hand-edited region(s) left alone (use --merge-back or --force)` : ''}`);
  return r.errors.length ? 1 : 0;
}

export async function cmdRules(root, sub, flags, log = console) {
  const ctx = await createHeadlessCtx(root, {}, { git: false });
  if (sub === 'list' || !sub) {
    const { dir, rules, invalid } = loadRules(ctx.root, ctx.config);
    if (flags.json) { log.log(JSON.stringify({ dir, rules: rules.map(({ text: _t, frontmatter: _f, body: _b, ...r }) => r), invalid }, null, 2)); return 0; }
    for (const r of rules) log.log(`${r.slug.padEnd(28)} p${String(r.priority).padEnd(4)} ${r.tools.length === 6 ? 'all tools' : r.tools.join(',')}  ${r.scope.length ? r.scope.join(',') : '(everywhere)'}${r.errors.length ? `  ERROR: ${r.errors.join('; ')}` : ''}`);
    log.log(`${rules.length} rule(s) in ${dir}/`);
    return invalid.length ? 1 : 0;
  }
  if (sub !== 'import') { log.error(`agentneuron rules: unknown subcommand "${sub}" (import, list)`); return 2; }
  const plan = planImport(ctx);
  for (const r of plan.rules) log.log(`+ ${plan.dir}/${r.slug}.md  [${r.tools.join(', ')}]${r.scope.length ? ` scope ${r.scope.join(',')}` : ''}  from ${r.from.map((f) => `${f.path}:${f.line}`).join(', ')}`);
  for (const d of plan.duplicates) log.log(`= ${d.from.path}:${d.from.line} ${d.identical ? 'duplicates' : 'nearly duplicates'} ${d.into.path}:${d.into.line} (${d.title})`);
  if (flags['dry-run']) { log.log(`${plan.rules.length} rule(s) would be created (dry run)`); return 0; }
  ensureAgentneuronDir(root);
  const r = applyImport(ctx, plan);
  for (const e of r.errors) log.error(`error ${e.slug}: ${e.error}`);
  log.log(`created ${r.created.length} rule(s) in ${r.dir}/. Next: review them, then agentneuron compile --dry-run`);
  return r.errors.length ? 1 : 0;
}

export async function cmdGenerate(root, flags, log = console) {
  const tool = typeof flags.tool === 'string' ? flags.tool : 'agents';
  if (!Object.hasOwn(GEN_TARGETS, tool)) { log.error(`agentneuron: --tool must be one of ${Object.keys(GEN_TARGETS).join(', ')}`); return 2; }
  const g = await generateContext(root, { tool });
  if (!flags.out) { process.stdout.write(g.content); return 0; }
  const dest = flags.out === true ? path.join(root, g.path) : path.resolve(String(flags.out));
  if (fs.existsSync(dest) && !flags.force) { log.error(`agentneuron: ${dest} exists; pass --force to overwrite (or omit --out to print)`); return 1; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, g.content, { flag: flags.force ? 'w' : 'wx' });
  log.error(`wrote ${dest} (${g.items.length} cited line(s))`);
  return 0;
}
