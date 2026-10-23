import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateLegacyDir, loadConfig } from '../src/core/config.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-migrate-'));

test('legacy .mdctl dir is moved to .agentneuron and its config is read', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.mdctl'));
  fs.writeFileSync(path.join(root, '.mdctl', 'config.json'), JSON.stringify({ port: 5151 }));
  const cfg = loadConfig(root);
  assert.equal(cfg.port, 5151);
  assert.ok(fs.existsSync(path.join(root, '.agentneuron', 'config.json')));
  assert.ok(!fs.existsSync(path.join(root, '.mdctl')));
});

test('existing .agentneuron dir is never overwritten by a legacy dir', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.mdctl'));
  fs.mkdirSync(path.join(root, '.agentneuron'));
  assert.equal(migrateLegacyDir(root), false);
  assert.ok(fs.existsSync(path.join(root, '.mdctl')));
});

test('no legacy dir is a no-op', () => {
  assert.equal(migrateLegacyDir(tmp()), false);
});
