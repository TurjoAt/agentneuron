// agentneuron usage: token, cost and tool analytics from local agent sessions.
import { getUsage } from '../usage/index.js';

export async function cmdUsage(root, flags, { log = console } = {}) {
  const range = flags.range === undefined ? '30d' : String(flags.range);
  const sum = await getUsage({ root, config: {} }).summary({ range });
  if (flags.json) { log.log(JSON.stringify({ schema: 'agentneuron.usage/v1', ...sum }, null, 2)); return 0; }
  log.log(`usage (${range}): ${sum.kpis.sessions} sessions, $${sum.kpis.usd.toFixed(2)}`);
  return 0;
}
