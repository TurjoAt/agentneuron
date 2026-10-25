// `agentneuron verify`: truth check of context-file claims against the repo.
import { createHeadlessCtx } from '../core/headless.js';
import { verifyContext, claimFix } from '../verify/index.js';
import { maskSecretsInText } from '../health/secrets.js';
import { maskDeep } from '../server/mask.js';

export async function loadInput(root) {
  const ctx = await createHeadlessCtx(root, {}, { git: false });
  return { root: ctx.root, files: ctx.allFiles(), contents: ctx.store.contents };
}

export async function cmdVerify(root, flags, log = console) {
  const input = await loadInput(root);
  const r = verifyContext(input);
  const bad = r.claims.filter((c) => c.status === 'false');
  if (flags.json) {
    const out = { root: input.root, summary: r.summary, claims: flags.all ? r.claims : r.claims.filter((c) => c.status !== 'ok') };
    if (flags['fix-preview']) out.fixes = bad.map((c) => claimFix({ ...input, id: c.id })).filter(Boolean).map((f) => ({ path: f.path, line: f.line, from: f.from, to: f.to }));
    log.log(JSON.stringify(maskDeep(out), null, 2));
    return bad.length ? 1 : 0;
  }
  const shown = flags.all ? r.claims : r.claims.filter((c) => c.status !== 'ok');
  let last = null;
  for (const c of shown) {
    if (c.file !== last) { log.log(`${last ? '\n' : ''}${c.file}`); last = c.file; }
    log.log(`  ${String(c.line).padStart(4)}  ${c.status.toUpperCase().padEnd(7)} ${c.kind.padEnd(10)} \`${c.text}\`  ${c.evidence}`);
    if (c.status === 'false' && c.suggestion) log.log(`${' '.repeat(23)}fix: ${c.suggestion}`);
    if (flags['fix-preview'] && c.status === 'false') {
      const f = claimFix({ ...input, id: c.id });
      if (f) {
        const a = f.before.split('\n')[f.line - 1]; const b = f.after.split('\n')[f.line - 1];
        log.log(`${' '.repeat(23)}- ${maskSecretsInText(a.trim())}\n${' '.repeat(23)}+ ${maskSecretsInText(b.trim())}`);
      }
    }
  }
  const s = r.summary;
  log.log(`${shown.length ? '\n' : ''}${s.total} claims in ${s.files} context files: ${s.ok} ok, ${s.false} false, ${s.unknown} unknown${!flags.all && s.ok ? ' (--all lists ok claims)' : ''}`);
  return bad.length ? 1 : 0;
}
