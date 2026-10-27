// Change review actions (agent B): checkpoints. Contract: docs/internal/quality-contract.md (Slice B).
// create/delete/prune: edit. restore: danger, previewed per file; it takes an automatic checkpoint first.
import { createCheckpoint, deleteCheckpoint, pruneCheckpoints, planRestore, restoreCheckpoint, REF_PREFIX } from '../changes/checkpoints.js';
import { repoInfo } from '../changes/diff.js';

const ID = { type: 'string', required: true, label: 'Checkpoint id', pattern: '^[A-Za-z0-9][\\w-]{0,63}$', maxLength: 64 };

export default function register(registry, ctx) {
  const available = async () => (await repoInfo(ctx.root)).ok;
  const def = (d) => registry.register({ category: 'changes', available, ...d });
  const done = () => { try { ctx.invalidate?.(); } catch { /* ignore */ } };

  def({ id: 'changes.checkpoint.create', title: 'Create checkpoint', level: 'edit',
    description: 'Snapshot the working tree (tracked and untracked files, not ignored ones) as a git ref. HEAD, the index and branches are not touched.',
    params: { label: { type: 'string', label: 'Label', maxLength: 200 } },
    preview: (p) => ({ command: ['git', 'update-ref', `${REF_PREFIX}<new id>`, '<snapshot of the working tree>'], summary: `Create checkpoint${p.label ? ` "${p.label}"` : ''}` }),
    run: async (p, c, job) => {
      const cp = await createCheckpoint(ctx.root, { label: p.label || '', source: 'manual' });
      job.log?.('info', `checkpoint ${cp.id} (${cp.files.length} changed file(s))${cp.skipped.length ? `; skipped ${cp.skipped.length} untracked file(s) over 20 MB` : ''}`);
      return cp;
    } });

  def({ id: 'changes.checkpoint.restore', title: 'Restore files from checkpoint', level: 'danger',
    description: 'Restore only the chosen paths to their checkpoint content. Other files, HEAD, the index and branches stay as they are; the current state is saved as an automatic checkpoint first.',
    params: { id: ID, paths: { type: 'string[]', required: true, label: 'Paths' } },
    preview: async (p) => {
      const plan = await planRestore(ctx.root, p.id, p.paths);
      const act = plan.files.filter((f) => f.action !== 'skip');
      const n = (a) => act.filter((f) => f.action === a).length;
      return {
        command: ['restore', p.id, '--', ...act.map((f) => f.path)],
        summary: act.length ? `Overwrite ${n('overwrite')}, re-create ${n('create')}, delete ${n('delete')} file(s); an undo checkpoint is taken first` : 'Nothing to restore: the chosen files are unchanged since the checkpoint',
        files: plan.files,
      };
    },
    run: async (p, c, job) => {
      const r = await restoreCheckpoint(ctx.root, p.id, p.paths, { log: (t) => job.log?.('info', t) });
      done();
      return { restored: r.restored, skipped: r.skipped, undo: r.undo ? { id: r.undo.id, ref: r.undo.ref } : null };
    } });

  def({ id: 'changes.checkpoint.delete', title: 'Delete checkpoint', level: 'edit', description: 'Delete one checkpoint ref (the files on disk are not touched).',
    params: { id: ID },
    preview: (p) => ({ command: ['git', 'update-ref', '-d', REF_PREFIX + p.id], summary: `Delete checkpoint ${p.id}` }),
    run: async (p) => deleteCheckpoint(ctx.root, p.id) });

  def({ id: 'changes.checkpoint.prune', title: 'Prune checkpoints', level: 'edit', description: 'Keep the newest N checkpoints and delete the older refs.',
    params: { keep: { type: 'number', default: 20, min: 0, max: 500, label: 'Keep newest' } },
    preview: (p) => ({ command: ['git', 'update-ref', '-d', `${REF_PREFIX}<older than the newest ${p.keep}>`], summary: `Keep the newest ${p.keep} checkpoints` }),
    run: async (p) => pruneCheckpoints(ctx.root, { keep: p.keep }) });
}
