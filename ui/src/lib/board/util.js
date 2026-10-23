// Shared helpers for the task board views.
export const PRIORITIES = ['none', 'low', 'med', 'high', 'urgent'];
export const PRIO = {
  none: { label: 'None', color: 'var(--text-3)', rank: 0 },
  low: { label: 'Low', color: 'var(--info)', rank: 1 },
  med: { label: 'Medium', color: 'var(--warn)', rank: 2 },
  high: { label: 'High', color: 'var(--accent-2)', rank: 3 },
  urgent: { label: 'Urgent', color: 'var(--err)', rank: 4 },
};
export const STATUS_COLOR = {
  backlog: 'var(--text-3)',
  todo: 'var(--info)',
  doing: 'var(--accent)',
  review: 'var(--warn)',
  done: 'var(--ok)',
};
export const statusColor = (id) => STATUS_COLOR[id] || 'var(--text-2)';

const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayKey = () => dayKey(new Date());
export function parseDay(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export function fmtDue(s) {
  const d = parseDay(s);
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
}
export const isOverdue = (t) => !!t.due && t.status !== 'done' && t.due < todayKey();
export function dueThisWeek(t) {
  if (!t.due) return false;
  const k = todayKey();
  return t.due >= k && t.due <= dayKey(addDays(new Date(), 7));
}

export function checkProgress(t) {
  const c = t.checklist || [];
  return { done: c.filter((x) => x.done).length, total: c.length };
}

export const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt || 0) - (b.createdAt || 0);

/** Order value for inserting between neighbours (prev/next orders may be undefined). */
export function orderBetween(prev, next) {
  if (prev != null && next != null) return prev === next ? prev + 0.001 : (prev + next) / 2;
  if (prev != null) return prev + 1000;
  if (next != null) return next - 1000;
  return 1000;
}

export function applyFilters(tasks, f) {
  const q = (f.q || '').trim().toLowerCase();
  return tasks.filter((t) => {
    if (q && !`${t.title} ${t.description || ''} ${(t.labels || []).join(' ')} ${t.assignee || ''} ${t.path || ''}`.toLowerCase().includes(q)) return false;
    if (f.label && !(t.labels || []).includes(f.label)) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.assignee === '__none') {
      if (t.assignee) return false;
    } else if (f.assignee && t.assignee !== f.assignee) return false;
    if (f.source && t.source !== f.source) return false;
    if (f.due === 'overdue' && !isOverdue(t)) return false;
    if (f.due === 'week' && !dueThisWeek(t)) return false;
    return true;
  });
}

export function laneOf(t, mode) {
  if (mode === 'label') return (t.labels && t.labels[0]) || 'No label';
  if (mode === 'priority') return t.priority || 'none';
  if (mode === 'assignee') return t.assignee || 'Unassigned';
  if (mode === 'file') return t.path || 'Native';
  return '';
}
