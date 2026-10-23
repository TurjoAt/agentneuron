// File-level commands shared by the tree, viewer, peek card, palette and context menus.
import { post } from './api.js';
import { app, navigate, openFile, toast, toggleBookmark, isBookmarked, loadFiles } from './store.svelte.js';
import { canRun, levelReason } from './actions.svelte.js';
import { dirname } from './format.js';

export const openModal = (kind, props = {}) => (app.modal = { kind, props });
export const closeModal = () => (app.modal = null);

export function newFile(dir = '') {
  openModal('new-file', { dir });
}
export function renameFile(path) {
  openModal('rename', { path });
}
export function findReplace(q = '', paths = null) {
  openModal('replace', { q, paths });
}
export function createTask(opts = {}) {
  openModal('task', { create: true, ...opts });
}
export function openTask(id) {
  openModal('task', { id });
}

export function copyPath(path) {
  navigator.clipboard?.writeText(path).then(
    () => toast('Path copied', 'ok', 1600),
    () => toast(path, 'info')
  );
}

export function revealInGraph(path) {
  navigate('graph', { focus: path });
}

export async function deleteFile(path) {
  if (!canRun('edit')) return toast(levelReason('edit'), 'warn', 6000);
  openModal('confirm', {
    title: 'Move to trash?',
    icon: 'trash',
    tone: 'danger',
    body: `${path} will be moved to .mdctl/trash. You can restore it from Settings → Trash.`,
    cta: 'Move to trash',
    run: async () => {
      try {
        const r = await post('/api/file/delete', { path });
        await loadFiles().catch(() => {});
        if (app.route.params.path === path) navigate('files', {});
        const id = r?.id || r?.trashId;
        toast(`Moved ${path} to trash`, 'ok', 7000, id ? { label: 'Undo', run: () => restoreTrash(id) } : null);
      } catch (e) {
        toast(e.message, 'error');
      }
    },
  });
}

export async function restoreTrash(id) {
  try {
    const r = await post('/api/trash/restore', { id });
    await loadFiles().catch(() => {});
    toast(`Restored ${r?.path || 'file'}`, 'ok');
    return r;
  } catch (e) {
    toast(e.message, 'error');
  }
}

/** Context-menu items for a file path. */
export function fileMenuItems(path, extra = {}) {
  const edit = canRun('edit');
  const er = levelReason('edit');
  return [
    { label: 'Open', icon: 'file', run: () => openFile(path) },
    { label: 'Open in editor', icon: 'edit', run: () => openFile(path, { tab: 'edit' }), disabled: false },
    { label: 'Peek', icon: 'eye', run: () => (app.drawer = { path }) },
    { sep: true },
    { label: isBookmarked(path) ? 'Unpin from sidebar' : 'Pin to sidebar', icon: 'pin', run: () => toggleBookmark(path) },
    { label: 'Copy path', icon: 'copy', run: () => copyPath(path) },
    { label: 'Reveal in graph', icon: 'graph', run: () => revealInGraph(path) },
    { label: 'Show history', icon: 'history', run: () => openFile(path, { tab: 'history' }) },
    { label: 'Diff vs HEAD', icon: 'diff', run: () => navigate('diff', { path, from: 'git:HEAD', to: 'current' }) },
    ...(extra.selection
      ? [{ label: 'Create task from selection', icon: 'tasks', run: () => createTask({ title: extra.selection.slice(0, 140), files: [path], line: extra.line }) }]
      : [{ label: 'Create task for this file', icon: 'tasks', run: () => createTask({ files: [path] }) }]),
    { sep: true },
    { label: 'New file here…', icon: 'filePlus', run: () => newFile(dirname(path)), disabled: !edit, reason: er },
    { label: 'Rename / move…', icon: 'replace', run: () => renameFile(path), disabled: !edit, reason: er },
    { label: 'Find & replace…', icon: 'search', run: () => findReplace('', [path]), disabled: false },
    { label: 'Move to trash', icon: 'trash', danger: true, run: () => deleteFile(path), disabled: !edit, reason: er },
  ];
}
