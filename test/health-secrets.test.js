import test from 'node:test';
import assert from 'node:assert/strict';
import { scanSecrets, maskSecretsInText, entropy, isPlaceholder } from '../src/health/secrets.js';

const scan = (s) => scanSecrets('CLAUDE.md', s);

test('detects well-known token formats and masks them', () => {
  const cases = {
    'AWS access key': 'key AKIAQ3EXAMPL4TESTK7Z here',
    'GitHub token': 'ghp_' + 'aB3dE5gH7jK9mN1pQ3sT5vX7zA9cE1gI3kM5',
    'GitHub fine-grained token': 'github_pat_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2W3x4Y5',
    'Anthropic API key': 'sk-ant-api03-' + 'Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0Lm',
    'OpenAI API key': 'sk-proj-' + 'Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0Lm9Nb8',
    'Slack token': 'xoxb-' + '123456789012-abcdefABCDEF1234',
    'Stripe live key': 'sk_live_' + '4eC39HqLyjWDarjtT1zdp7dc',
    'Google API key': 'AIzaSyA-' + 'abcdefghijklmnopqrstuvwxyz01234',
    'JSON Web Token': 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r',
  };
  for (const [label, line] of Object.entries(cases)) {
    const r = scan(line);
    assert.equal(r.length, 1, `${label}: ${JSON.stringify(r)}`);
    assert.ok(r[0].message.startsWith(label), r[0].message);
    assert.equal(r[0].rule, 'secret');
    assert.equal(r[0].line, 1);
    assert.ok(r[0].hint);
  }
  const m = scan('ghp_' + 'aB3dE5gH7jK9mN1pQ3sT5vX7zA9cE1gI3kM5')[0].message;
  assert.match(m, /ghp_\*\*\*\*/);
  assert.ok(!m.includes('aB3dE5'));
});

test('anthropic keys are not double-reported as openai', () => {
  assert.equal(scan('sk-ant-api03-' + 'Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0Lm').length, 1);
});

test('private key block', () => {
  const r = scan('x\n-----BEGIN RSA PRIVATE KEY-----\nabc');
  assert.equal(r.length, 1);
  assert.equal(r[0].line, 2);
  assert.match(r[0].message, /Private key/);
});

test('assignments with high entropy are flagged, masked', () => {
  const r = scan('DB_PASSWORD=Xk9#mQ2vLp7Zr4Tw');
  assert.equal(r.length, 1);
  assert.ok(r[0].message.includes('Xk9#'));
  assert.ok(!r[0].message.includes('mQ2vLp7Zr4Tw'));
  assert.equal(scan('"api_key": "8f3a9c1d5b7e2f4a6c8e0b2d4f6a8c0e"').length, 1);
  assert.equal(scan('client_secret: Pq8rS2tU4vW6xY0z').length, 1);
});

test('placeholders and non-secrets are skipped', () => {
  const ok = [
    'API_KEY=your-api-key',
    'api_key: "xxxxxxxxxxxxxxxx"',
    'token = <token>',
    'password: ${DB_PASSWORD}',
    'OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    'AKIAIOSFODNN7EXAMPLE',
    'secret: changeme-please',
    'password=********',
    'token: process.env.GITHUB_TOKEN',
    'api_key = os.environ["KEY"]',
    'The password must be at least 12 characters',
    'secret_name: my-secret-name',
    'API_TOKEN=SOME_ENV_VAR_NAME',
    'password: "{{ vault_pass }}"',
    'tokens: 5000 per request',
    'const authToken = getToken()',
  ];
  for (const l of ok) assert.deepEqual(scan(l), [], l);
});

test('ids unique and line numbers right', () => {
  const r = scan('ok\nAKIAQ3EXAMPL4TESTK7Z and ghp_' + 'aB3dE5gH7jK9mN1pQ3sT5vX7zA9cE1gI3kM5');
  assert.equal(r.length, 2);
  assert.equal(new Set(r.map((i) => i.id)).size, 2);
  assert.ok(r.every((i) => i.line === 2));
});

test('robust to odd input', () => {
  assert.deepEqual(scanSecrets('a.md', ''), []);
  assert.deepEqual(scanSecrets('a.md', null), []);
  assert.deepEqual(scanSecrets('a.md', 'x'.repeat(100000)), []);
});

test('helpers', () => {
  assert.ok(entropy('aaaa') < entropy('aB3$kLm9'));
  assert.ok(isPlaceholder('<token>'));
  assert.ok(isPlaceholder('your-api-key'));
  assert.ok(!isPlaceholder('Xk9mQ2vLp7Zr4Tw'));
  const masked = maskSecretsInText('curl -H "Authorization: Bearer abcdef1234567890XYZ" https://u:hunter2pass@host');
  assert.ok(!masked.includes('abcdef1234567890XYZ'));
  assert.ok(!masked.includes('hunter2pass'));
});
