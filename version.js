// Shared by the page and service worker so release labels cannot drift.
self.BOWLING_VERSION = '33';
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const label = document.getElementById('appVersion');
    if (label) label.textContent = `Bowling Tracker · v${self.BOWLING_VERSION}`;
  });
}
