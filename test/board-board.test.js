import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmp, put, read, makeApi } from './files-util.js';
import { parseMdTasks } from '../src/board/index.js';

const MD = `# Plan

## Now
- [ ] Ship login !high #auth @due(2026-11-01) @anna
  - [x] write form
  - [ ] add tests
- [/] Refactor api #tech
- [x] Done thing

\`\`\`
- [ ] not a task
\`\`\`
`;

test('parse: status, meta, checklist, stable ids, fences', () => {
  const t = parseMdTasks('PLAN.md', MD);
  assert.equal(t.length, 3);
  assert.equal(t[0].title, 'Ship login');
  assert.equal(t[0].priority, 'high');
  assert.deepEqual(t[0].labels, ['auth']);
  assert.equal(t[0].due, '2026-11-01');
  assert.equal(t[0].assignee, 'anna');
  assert.deepEqual(t[0].checklist.map((c) => [c.text, c.done]), [['write form', true], ['add tests', false]]);
  assert.equal(t[1].status, 'doing');
  assert.equal(t[2].status, 'done');
  assert.equal(t[0].section, 'Now');
  const moved = parseMdTasks('PLAN.md', '\n\n\n' + MD);
  assert.equal(moved[0].id, t[0].id);
  assert.notEqual(parseMdTasks('OTHER.md', MD)[0].id, t[0].id);
});

test('board: GET shape, native CRUD, comments, columns, SSE', async () => {
  const r = tmp();
  put(r, 'PLAN.md', MD);
  const { ctx, api } = await makeApi(r);
  const b = (await api('GET', '/api/board')).body;
  assert.equal(b.columns.length, 5);
  assert.equal(b.tasks.length, 3);
  assert.ok(b.labels.includes('auth'));
  assert.ok(b.assignees.includes('anna'));
  const c = await api('POST', '/api/board/task', { task: { title: 'Native one', priority: 'low', labels: ['x'] } });
  assert.equal(c.status, 200);
  const id = c.body.task.id;
  assert.equal(c.body.task.source, 'native');
  assert.equal(c.body.task.status, 'todo');
  assert.ok(ctx.sent.some(([n]) => n === 'board'));
  assert.equal((await api('POST', '/api/board/move', { id, status: 'review', order: 5 })).body.task.status, 'review');
  assert.equal((await api('POST', '/api/board/update', { id, patch: { title: 'Renamed', due: '2026-12-01' } })).body.task.title, 'Renamed');
  assert.equal((await api('POST', '/api/board/update', { id, patch: { priority: 'bogus' } })).status, 400);
  assert.equal((await api('POST', '/api/board/comment', { id, text: 'hello' })).body.comment.text, 'hello');
  const cols = [{ id: 'todo', title: 'To do', wip: 3 }, { id: 'done', title: 'Done' }];
  assert.equal((await api('POST', '/api/board/columns', { columns: cols })).status, 200);
  assert.equal((await api('GET', '/api/board')).body.tasks.find((t) => t.id === id).status, 'done'); // review -> last col
  assert.equal((await api('POST', '/api/board/delete', { id })).body.deleted, true);
  assert.equal((await api('POST', '/api/board/update', { id, patch: {} })).status, 404);
  // viewers cannot mutate
  assert.equal((await api('POST', '/api/board/task', { task: { title: 'x' } }, 'viewer')).status, 403);
});

test('board: md write-back when edit enabled', async () => {
  const r = tmp();
  put(r, 'PLAN.md', MD);
  const { api } = await makeApi(r, { edit: true });
  const t0 = (await api('GET', '/api/board')).body.tasks.find((t) => t.title === 'Ship login');
  const m = await api('POST', '/api/board/move', { id: t0.id, status: 'doing', order: 1 });
  assert.equal(m.body.mdSynced, true);
  assert.match(read(r, 'PLAN.md'), /- \[\/\] Ship login/);
  const u = await api('POST', '/api/board/update', { id: t0.id, patch: { priority: 'urgent', due: '2027-01-01' } });
  assert.equal(u.body.mdSynced, true);
  assert.match(read(r, 'PLAN.md'), /Ship login .*!urgent.*@due\(2027-01-01\)/);
  assert.match(read(r, 'PLAN.md'), /- \[ \] add tests/);
  // title change changes id; response returns new task
  const rn = await api('POST', '/api/board/update', { id: t0.id, patch: { title: 'Ship signup' } });
  assert.equal(rn.body.task.title, 'Ship signup');
  assert.match(read(r, 'PLAN.md'), /Ship signup/);
  // review status (not representable in md) lives in the overlay
  const rv = await api('POST', '/api/board/move', { id: rn.body.task.id, status: 'review' });
  assert.equal(rv.body.task.status, 'review');
  assert.equal((await api('GET', '/api/board')).body.tasks.find((t) => t.id === rn.body.task.id).status, 'review');
  // create md task
  const c = await api('POST', '/api/board/task', { task: { title: 'Added', labels: ['z'], section: 'Now' }, path: 'PLAN.md' });
  assert.equal(c.status, 200);
  assert.match(read(r, 'PLAN.md'), /- \[ \] Added #z/);
  // delete md task removes line (with nested checklist)
  const d = await api('POST', '/api/board/delete', { id: rn.body.task.id });
  assert.equal(d.body.mdSynced, true);
  assert.doesNotMatch(read(r, 'PLAN.md'), /Ship signup|write form/);
});

test('board: md write-back disabled -> overlay + mdSynced:false', async () => {
  const r = tmp();
  put(r, 'PLAN.md', MD);
  const { api } = await makeApi(r, { edit: false });
  const t0 = (await api('GET', '/api/board')).body.tasks.find((t) => t.title === 'Refactor api');
  const m = await api('POST', '/api/board/move', { id: t0.id, status: 'done', order: 2 });
  assert.equal(m.status, 200);
  assert.equal(m.body.mdSynced, false);
  assert.ok(m.body.reason);
  assert.equal(read(r, 'PLAN.md'), MD);
  assert.equal((await api('GET', '/api/board')).body.tasks.find((t) => t.id === t0.id).status, 'done');
  const u = await api('POST', '/api/board/update', { id: t0.id, patch: { title: 'Overlay title' } });
  assert.equal(u.body.mdSynced, false);
  assert.equal(u.body.task.title, 'Overlay title');
  assert.equal((await api('POST', '/api/board/task', { task: { title: 'n' }, path: 'PLAN.md' })).status, 403);
  const del = await api('POST', '/api/board/delete', { id: t0.id });
  assert.equal(del.body.mdSynced, false);
  assert.equal((await api('GET', '/api/board')).body.tasks.some((t) => t.id === t0.id), false);
  assert.equal(read(r, 'PLAN.md'), MD);
});

test('tasks.export writes native tasks to markdown; not re-parsed as md tasks', async () => {
  const r = tmp();
  const { ctx, api } = await makeApi(r);
  await api('POST', '/api/board/task', { task: { title: 'Export me', labels: ['a'] } });
  const { getBoard } = await import('../src/board/index.js');
  const res = await getBoard(ctx).exportMd('TASKS.md');
  assert.equal(res.path, 'TASKS.md');
  assert.match(read(r, 'TASKS.md'), /- \[ \] Export me #a/);
  assert.equal((await api('GET', '/api/board')).body.tasks.length, 1);
  await assert.rejects(getBoard(ctx).exportMd('../x.md'));
});

test('board: adding a checklist item to an md task is kept (overlay), not dropped', async () => {
  const r = tmp();
  put(r, 'PLAN.md', MD);
  const { api } = await makeApi(r, { edit: true });
  const t0 = (await api('GET', '/api/board')).body.tasks.find((t) => t.checklist.length === 2);
  const list = [...t0.checklist, { text: 'new item', done: false }];
  const u = await api('POST', '/api/board/update', { id: t0.id, patch: { checklist: list } });
  assert.equal(u.status, 200);
  const again = (await api('GET', '/api/board')).body.tasks.find((t) => t.id === t0.id);
  assert.deepEqual(again.checklist.map((c) => c.text), list.map((c) => c.text));
});
