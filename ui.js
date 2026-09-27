export const UI = (() => {
  'use strict';

  const root = document.documentElement;
  const dialogs = new Set();
  let pagePosition = null;

  function unlockPage() {
    if (dialogs.size || !pagePosition) return;
    const position = pagePosition;
    pagePosition = null;
    root.classList.remove('dialog-open');
    root.style.removeProperty('--dialog-page-top');
    root.style.removeProperty('--dialog-scrollbar');
    window.scrollTo({left: position.x, top: position.y, behavior: 'instant'});
  }

  function openDialog(dialog) {
    if (dialog.open) return;
    if (!pagePosition) {
      pagePosition = {x: window.scrollX, y: window.scrollY};
      // A fixed body also locks installed iOS PWAs, where overflow alone can leak scrolls.
      root.style.setProperty('--dialog-page-top', -pagePosition.y + 'px');
      root.style.setProperty('--dialog-scrollbar', (window.innerWidth - root.clientWidth) + 'px');
      root.classList.add('dialog-open');
    }
    dialogs.add(dialog);
    const closed = () => {
      // A close event may arrive after the same dialog has already reopened.
      if (dialog.open) return;
      dialog.removeEventListener('close', closed);
      dialogs.delete(dialog);
      unlockPage();
    };
    dialog.addEventListener('close', closed);
    try {
      dialog.showModal();
      dialog.scrollTop = 0;
    } catch (error) {
      dialog.removeEventListener('close', closed);
      dialogs.delete(dialog);
      unlockPage();
      throw error;
    }
  }

  function closeDialog(dialog) {
    if (dialog?.open) dialog.close();
  }

  return {openDialog, closeDialog, getPagePosition: () => pagePosition};
})();
export const {openDialog, closeDialog, getPagePosition} = UI;
export {rememberPage} from './modules/navigation.js';
