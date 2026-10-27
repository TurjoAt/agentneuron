// Agent brief actions (agent C): brief.save stores a resume brief (or a debug report) under
// .agentneuron/briefs/ and leaves a handoff note so get_handoffs sees it. The brief is recomputed here from
// { session, task } (or a failing run); a client-supplied brief is never stored. Pasted error text is never an
// action param (job params are listed to every role): it is saved with POST /api/brief/debug { save: true }.
import { briefCtx, buildResume, buildDebug, saveBrief } from '../brief/index.js';

const ID = '^[\\w.@:-]{1,200}$';

export default function register(registry, ctx) {
  registry.register({
    id: 'brief.save', title: 'Save agent brief', category: 'brief', level: 'state',
    description: 'Save a resume brief of a session or task (or the debug report of a failing run) to .agentneuron/briefs/ and add a handoff note.',
    params: {
      kind: { type: 'enum', enum: ['resume', 'debug'], default: 'resume', label: 'Kind' },
      session: { type: 'string', pattern: ID, label: 'Session id' },
      task: { type: 'string', pattern: ID, label: 'Task id' },
      run: { type: 'string', pattern: ID, label: 'Run id (debug)' },
    },
    preview: (p) => ({ command: null, summary: p.kind === 'debug' ? 'Save the debug report to .agentneuron/briefs/' : `Save the resume brief of ${p.task ? `task ${p.task}` : p.session ? `session ${p.session}` : 'the latest session'} to .agentneuron/briefs/ and add a handoff note` }),
    async run(p, c, job) {
      const b = briefCtx(c || ctx);
      const brief = p.kind === 'debug'
        ? await buildDebug(b, { error: '', run: p.run || 'last' })
        : await buildResume(b, { session: p.session || null, task: p.task || null });
      const r = saveBrief(b.root, p.kind || 'resume', brief);
      job?.log?.('info', `saved ${r.path}`);
      try { (c || ctx).broadcast?.('brief', { saved: r.id }); } catch { /* ignore */ }
      return r; // { id, path, handoff }: no session text in job results
    },
  });
}
