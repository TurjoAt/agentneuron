// Turns failing tests in a TAP file into GitHub Actions error annotations,
// so failures are readable from the run summary (and the public API) without opening logs.
// Usage: node scripts/ci-annotate-tap.mjs test-results.tap
import fs from 'node:fs';

const file = process.argv[2] || 'test-results.tap';
let text = '';
try { text = fs.readFileSync(file, 'utf8'); } catch { console.log(`no TAP file at ${file}`); process.exit(0); }

const lines = text.split(/\r?\n/);
const enc = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
let count = 0;
for (let i = 0; i < lines.length && count < 20; i++) {
  const m = lines[i].match(/^\s*not ok \d+ - (.*)$/);
  if (!m) continue;
  // Skip parent "test file" entries whose only failure is a nested subtest already reported.
  const detail = [];
  for (let j = i + 1; j < lines.length && detail.length < 25; j++) {
    if (/^\s*(not )?ok \d+ /.test(lines[j]) && !/^\s+/.test(lines[i]) === !/^\s+/.test(lines[j])) break;
    if (/^\s*(error|message|code|expected|actual|operator|location|stack|failureType|\s{4,}\S)/.test(lines[j])) detail.push(lines[j].trim());
  }
  console.log(`::error title=${enc(m[1]).slice(0, 200)}::${enc(detail.join('\n')).slice(0, 4000)}`);
  count++;
}
console.log(`${count} failing test(s) annotated`);
