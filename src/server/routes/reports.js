import { HttpError } from '../router.js';
import { parseRange, summary, series, top, heatmap, exportReport, EXPORT_FORMATS } from '../../reports/index.js';

export default async function register(router, ctx) {
  router.get('/api/reports/summary', ({ q }) => summary(ctx, parseRange(q)));
  router.get('/api/reports/series', ({ q }) => series(ctx, parseRange(q), {
    bucket: q.get('bucket') || 'day', metric: q.get('metric') || 'changes', split: q.get('split') || 'none',
  }));
  router.get('/api/reports/top', async ({ q }) => {
    const rows = await top(ctx, parseRange(q), q.get('by') || 'churn');
    if (!rows) throw new HttpError(400, 'bad "by"');
    return rows;
  });
  router.get('/api/reports/heatmap', ({ q }) => heatmap(ctx, Number(q.get('days')) || 365));
  router.get('/api/reports/export', async ({ q, res }) => {
    const f = String(q.get('format') || 'csv').toLowerCase();
    if (!EXPORT_FORMATS.includes(f)) throw new HttpError(400, `format must be ${EXPORT_FORMATS.join('|')}`);
    const includeContent = String(q.get('include') || '').split(',').includes('content');
    const out = await exportReport(ctx, parseRange(q), f, { includeContent });
    res.writeHead(200, {
      'content-type': out.type, 'cache-control': 'no-store',
      'content-disposition': `attachment; filename="${out.filename}"`,
      'x-agentneuron-tokens': String(out.tokens || 0),
    });
    res.end(out.body);
  });
}
