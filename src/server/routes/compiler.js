// Rules studio: source rules, compile preview/apply, merge-back, import, generate-from-code.
import fs from 'node:fs';
import { HttpError } from '../router.js';
import { getOps } from '../../files/ops.js';
import { resolveSafe, readTextIfExists } from '../../files/paths.js';
import {
  loadRules, parseRule, planCompile, applyCompile, applyMergeBack, planImport, applyImport, generateContext, GEN_TARGETS, writeRuleFile, validSlug, summarize,
} from '../../compiler/index.js';

const fail = (e) => { throw e instanceof HttpError ? e : new HttpError(e.status || 400, e.message || String(e)); };
const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 200) : null);
const toolsOf = (v) => (typeof v === 'string' ? v : strList(v));

export default async function register(router, ctx) {
  router.get('/api/compiler/rules', async () => {
    try {
      const { dir, rules, invalid } = loadRules(ctx.root, ctx.config);
      return { dir, invalid, rules: rules.map(({ frontmatter: _f, ...r }) => r) };
    } catch (e) { return fail(e); }
  });

  router.get('/api/compiler/preview', async ({ q }) => {
    try { return summarize(planCompile(ctx, { tools: q.get('tools') || undefined }), { content: true }); } catch (e) { return fail(e); }
  });

  router.post('/api/compiler/compile', async ({ body }) => {
    try {
      const plan = planCompile(ctx, { tools: toolsOf(body.tools), force: body.force === true });
      const applied = await applyCompile(ctx, plan);
      return { ...applied, plan: summarize(plan) };
    } catch (e) { return fail(e); }
  }, { level: 'edit' });

  router.post('/api/compiler/merge-back', async ({ body }) => {
    try {
      const pick = body.pick && typeof body.pick === 'object' && !Array.isArray(body.pick) ? Object.fromEntries(Object.entries(body.pick).filter(([k, v]) => validSlug(k) && typeof v === 'string')) : {};
      const r = applyMergeBack(ctx, planCompile(ctx, { tools: toolsOf(body.tools) }), { slugs: strList(body.slugs), pick });
      // regenerate every tool's copy from the updated sources (hand-edited copies that were not merged stay untouched)
      const compiled = body.compile === false ? null : await applyCompile(ctx, planCompile(ctx, { tools: toolsOf(body.tools) }));
      return { ...r, compiled };
    } catch (e) { return fail(e); }
  }, { level: 'edit' });

  router.get('/api/compiler/import/preview', async () => {
    try { return planImport(ctx); } catch (e) { return fail(e); }
  });

  router.post('/api/compiler/import', async ({ body }) => {
    try { return applyImport(ctx, planImport(ctx), { slugs: strList(body.slugs) }); } catch (e) { return fail(e); }
  }, { level: 'edit' });

  router.post('/api/compiler/rule', async ({ body }) => {
    const { slug, content, baseHash } = body || {};
    if (!validSlug(slug)) throw new HttpError(400, 'slug must be lowercase letters, digits and dashes');
    if (typeof content !== 'string') throw new HttpError(400, 'content must be a string');
    const r = parseRule(slug, content, `${slug}.md`);
    if (r.errors.length) throw new HttpError(400, r.errors.join('; '));
    try { return { ...writeRuleFile(ctx.root, ctx.config, slug, content, { baseHash: typeof baseHash === 'string' ? baseHash : null }), warnings: r.warnings }; } catch (e) { return fail(e); }
  }, { level: 'edit' });

  const genTool = (t) => { const v = t || 'agents'; if (!Object.hasOwn(GEN_TARGETS, v)) throw new HttpError(400, `tool must be one of ${Object.keys(GEN_TARGETS).join(', ')}`); return v; };
  const current = (rel) => { const { abs } = resolveSafe(ctx.root, rel); return fs.existsSync(abs) ? readTextIfExists(abs) : null; };

  router.get('/api/compiler/generate', async ({ q }) => {
    const tool = genTool(q.get('tool'));
    try {
      const g = await generateContext(ctx.root, { tool });
      const cur = current(g.path);
      return { ...g, exists: !!cur, currentHash: cur?.hash || null };
    } catch (e) { return fail(e); }
  });

  router.post('/api/compiler/generate/write', async ({ body }) => {
    const tool = genTool(body.tool);
    try {
      const g = await generateContext(ctx.root, { tool });
      const ops = getOps(ctx);
      const cur = current(g.path);
      if (!cur) return { path: g.path, ...(await ops.create({ path: g.path, content: g.content })), created: true };
      if (body.overwrite !== true) throw new HttpError(409, `${g.path} already exists; pass overwrite: true (with baseHash) to replace it`);
      return { path: g.path, ...(await ops.save({ path: g.path, content: g.content, baseHash: body.baseHash })), created: false };
    } catch (e) { return fail(e); }
  }, { level: 'edit' });
}
