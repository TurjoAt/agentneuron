#!/usr/bin/env node
// Capture README screenshots of the AgentNeuron UI with Playwright.
//
//   npm run build                                   # creates dist/agentneuron.mjs
//   npm i --no-save playwright && npx playwright install chromium
//   node scripts/screenshots.mjs [--example claude-code-project] [--port 4790] [--out docs/assets]
//
// Safety: the server only ever sees a temporary COPY of a bundled example
// (never a real project), runs read-only on 127.0.0.1 without a token, and
// gets an empty temporary HOME so no real Claude/Codex sessions or costs
// can appear in the images. All temp dirs are removed afterwards.
//
// If Playwright is installed elsewhere, point PLAYWRIGHT_MODULE at the
// package directory (playwright or playwright-core), e.g.
//   PLAYWRIGHT_MODULE=/usr/lib/node_modules/playwright node scripts/screenshots.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : def;
}

const example = arg('example', 'claude-code-project');
const port = Number(arg('port', '4790'));
const outDir = path.resolve(repo, arg('out', 'docs/assets'));
const bundle = path.join(repo, 'dist', 'agentneuron.mjs');
const exampleDir = path.join(repo, 'examples', example);

// name, hash route, theme, selector that signals the view rendered, extra settle ms
const SHOTS = [
  { name: 'overview', hash: '#/overview', theme: 'dark', settle: 1200 },
  { name: 'overview-light', hash: '#/overview', theme: 'light', settle: 1200 },
  { name: 'graph', hash: '#/graph', theme: 'dark', wait: 'svg, canvas', settle: 4000, click: 'button[title^="Zoom out"]' },
  { name: 'tasks', hash: '#/tasks', theme: 'dark', settle: 1200 },
  { name: 'reports', hash: '#/reports', theme: 'dark', settle: 1500 },
  { name: 'agents', hash: '#/agents', theme: 'dark', settle: 1200 },
  // views that need agent sessions use the built-in demo data (?mock=1): the example project has no transcripts
  { name: 'live', query: '?mock=1', hash: '#/live', theme: 'dark', settle: 6000, motion: true },
  { name: 'verify', query: '?mock=1', hash: '#/verify', theme: 'dark', settle: 1500 },
  { name: 'insights', query: '?mock=1', hash: '#/insights', theme: 'dark', settle: 1500 },
  { name: 'rules', query: '?mock=1', hash: '#/rules', theme: 'dark', settle: 1500 },
];

async function loadPlaywright() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_MODULE) {
    const p = path.resolve(process.env.PLAYWRIGHT_MODULE);
    const pkg = JSON.parse(fs.readFileSync(path.join(p, 'package.json'), 'utf8'));
    candidates.push(pathToFileURL(path.join(p, pkg.main || 'index.js')).href);
  }
  candidates.push('playwright', 'playwright-core');
  for (const c of candidates) {
    try {
      const mod = await import(c);
      return mod.chromium ? mod : mod.default;
    } catch {
      /* try next */
    }
  }
  console.error(
    'Playwright not found. Install it without saving it to package.json:\n' +
      '  npm i --no-save playwright && npx playwright install chromium\n' +
      'or set PLAYWRIGHT_MODULE=/path/to/node_modules/playwright',
  );
  process.exit(1);
}

function startServer(projectDir, home) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [bundle, 'start', projectDir, '--port', String(port), '--host', '127.0.0.1'],
      {
        env: { ...process.env, HOME: home, USERPROFILE: home, AGENTNEURON_DEBUG: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`server not ready after 30s:\n${out}`));
    }, 30000);
    const onData = (d) => {
      out += d;
      const m = out.match(/open\s*:\s*(http\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ child, url: m[1].replace(/\/$/, '') });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited with code ${code}:\n${out}`));
    });
  });
}

async function main() {
  if (!fs.existsSync(bundle)) {
    console.error('dist/agentneuron.mjs is missing; run `npm run build` first.');
    process.exit(1);
  }
  if (!fs.existsSync(exampleDir)) {
    console.error(`examples/${example} does not exist.`);
    process.exit(1);
  }
  const { chromium } = await loadPlaywright();

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-shots-'));
  const projectDir = path.join(tmp, example);
  const home = path.join(tmp, 'home');
  fs.cpSync(exampleDir, projectDir, { recursive: true });
  fs.mkdirSync(home);
  fs.mkdirSync(outDir, { recursive: true });
  // Give the copy a one-commit git history so the git widgets are populated.
  // Optional: skipped silently when git is not installed.
  try {
    const { execFileSync } = await import('node:child_process');
    const git = (...a) => execFileSync('git', a, { cwd: projectDir, stdio: 'ignore', env: { ...process.env, HOME: home } });
    git('init', '-q');
    git('add', '-A');
    git('-c', 'user.name=Example', '-c', 'user.email=example@example.com', 'commit', '-q', '-m', 'Example project');
  } catch {
    /* git not available: the Git widgets show "git unavailable" */
  }

  let server;
  let browser;
  const stop = () => {
    try {
      server?.child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  };
  process.on('SIGINT', () => {
    stop();
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(130);
  });

  try {
    server = await startServer(projectDir, home);
    server.child.removeAllListeners('exit');
    console.log(`server ready at ${server.url} (project copy: ${projectDir})`);
    browser = await chromium.launch();
    for (const shot of SHOTS) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        colorScheme: shot.theme,
        reducedMotion: shot.motion ? 'no-preference' : 'reduce',
      });
      await context.addInitScript((t) => {
        try {
          localStorage.setItem('agentneuron.theme', t);
        } catch {
          /* ignore */
        }
      }, shot.theme);
      const page = await context.newPage();
      // The UI keeps a Server-Sent Events stream open, so never wait for "networkidle".
      await page.goto(`${server.url}/${shot.query || ''}${shot.hash}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('main, #app > *', { timeout: 15000 });
      if (shot.wait) await page.waitForSelector(shot.wait, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(shot.settle);
      if (shot.click) {
        await page.click(shot.click, { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1000);
      }
      const file = path.join(outDir, `${shot.name}.png`);
      await page.screenshot({ path: file });
      console.log(`saved ${path.relative(repo, file)}`);
      await context.close();
    }
  } finally {
    await browser?.close().catch(() => {});
    stop();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
