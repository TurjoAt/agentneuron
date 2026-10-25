// `agentneuron lessons`: proposed rules mined from agent sessions (read-only; accept/dismiss in the UI).
import { createHeadlessCtx } from '../core/headless.js';
import { getInsights } from '../insights/index.js';

export async function cmdLessons(root, flags, log = console) {
  const ctx = await createHeadlessCtx(root, {}, { git: false });
  const { lessons, sessions } = await getInsights(ctx).lessons({ all: flags.all === true });
  const list = flags.covered || flags.all ? lessons : lessons.filter((l) => !l.alreadyCovered);
  if (flags.json) { log.log(JSON.stringify({ root: ctx.root, sessions, lessons: list }, null, 2)); return 0; }
  if (!list.length) { log.log(`No new lessons from ${sessions} agent session(s).`); return 0; }
  log.log(`${list.length} lesson(s) from ${sessions} agent session(s):\n`);
  for (const l of list) {
    log.log(`  [${l.confidence.toFixed(2)}] ${l.rule}`);
    log.log(`         ${l.kinds.join('+')} · ${l.count}x in ${l.sessions} session(s) · add to ${l.target}${l.alreadyCovered ? ` · covered by ${l.alreadyCovered.file}:${l.alreadyCovered.line}` : ''}`);
    if (l.evidence[0]) log.log(`         "${l.evidence[0].quote}" (${l.evidence[0].tool} ${l.evidence[0].session})`);
  }
  log.log('\nAccept or dismiss them in the UI: agentneuron --enable edit, then Insights > Lessons.');
  return 0;
}
