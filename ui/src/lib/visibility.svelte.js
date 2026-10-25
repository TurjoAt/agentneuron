// Reactive page visibility shared by animated widgets (radar, neuron brain):
// `page.visible` is false while the tab is hidden so animations can pause.

class PageVisibility {
  visible = $state(typeof document === 'undefined' ? true : !document.hidden);
}

export const page = new PageVisibility();

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => (page.visible = !document.hidden));
}
