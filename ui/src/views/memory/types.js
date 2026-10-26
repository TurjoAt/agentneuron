// Memory type metadata shared by the Memory tab components.
export const TYPES = {
  user: { label: 'User', tone: 'info', icon: 'user', hint: 'Who you are and how you like to work' },
  feedback: { label: 'Feedback', tone: 'warn', icon: 'message', hint: 'Corrections the agent should remember' },
  project: { label: 'Project', tone: 'accent', icon: 'layers', hint: 'Facts about this codebase' },
  reference: { label: 'Reference', tone: 'ok', icon: 'link', hint: 'Where to find things' },
};
export const typeOf = (t) => TYPES[t] || { label: t || 'Other', tone: '', icon: 'file', hint: '' };
/** Stable DOM id for a memory card. */
export const memId = (name) => `mem-${String(name || '').replace(/[^\w-]/g, '_')}`;
