import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { escapeArgument, escapeCommand, resolveWindowsCommand, resolveSpawn, spawn } from '../src/core/spawn.js';

const files = (...list) => { const s = new Set(list.map((f) => f.toLowerCase())); return (p) => s.has(p.toLowerCase()); };
const winEnv = { Path: 'C:\\Windows\\System32;C:\\Program Files\\nodejs;relative\\bin;;C:\\Users\\a\\AppData\\Roaming\\npm', PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.JS' };
const sys = (isFile, env = winEnv) => ({ platform: 'win32', env, comspec: 'C:\\Windows\\System32\\cmd.exe', isFile });

// --- simulate what cmd.exe and the CRT do with our line ------------------------------------------
const META = '()[]%!^"`<>&|;,*?';
/** One cmd.exe parse pass: every metachar must be caret-escaped (never quote mode), then carets are consumed. */
function cmdPass(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '^') { assert.ok(i + 1 < s.length, `dangling caret in ${s}`); out += s[++i]; continue; }
    assert.ok(!META.includes(c), `unescaped ${c} would be interpreted by cmd.exe in: ${s}`);
    out += c;
  }
  return out;
}
/** MSVCRT command-line -> argv. */
function crtSplit(s) {
  const argv = []; let cur = '', inQ = false, has = false;
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === '\\') {
      let n = 0; while (s[i] === '\\') { n++; i++; }
      if (s[i] === '"') { cur += '\\'.repeat(n >> 1); if (n % 2) { cur += '"'; i++; } } else cur += '\\'.repeat(n);
      has = true; continue;
    }
    if (c === '"') { inQ = !inQ; has = true; i++; continue; }
    if ((c === ' ' || c === '\t') && !inQ) { if (has) { argv.push(cur); cur = ''; has = false; } i++; continue; }
    cur += c; has = true; i++;
  }
  if (has) argv.push(cur);
  return argv;
}
/** Full trip for a batch shim: cmd /s /c strips outer quotes, parses; the shim re-parses %*; node's CRT splits. */
function roundTrip(spawnArgs) {
  assert.deepEqual(spawnArgs.slice(0, 3), ['/d', '/s', '/c']);
  const quoted = spawnArgs[3];
  assert.ok(quoted.startsWith('"') && quoted.endsWith('"'));
  const line = quoted.slice(1, -1);
  assert.doesNotMatch(line, /%[^%^\s]+%/, 'a %VAR% reference survives into percent expansion');
  let sp = -1;
  for (let i = 0; i < line.length; i++) { if (line[i] === '^') i++; else if (line[i] === ' ') { sp = i; break; } }
  const first = cmdPass(sp < 0 ? line : line.slice(sp + 1)); // what %* holds in the shim
  return crtSplit(cmdPass(first));
}

test('escapeArgument: exact forms (cross-spawn algorithm)', () => {
  assert.equal(escapeArgument('abc'), '^"abc^"');
  assert.equal(escapeArgument('a&calc', true), '^^^"a^^^&calc^^^"');
  assert.equal(escapeArgument('%PATH%', true), '^^^"^^^%PATH^^^%^^^"');
  assert.equal(escapeArgument('^', true), '^^^"^^^^^^^"');
  assert.equal(escapeArgument('a b'), '^"a^ b^"');
  assert.equal(escapeArgument('"x" & y'), '^"\\^"x\\^"^ ^&^ y^"');
  assert.equal(escapeArgument('a\\"b'), '^"a\\\\\\^"b^"');
  assert.equal(escapeArgument('dir\\'), '^"dir\\\\^"');
  assert.equal(escapeArgument(''), '^"^"');
  assert.equal(escapeCommand('C:\\Program Files (x86)\\npm.cmd'), 'C:\\Program^ Files^ ^(x86^)\\npm.cmd');
});

test('escaped arguments survive cmd.exe + shim re-parse unchanged (injection attempts)', () => {
  const battery = ['a&calc', '"x" & y', '%PATH%', '^', 'a b', 'x&echo pwned>marker', 'a" & calc & "b', '|', '<in', '>out', '(x)', '!PATH!',
    'a\\"b', 'dir\\', 'C:\\path with space\\', '\\\\server\\share', '', ' ', '"', '""', '\\', 'a;b,c', '*?', '`whoami`', '@scope/pkg@^1.2.3', 'name@>=1 <2', 'ünï©ødé'];
  const isFile = files('C:\\Program Files\\nodejs\\npm.cmd');
  for (const a of battery) {
    const r = resolveSpawn('npm', ['install', a], {}, sys(isFile));
    assert.equal(r.file, 'C:\\Windows\\System32\\cmd.exe');
    assert.equal(r.options.windowsVerbatimArguments, true);
    assert.equal(r.options.shell, false);
    assert.deepEqual(roundTrip(r.args), ['install', a], `arg ${JSON.stringify(a)}`);
  }
});

test('resolveSpawn: line breaks cannot be passed through cmd.exe', () => {
  const isFile = files('C:\\Program Files\\nodejs\\npm.cmd');
  assert.throws(() => resolveSpawn('npm', ['a\nb'], {}, sys(isFile)), /line breaks/);
  assert.throws(() => resolveSpawn('npm', ['a\r&calc'], {}, sys(isFile)), /line breaks/);
});

test('resolveWindowsCommand: PATH + PATHEXT, case-insensitive env keys, no cwd, no extensionless files', () => {
  const isFile = files('C:\\Program Files\\nodejs\\npm', 'C:\\Program Files\\nodejs\\npm.cmd', 'C:\\Windows\\System32\\where.exe',
    'C:\\Users\\a\\AppData\\Roaming\\npm\\pnpm.cmd', 'relative\\bin\\evil.cmd', 'C:\\proj\\npm.cmd', 'C:\\Program Files\\nodejs\\tool.js', 'C:\\Program Files\\nodejs\\tool.vbs');
  const o = { env: winEnv, isFile, cwd: 'C:\\proj' };
  assert.equal(resolveWindowsCommand('npm', o), 'C:\\Program Files\\nodejs\\npm.cmd', 'sh script `npm` is skipped; project npm.cmd in cwd is ignored');
  assert.equal(resolveWindowsCommand('pnpm', o), 'C:\\Users\\a\\AppData\\Roaming\\npm\\pnpm.cmd');
  assert.equal(resolveWindowsCommand('where', o), 'C:\\Windows\\System32\\where.exe');
  assert.equal(resolveWindowsCommand('evil', o), null, 'relative PATH entries are skipped');
  assert.equal(resolveWindowsCommand('tool', o), null, '.js/.vbs from PATHEXT are not runnable here');
  assert.equal(resolveWindowsCommand('nope', o), null);
  assert.equal(resolveWindowsCommand('npm', { ...o, env: { PATH: 'C:\\Program Files\\nodejs' } }), 'C:\\Program Files\\nodejs\\npm.cmd', 'default PATHEXT');
  assert.equal(resolveWindowsCommand('npm.cmd', o), 'C:\\Program Files\\nodejs\\npm.cmd');
  assert.equal(resolveWindowsCommand('.\\npm', o), 'C:\\proj\\npm.cmd', 'explicit relative path resolves against cwd');
  assert.equal(resolveWindowsCommand('C:/Program Files/nodejs/npm', o), 'C:\\Program Files\\nodejs\\npm.cmd');
  // first PATH directory wins; extensions are tried per directory
  const isFile2 = files('C:\\a\\x.cmd', 'C:\\b\\x.exe');
  assert.equal(resolveWindowsCommand('x', { env: { path: 'C:\\a;C:\\b' }, isFile: isFile2 }), 'C:\\a\\x.cmd');
  assert.equal(resolveWindowsCommand('x', { env: { path: '"C:\\b";C:\\a' }, isFile: isFile2 }), 'C:\\b\\x.exe', 'quoted PATH entries');
});

test('resolveSpawn: .exe direct, .cmd via cmd.exe, unresolved and non-Windows unchanged', () => {
  const isFile = files('C:\\Program Files\\nodejs\\node.exe', 'C:\\Program Files\\nodejs\\npx.cmd');
  const exe = resolveSpawn('node', ['-v'], { cwd: 'C:\\p' }, sys(isFile));
  assert.deepEqual(exe, { file: 'C:\\Program Files\\nodejs\\node.exe', args: ['-v'], options: { cwd: 'C:\\p' } });
  const shim = resolveSpawn('npx', ['-y', 'pkg'], { stdio: 'pipe' }, sys(isFile));
  assert.deepEqual(shim.args, ['/d', '/s', '/c', '"C:\\Program^ Files\\nodejs\\npx.cmd ^^^"-y^^^" ^^^"pkg^^^""']);
  assert.equal(shim.options.stdio, 'pipe');
  assert.deepEqual(resolveSpawn('missing', ['a'], {}, sys(isFile)), { file: 'missing', args: ['a'], options: {} });
  assert.deepEqual(resolveSpawn('npm', ['a&b'], { env: {} }, { platform: 'linux' }), { file: 'npm', args: ['a&b'], options: { env: {} } });
  // the child env (options.env) is what PATH is read from
  const r = resolveSpawn('npx', [], { env: { Path: 'C:\\Program Files\\nodejs' } }, { platform: 'win32', isFile, comspec: 'cmd.exe' });
  assert.equal(r.file, 'cmd.exe');
});

test('POSIX: spawn helper runs commands unchanged', { skip: process.platform === 'win32' }, async () => {
  const out = await new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', 'a&b', '%PATH%'], { stdio: ['ignore', 'pipe', 'inherit'] });
    let s = ''; c.stdout.on('data', (d) => { s += d; }); c.on('error', reject); c.on('close', () => resolve(s));
  });
  assert.deepEqual(JSON.parse(out), ['a&b', '%PATH%']);
});

test('Windows: real .cmd shim receives arguments verbatim and nothing is injected', { skip: process.platform !== 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'an spawn (x) '));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'an-work-'));
  fs.writeFileSync(path.join(dir, 'echo.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
  fs.writeFileSync(path.join(dir, 'anshim.cmd'), `@"${process.execPath}" "${path.join(dir, 'echo.js')}" %*\r\n`);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH'));
  env.Path = `${dir};${process.env.Path || process.env.PATH || ''}`;
  const battery = ['a&calc', '"x" & y', '%PATH%', '^', 'a b', 'x&echo pwned>marker', 'a" & echo pwned>marker & "b', '|', '(x)', '!PATH!', 'a\\"b', 'dir\\', '', 'ünï', '@scope/pkg@^1.2.3'];
  const out = await new Promise((resolve, reject) => {
    const c = spawn('anshim', battery, { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let s = '', e = ''; c.stdout.on('data', (d) => { s += d; }); c.stderr.on('data', (d) => { e += d; });
    c.on('error', reject); c.on('close', (code) => (code === 0 ? resolve(s) : reject(new Error(`exit ${code}: ${e}`))));
  });
  assert.deepEqual(JSON.parse(out), battery);
  assert.equal(fs.existsSync(path.join(work, 'marker')), false, 'injected command ran');
  assert.equal(fs.existsSync(path.join(dir, 'marker')), false, 'injected command ran');
});
