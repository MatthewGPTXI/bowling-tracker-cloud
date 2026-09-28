const views = new Set(['home', 'sessions', 'stats', 'friends', 'profile']);
export function createNavigation({document, window, storage, pathname, pagePosition = () => null}) {
  const key = 'bowling-page:' + pathname;
  let saved;
  try { saved = JSON.parse(storage?.getItem(key)); } catch (_) {}
  let current = views.has(saved?.view) ? saved.view : 'home';
  let initialScroll = Math.max(0, Number(saved?.y) || 0);
  function rememberPage() {
    try { storage?.setItem(key, JSON.stringify({view: current, y: pagePosition()?.y ?? window.scrollY})); } catch (_) {}
  }
  function navigate(view, focus = true) {
    if (!views.has(view) || !document.getElementById('view-' + view)) return;
    current = view;
    document.querySelectorAll('.app-view').forEach(panel => { panel.hidden = panel.id !== 'view-' + view; });
    document.querySelectorAll('[data-go-view]').forEach(button => {
      if (button.dataset.goView === view) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    const menu = document.getElementById('profileMenu');
    if (menu) menu.open = false;
    if (focus) {
      initialScroll = null;
      document.getElementById('mainContent')?.focus({preventScroll: true});
      window.scrollTo({top: 0, behavior: 'smooth'});
    }
    rememberPage();
  }
  function initialize() { navigate(current, false); }
  function restoreScroll() {
    if (initialScroll === null) return;
    window.scrollTo({top: initialScroll, behavior: 'instant'});
    initialScroll = null;
    rememberPage();
  }
  window.addEventListener('pagehide', rememberPage);
  return {navigate, initialize, restoreScroll, rememberPage, current: () => current};
}
let controller;
export function configureNavigation(options) { controller = createNavigation(options); return controller; }
export const rememberPage = () => controller?.rememberPage();
export const navigate = (view, focus) => controller?.navigate(view, focus);
export const initialize = () => controller?.initialize();
export const restoreScroll = () => controller?.restoreScroll();
