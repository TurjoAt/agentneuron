import { HttpError } from '../router.js';
import { parseRange, summary, series, top, heatmap, exportReport } from '../../reports/index.js';

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
    const f = q.get('format') || 'csv';
    if (!['csv', 'md', 'html'].includes(f)) throw new HttpError(400, 'format must be csv|md|html');
    const out = await exportReport(ctx, parseRange(q), f);
    res.writeHead(200, {
      'content-type': out.type, 'cache-control': 'no-store',
      'content-disposition': `attachment; filename="${out.filename}"`,
    });
    res.end(out.body);
  });
}
