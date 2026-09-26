(() => {
  'use strict';

  const root = document.documentElement;
  const dialogs = new Set();
  const pageKey = 'bowling-page:' + location.pathname;
  let pagePosition = null;
  let navigated = false;
  let savedPage;
  try { savedPage = JSON.parse(sessionStorage.getItem(pageKey)); } catch (_) {}

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

  function rememberPage() {
    const view = document.querySelector('.app-view:not([hidden])')?.id.replace('view-', '');
    if (!view) return;
    try { sessionStorage.setItem(pageKey, JSON.stringify({view, y: pagePosition?.y ?? window.scrollY})); } catch (_) {}
  }

  window.addEventListener('pagehide', rememberPage);
  document.addEventListener('click', event => {
    if (event.target.closest('[data-go-view]')) navigated = true;
  });
  window.addEventListener('bowling:ready', event => {
    if (!event.detail?.ok || !savedPage) return;
    // Profile is created by a separate script; wait until its ready handlers finish.
    requestAnimationFrame(() => {
      if (!navigated && ['home', 'sessions', 'stats', 'friends', 'profile'].includes(savedPage.view)) {
        window.BowlingApp.showView(savedPage.view, false);
        window.scrollTo({top: Math.max(0, Number(savedPage.y) || 0), behavior: 'instant'});
      }
      savedPage = null;
    });
  });
  window.BowlingUI = {openDialog, rememberPage};
})();
