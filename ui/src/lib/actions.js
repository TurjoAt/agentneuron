// Shared action API (owner: UI-A). Stable exports — UI-B and all views use these.
//
//   runAction(id, params?, opts?) → Promise<Job|null>
//     Opens the ActionDialog (schema form + command preview + confirm; typed
//     confirm for `danger`), starts the job and opens the Jobs dock.
//     Resolves with the Job (status 'ok'|'error'|… once finished when
//     opts.wait !== false, which is the default) or null when cancelled /
//     not permitted. opts:
//       { title?, description?, confirm?: false (skip dialog when no params missing),
//         wait?: boolean = true, silent?: boolean (no toast), dock?: boolean = true }
//   canRun(level)      → boolean   ('read'|'state'|'edit'|'exec'|'danger'|'terminal')
//   actionDef(id)      → registry entry from GET /api/actions (or null)
//   actionEnabled(id)  → { enabled, reason }
//   levelReason(level) → human reason why a level is off ('' when on)
//   loadActions()      → refresh the registry list
//   jobs               → reactive jobs store (see actions.svelte.js)

export {
  runAction,
  canRun,
  actionDef,
  actionEnabled,
  levelReason,
  loadActions,
  jobs,
  actionsState,
  openJob,
  cancelJob,
} from './actions.svelte.js';
