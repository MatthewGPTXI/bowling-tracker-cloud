import {app, configureApp} from './app.js';
import {cloud} from './cloud.js';
import {profile} from './profile.js';
import {friends} from './friend-stats.js';
import {scoreCards, setComparisonProvider} from './score-cards.js';
import {updates} from './updates.js';
import * as UI from './ui.js';
import {Balls, setInventoryProvider} from './balls.js';
import {configureNavigation} from './modules/navigation.js';

let storage;
try { storage = sessionStorage; } catch (_) {}
configureNavigation({document, window, storage, pathname: location.pathname, pagePosition: UI.getPagePosition});
setInventoryProvider(app.getBallInventory);
setComparisonProvider(friends.getComparisonCardData);
configureApp({cloud, updates});
profile.refresh();
app.init();
cloud.init();

// Read-only diagnostics retained for existing automated browser checks. Runtime
// modules use imports; no component reads these compatibility handles.
for (const [name, value] of Object.entries({BowlingApp: app, BowlingCloud: cloud, BowlingUI: UI,
  BowlingFriends: friends, BowlingScoreCards: scoreCards, BowlingUpdates: updates, BowlingBalls: Balls})) {
  Object.defineProperty(window, name, {value, writable: false, configurable: false});
}
