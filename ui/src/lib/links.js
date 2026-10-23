// Shared link helpers (owner: UI-A). Resolve md mentions to in-app file links.
import { href } from './nav.js';
export function fileHref(path, line) { return href('files', { path, line }); }
