// Task board routes.
import { getBoard } from '../../board/index.js';
import { guard } from './files.js';

export default async function register(router, ctx) {
  const board = getBoard(ctx);
  board.watch();
  const R = (m, p, fn, level) => router[m](p, guard(fn), { level });
  R('get', '/api/board', ({ role }) => board.get(role), 'read');
  // native tasks need only `state`; with `path` the task is appended to markdown and edit is checked inside
  R('post', '/api/board/task', ({ body, role }) => board.create({ task: body?.task || {}, path: body?.path }, role), 'state');
  R('post', '/api/board/update', ({ body, role }) => board.update(body?.id, body?.patch || {}, role), 'state');
  R('post', '/api/board/move', ({ body, role }) => board.move(body?.id, { status: body?.status, order: body?.order }, role), 'state');
  R('post', '/api/board/delete', ({ body, role }) => board.remove(body?.id, role), 'state');
  R('post', '/api/board/comment', ({ body, role }) => board.comment(body?.id, body?.text, role), 'state');
  R('post', '/api/board/columns', ({ body }) => board.setColumns(body?.columns), 'state');
}
