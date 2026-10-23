// Env check: key NAMES only, never values.
import { envKeys } from './util.js';

const EXAMPLE = ['.env.example', '.env.sample', '.env.dist', '.env.template'];
const ACTUAL = ['.env', '.env.local', '.env.development', '.env.production'];

export async function detectEnv(root, idx) {
  const files = idx.files.map((f) => f.path).filter((p) => !p.includes('/') && /^\.env(\.|$)/.test(p)).sort();
  const exampleKeys = new Set(); const presentKeys = new Set();
  for (const f of files) {
    if (!EXAMPLE.includes(f) && !ACTUAL.includes(f)) continue;
    const t = await idx.read(f, 512 * 1024);
    if (t == null) continue;
    for (const k of envKeys(t)) (EXAMPLE.includes(f) ? exampleKeys : presentKeys).add(k);
  }
  const hasExample = files.some((f) => EXAMPLE.includes(f));
  return {
    files,
    exampleKeys: [...exampleKeys].sort(),
    presentKeys: [...presentKeys].sort(),
    missing: hasExample ? [...exampleKeys].filter((k) => !presentKeys.has(k)).sort() : [],
    extra: hasExample ? [...presentKeys].filter((k) => !exampleKeys.has(k)).sort() : [],
  };
}
