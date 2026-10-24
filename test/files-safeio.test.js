import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readRegular, readRegularAsync } from '../src/files/safeio.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-safeio-'));
const canSymlink = (() => { try { const d = tmp(); fs.symlinkSync(d, path.join(d, 'l')); return true; } catch { return false; } })();

test('reads a regular file, honours maxBytes and tail', async () => {
  const root = tmp();
  const f = path.join(root, 'a.md');
  fs.writeFileSync(f, 'hello world');
  assert.equal(readRegular(f).buf.toString(), 'hello world');
  assert.equal((await readRegularAsync(f)).buf.toString(), 'hello world');
  assert.equal(readRegular(f, { maxBytes: 5 }), null);
  assert.equal(await readRegularAsync(f, { maxBytes: 5 }), null);
  assert.equal(readRegular(f, { tail: 5 }).buf.toString(), 'world');
  assert.equal(readRegular(path.join(root, 'missing')), null);
  assert.equal(readRegular(root), null, 'a directory is not a regular file');
});

test('refuses symlinks unless follow, and anything resolving outside confine', { skip: !canSymlink }, async () => {
  const root = tmp(), outside = tmp();
  fs.writeFileSync(path.join(outside, 'secret'), 'x');
  fs.writeFileSync(path.join(root, 'in.md'), 'in');
  fs.symlinkSync(path.join(outside, 'secret'), path.join(root, 'link'));
  fs.symlinkSync(outside, path.join(root, 'dir'));
  assert.equal(readRegular(path.join(root, 'link')), null);
  assert.equal(await readRegularAsync(path.join(root, 'link')), null);
  assert.equal(readRegular(path.join(root, 'link'), { follow: true }).buf.toString(), 'x');
  assert.equal(readRegular(path.join(root, 'link'), { follow: true, confine: root }), null);
  assert.equal(readRegular(path.join(root, 'dir', 'secret'), { confine: root }), null);
  assert.equal(await readRegularAsync(path.join(root, 'dir', 'secret'), { confine: root }), null);
  assert.equal(readRegular(path.join(root, 'in.md'), { confine: root }).buf.toString(), 'in');
});
