// agentneuron review | checkpoint | packages (agent B). User doc: docs/changes.md.
import { loadConfig } from '../core/config.js';
import { maskDeep } from '../server/mask.js';
import { maskSecretsInText } from '../health/secrets.js';
import {
  reviewChanges, reviewMarkdown, listCheckpoints, createCheckpoint, compareCheckpoint, planRestore, restoreCheckpoint, deleteCheckpoint,
  scanPackages, packagesOnline,
} from '../changes/index.js';

const RANK = { low: 1, medium: 2, high: 3 };
const out = (log, v) => log.log(JSON.stringify(maskDeep(v), null, 2));
const fail = (log, e) => { log.error(`agentneuron: ${maskSecretsInText(String(e?.message || e))}`); return e?.status === 400 || e?.status === 404 ? 2 : 1; };

export async function cmdReview(root, flags, log = console) {
  const failOn = flags['fail-on'];
  if (failOn !== undefined && !RANK[failOn]) { log.error('--fail-on must be high, medium or low'); return 2; }
  let r;
  try { r = await reviewChanges(root, { base: typeof flags.base === 'string' ? flags.base : undefined }); } catch (e) { return fail(log, e); }
  if (!r.available) { log.error(`agentneuron review: ${r.reason}`); return 2; }
  if (flags.json) out(log, r);
  else {
    log.log(maskSecretsInText(reviewMarkdown(r)));
    const low = r.files.filter((f) => f.risk === 'low');
    if (low.length) log.log(`\n${low.length} low-risk file(s) not listed (--json shows all)`);
  }
  if (failOn && r.files.some((f) => RANK[f.risk] >= RANK[failOn])) return 1;
  return 0;
}

const when = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : '?');
const splitPaths = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

export async function cmdCheckpoint(root, sub, flags, log = console) {
  const id = typeof flags.id === 'string' ? flags.id : null;
  try {
    switch (sub || 'list') {
      case 'list': {
        const list = await listCheckpoints(root, { limit: 100 });
        if (flags.json) { out(log, { checkpoints: list }); return 0; }
        if (!list.length) { log.log('No checkpoints yet. Create one with: agentneuron checkpoint create --label "before refactor"'); return 0; }
        for (const c of list) log.log(`${c.id}  ${when(c.createdAt)}  ${c.source.padEnd(6)}  ${String(c.files.length).padStart(3)} file(s)  ${c.label}`);
        return 0;
      }
      case 'create': {
        const c = await createCheckpoint(root, { label: typeof flags.label === 'string' ? flags.label : '', source: 'manual', task: typeof flags.task === 'string' ? flags.task : undefined });
        if (flags.json) { out(log, c); return 0; }
        log.log(`Created checkpoint ${c.id} (${c.files.length} changed file(s)) -> ${c.ref}`);
        if (c.skipped.length) log.log(`Skipped ${c.skipped.length} untracked file(s) over 20 MB: ${c.skipped.slice(0, 5).join(', ')}`);
        return 0;
      }
      case 'diff': {
        if (!id) { log.error('--id is required (see: agentneuron checkpoint list)'); return 2; }
        const r = await compareCheckpoint(root, id);
        if (flags.json) { out(log, r); return 0; }
        const changed = r.files.filter((f) => f.status !== 'same');
        log.log(`Checkpoint ${id}${r.checkpoint.label ? ` "${r.checkpoint.label}"` : ''} vs now: ${changed.length} file(s) differ`);
        for (const f of changed) log.log(`  ${f.status.padEnd(8)} ${f.path}${f.added || f.removed ? `  +${f.added} -${f.removed}` : ''}`);
        return 0;
      }
      case 'restore': {
        if (!id) { log.error('--id is required'); return 2; }
        const paths = splitPaths(flags.paths);
        if (!paths.length) { log.error('--paths a,b is required: restore is selective'); return 2; }
        const plan = await planRestore(root, id, paths);
        for (const f of plan.files) log.log(`  ${f.action.padEnd(9)} ${f.path}${f.reason ? `  (${f.reason})` : ''}`);
        if (!flags.yes) { log.log('\nPreview only. Re-run with --yes to restore these files (an undo checkpoint is taken first).'); return 1; }
        const r = await restoreCheckpoint(root, id, paths);
        log.log(`Restored ${r.restored.length} file(s).${r.undo ? ` Undo: agentneuron checkpoint restore --id ${r.undo.id} --paths ${r.restored.map((f) => f.path).join(',')} --yes` : ''}`);
        return 0;
      }
      case 'delete': {
        if (!id) { log.error('--id is required'); return 2; }
        await deleteCheckpoint(root, id);
        log.log(`Deleted checkpoint ${id}`);
        return 0;
      }
      default:
        log.error(`unknown subcommand "${sub}" (list, create, diff, restore, delete)`);
        return 2;
    }
  } catch (e) { return fail(log, e); }
}

export async function cmdPackages(root, flags, log = console) {
  const config = loadConfig(root);
  const online = flags.online === true || packagesOnline(config); // the CLI runs in the user's own shell
  let r;
  try { r = await scanPackages(root, { online }); } catch (e) { return fail(log, e); }
  if (flags.json) out(log, r);
  else {
    log.log(`${r.deps} dependencies checked${r.lockfiles.length ? ` against ${r.lockfiles.join(', ')}` : ' (no lockfile found)'}${online ? `, ${r.onlineChecked} looked up online` : ' (offline)'}`);
    if (!r.findings.length) log.log('No findings.');
    for (const f of r.findings) {
      log.log(`  ${f.severity.toUpperCase().padEnd(6)} ${f.name}${f.version ? `@${f.version}` : ''}  ${f.code}: ${f.message}${f.manifest ? `  [${f.manifest}]` : ''}`);
      if (f.fix && f.severity !== 'low') log.log(`         fix: ${f.fix}`);
    }
  }
  return r.findings.some((f) => f.severity === 'high') ? 1 : 0;
}
