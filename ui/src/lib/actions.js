// Shared action API (owner: UI-A). UI-B and views call these; UI-A implements them.
// runAction opens the action dialog (params form + command preview + confirm) and
// resolves with the finished/started job, or null if cancelled/not allowed.
export async function runAction(id, params = {}, opts = {}) { return null; }
/** Is an action level ('read'|'state'|'edit'|'exec'|'danger') usable by this viewer? */
export function canRun(level) { return level === 'read'; }
