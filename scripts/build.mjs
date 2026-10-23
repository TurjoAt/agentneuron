import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const uiCfg = path.join(root, 'ui/vite.config.js');
const uiOut = path.join(root, 'ui/dist/index.html');

if (fs.existsSync(uiCfg)) {
  const vite = path.join(root, 'node_modules/.bin/vite');
  const r = spawnSync(vite, ['build', '--config', 'ui/vite.config.js'], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) {
    if (process.argv.includes('--strict')) { console.error('vite build failed'); process.exit(r.status || 1); }
    console.warn('[build] WARNING: vite build failed - continuing with the last ui/dist (if any) or the fallback page. Use --strict to fail instead.');
  }
} else {
  console.warn('[build] ui/vite.config.js missing - embedding fallback page');
}

let html = '';
if (fs.existsSync(uiOut)) html = fs.readFileSync(uiOut, 'utf8');
else console.warn('[build] ui/dist/index.html missing - server will serve fallback page');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist/agentneuron.mjs');
await build({
  entryPoints: [path.join(root, 'src/cli.js')],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  legalComments: 'none',
  define: {
    'globalThis.__AGENTNEURON_UI__': JSON.stringify(html),
    'globalThis.__AGENTNEURON_VERSION__': JSON.stringify(pkg.version),
  },
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as __cr } from "node:module";\nconst require = __cr(import.meta.url);',
  },
});
fs.chmodSync(out, 0o755);
console.log(`[build] ${path.relative(root, out)} ${(fs.statSync(out).size / 1024).toFixed(0)} KB (ui ${(html.length / 1024).toFixed(0)} KB)`);
