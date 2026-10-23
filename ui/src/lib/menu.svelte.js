// Global context menu state. openMenu(event, items) from anywhere.
// item: { label, icon?, run?, kbd?, danger?, disabled?, reason?, sep?: true, header?: string, level? }

class MenuState {
  open = $state(false);
  x = $state(0);
  y = $state(0);
  items = $state.raw([]);
  title = $state('');
}
export const menu = new MenuState();

/**
 * @param {MouseEvent|{clientX:number, clientY:number}|HTMLElement} e
 * @param {Array<any>} items
 * @param {string} [title]
 */
export function openMenu(e, items, title = '') {
  if (e?.preventDefault) e.preventDefault();
  if (e?.stopPropagation) e.stopPropagation();
  let x = 0;
  let y = 0;
  if (e instanceof HTMLElement) {
    const r = e.getBoundingClientRect();
    x = r.left;
    y = r.bottom + 4;
  } else if (e?.currentTarget instanceof HTMLElement && (e.clientX === 0 && e.clientY === 0)) {
    // keyboard-triggered contextmenu
    const r = e.currentTarget.getBoundingClientRect();
    x = r.left + 12;
    y = r.bottom;
  } else {
    x = e?.clientX ?? 0;
    y = e?.clientY ?? 0;
  }
  menu.items = items.filter(Boolean);
  menu.title = title;
  menu.x = x;
  menu.y = y;
  menu.open = true;
}

export function closeMenu() {
  menu.open = false;
}
