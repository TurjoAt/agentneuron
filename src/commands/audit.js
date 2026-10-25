// `agentneuron audit`: agent config security audit.
import { auditAgentConfig } from '../audit/index.js';
import { maskDeep } from '../server/mask.js';
import { loadInput } from './verify.js';

export async function cmdAudit(root, flags, log = console) {
  const input = await loadInput(root);
  const r = maskDeep(auditAgentConfig(input));
  if (flags.json) { log.log(JSON.stringify({ root: input.root, ...r }, null, 2)); return r.counts.high ? 1 : 0; }
  for (const f of r.findings) {
    log.log(`${f.severity.toUpperCase().padEnd(6)} ${f.file}${f.line ? ':' + f.line : ''}  ${f.title}`);
    log.log(`       why: ${f.why}`);
    log.log(`       fix: ${f.fix}`);
  }
  const c = r.counts;
  log.log(`${r.findings.length ? '\n' : ''}risk ${r.score}/100 (${r.level}): ${c.high} high, ${c.medium} medium, ${c.low} low; scanned ${r.scanned.length ? r.scanned.join(', ') : 'no agent config files'}`);
  return c.high ? 1 : 0;
}
