import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitWords } from '../src/actions/agentneuron.js';

test('splitWords: POSIX quoting and backslash escapes', () => {
  assert.deepEqual(splitWords(`node -e "console.log(1)" 'a b' c\\ d`, { windows: false }), ['node', '-e', 'console.log(1)', 'a b', 'c d']);
  assert.deepEqual(splitWords(`echo "say \\"hi\\""`, { windows: false }), ['echo', 'say "hi"']);
});

test('splitWords: Windows paths keep their backslashes', () => {
  assert.deepEqual(
    splitWords(`C:\\hostedtoolcache\\node\\22\\x64\\node.exe -e "console.log(1)" "a;b"`, { windows: true }),
    ['C:\\hostedtoolcache\\node\\22\\x64\\node.exe', '-e', 'console.log(1)', 'a;b'],
  );
  assert.deepEqual(splitWords(`"C:\\Program Files\\nodejs\\node.exe" --version`, { windows: true }), ['C:\\Program Files\\nodejs\\node.exe', '--version']);
  assert.deepEqual(splitWords(`echo "say \\"hi\\""`, { windows: true }), ['echo', 'say "hi"']);
});

test('splitWords: unterminated quote is an error', () => {
  assert.throws(() => splitWords(`echo "oops`, { windows: false }), /unterminated quote/);
});
