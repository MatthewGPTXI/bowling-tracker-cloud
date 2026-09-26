# Bowling Tracker

## Latest release: v36 — September 26, 2026

Implements the approved September 26 proposal and five mockups. The default screens prioritize logging and recent scores, with less-frequent controls behind labeled disclosures.

- **Navigation:** four fixed bottom tabs on phones; top navigation on desktop. The name in the header opens Profile.
- **Home:** greeting, Average / Last 10 / Last game, Single game / Series, and Full stats / Score only. Strike opportunities remains in detailed entry. Add scoreboard photo is a secondary action; photos remain references for manual entry.
- **Entry:** Save stays above Advanced. Session type, alley, ball, no-tap, notes and date remain available there. The session summary shows its date, game count and results; Change reveals new/existing session selection and the latest-session shortcut. Saves continue the same session, date, type and alley. Selected ball names also carry forward; per-ball frame counts and notes reset for the next game.
- **Series:** shared date/type behind Change details, shared equipment/scoring behind Advanced, three numeric columns per game, per-game score-only and strike opportunities retained, running total/average before Save. Existing validation and recoverable drafts remain.
- **Sessions:** search stays visible; sort/scoring/dates move under Filters with an active-filter count. Summary cards show scores, total, average and alley. They start collapsed, remember expansion while browsing, and offer sharing without expansion. Game edit/order/delete/Undo and session edits remain available.
- **Stats:** five primary metrics with a larger Average. Date presets stay visible; the other filters collapse with a count and readable active selections. Average series moves to More bowling stats. Recent form, chart modes, period comparisons, records and all-time share cards retain their calculations.
- **Friends:** clearer rows and the five core comparison metrics first. Additional stats and explanations remain expandable. Comparison sharing still uses the existing PNG/clipboard/device-share flow.
- **Profile:** Bowling setup, Account, Data and App groups. Inventory, alleys, profile editing, account/sync, groups, backups/import/export, goal settings, version and installation controls remain available. Destructive actions stay inside existing dialogs.
- **Feedback:** concise save/sync labels, visible sync failures, and minimum 44px action targets. Existing conflict review, duplicate/contradictory-entry checks, confirmation safeguards and Undo are retained.

No database migration, Firebase configuration/rule change, runtime dependency, tracking, or engagement feature was added.

Validation: all 18 Node regression suites pass. `tests/ux-browser.mjs` exercises actual local saves, full/score-only/no-tap handling, continuation/new sessions, metadata, validation, draft reload/recovery, photos, series, filters, edits/delete/Undo, sharing, Profile/inventory/goals/backups, sync labels, account isolation, and layouts at 320, 390, 768 and 1280px. `tests/score-cards-browser.mjs` passes real PNG download/clipboard, comparison, modal-focus and cached-offline checks. These browser tests use synthetic local data; authenticated production Firebase and physical iOS/Android were not exercised.

Browser tooling is external to the app. Run either browser test with `PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE` when needed; `UX_TEST_OUTPUT` optionally saves UX screenshots.

## v35 — September 25, 2026

- **Friend comparison cards:** Friends → select a bowler → Compare with me → Share comparison creates a two-column PNG with both names, averages, game counts, high games, high consecutive 3-game series, strike %, closed frame %, clean games, and total strikes.
- Reuses the existing score-card preview, Save image, Copy image, device Share, and local QR code. Closing the card returns to the comparison. No new page, tracking, network requests, database fields, or runtime dependencies.
- Both columns use all-time standard games. Your column uses current saved stats; the friend's column uses their last shared summary and shows its date. Frame-detail counts show score-only coverage, low-game averages remain marked provisional, and unavailable values stay as —. Closed frame % is derived from the existing current open-frame average and also appears in the comparison table.
- Sharing is available when both bowlers have standard games. Legacy summaries that still mix no-tap games or score-only frame stats must refresh first. Closing the friend view, changing groups, losing membership, or switching accounts clears the comparison preview and its image URL.

Validation: all 17 Node regression suites pass, with added coverage for comparison snapshots, existing summary compatibility, missing/stale details, score-only denominators, true zeroes, and excluded data. Chromium checks cover comparison PNG download, actual clipboard images, native-share payload/user activation, mobile layout, long names, return focus, group/account changes, existing score cards, and offline cache reload. Native sharing uses a platform stub; physical iOS/Android share sheets were not exercised. Browser tooling is installed separately from this dependency-free app.

## Previous release: v34 — September 24, 2026

- **Session score cards:** Sessions → Share card creates a PNG with your name, date, game scores in their saved order, series total, average, strike %, and closed frame %. It includes the full session regardless of history filters.
- **Overall stats cards:** Stats → Share overall stats creates an all-time card with the date range, average, game/session counts, high game, best consecutive 3-game series, total pins, strike %, and closed frame %. Screen filters do not change this card.
- **Save, copy, or share:** Preview the card, then use Save image, Copy image, or the device's Share menu when available. Clipboard failures leave save/share available. On devices that open the PNG instead of downloading it, touch and hold the image to save it.
- Every card includes a small Bowling Tracker credit and a QR code linking to the app. The QR matrix is bundled and drawn locally; cards work offline without external image, QR, or font services.
- Score-only games count toward scores and averages; missing frame details never become zeroes. Overall stats exclude no-tap. Session cards label no-tap scores and use standard-game totals/rates in mixed sessions; entirely no-tap sessions are clearly labeled.
- Long sessions split into cards of up to 24 game scores with full-session totals repeated and page-specific filenames. No scores are silently omitted. Open cards block automatic app refresh and clear on profile changes; image URLs are released when the card closes.

Validation: all 17 Node regression suites pass. Chromium checks exercise actual PNG downloads and image clipboard writes, blocked-copy fallback, mobile layout, account switching, pagination, late PNG encoding, update guards, and offline service-worker reload/card generation. Native-share capability/payload/cancellation is tested with a browser stub; physical iOS/Android share sheets have not been exercised. Exported QR codes were decoded independently at full and half size. No database migration, Firebase changes, or runtime dependencies were added.

Optional browser check (requires Playwright and Chromium): `node tests/score-cards-browser.mjs`. Use `PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE` to supply tools installed outside the app, and `CARD_TEST_OUTPUT` to save test PNGs/screenshots.

## Previous release: v33 — September 24, 2026

A cleanup of the verified v32 release, preserving score-only entry, automatic updates, ball/alley inventories, goal colors, friend comparisons, and the current Profile layout.

- Removed the legacy page-wide MutationObserver and overlapping UI enhancement layer. Strike opportunities and Average series are native controls/cards; Profile owns game benchmark labels and receives explicit history-render events.
- Fixed Average series to respect alley filters and original game positions. Excluded no-tap games, balls, and alleys break consecutive runs; completed series remain non-overlapping groups of three. Score-only games still count.
- Removed unused ball suggestions, obsolete duplicate-conflict branches, redundant validation warnings, unused storage helpers, and the dynamic Profile script/style loader.
- Home no longer calculates every record just to display average/game count. Unchanged inventories no longer rewrite local storage or redraw Profile. Ball and alley sync share one profile transaction, and cloud backup reads the profile once.
- Group read failures no longer remove saved memberships. Group responses and cloud backups are guarded against account changes during requests.
- Delete all history uses one atomic transaction and retains original versions for offline deletion/conflict recovery. Failure leaves history intact.
- Update checks query the service worker once with HTTP-cache bypass. Idle polling runs only while a complete installed update is waiting for a safe refresh. The same launch/resume/reconnect/five-minute checks and draft protections remain.

Runtime JavaScript is 6.7% smaller before compression; the combined HTML/CSS/JavaScript payload is 13,466 bytes smaller. No dependencies, database migrations, or Firebase rule changes were added.

Validation: all 16 Node suites pass, including `tests/cleanup-regression.cjs`, plus JavaScript syntax and static asset checks. Tests use simulated DOM, IndexedDB, and Firebase interfaces. The browser-runtime download failed, so physical iOS/Android and authenticated two-device Firebase behavior were not exercised in this release.

Run the full regression suite:

```sh
for test in tests/*.cjs; do node "$test" || exit 1; done
```

## Previous release: v32 — September 24, 2026

- **Automatic updates:** installed and browser apps check on launch, return to the foreground, reconnect, and every five minutes while visible. A network-only build probe and service-worker version handshake detect new releases. Once the complete offline cache is ready, the app refreshes silently when there is no entry/edit, open dialog, photo reference, save, sync, focused input, or pending Undo. Failed checks leave the offline app available. A reload guard prevents loops. No update prompt is added.
- **First rollout:** v31.1 and earlier do not contain the new resume listener. Open the installed app online, then fully close and reopen it if its old screen remains. Opening Safari/Chrome separately or reinstalling is unnecessary. A closed or suspended app cannot be forced to execute immediately; future checks run when the app opens or resumes.
- **Score-only entry:** choose Record → Score only in single-game entry or for any game in a series. New series rows inherit the single-game selection. The frame fields disappear and are saved as unknown, not zero. Switch back to Score + frame stats to add details later.
- Score-only standard games contribute to averages, trends, high scores, score milestones, and consecutive series. Strike %, strikes/game, open/closed-frame rates, clean-game rates and frame records use only games with recorded details, including friend comparisons and leaderboards. A history without frame details displays — for those metrics. No-tap exclusions still apply.
- The entry choice and unknown values survive drafts, edits, account-scoped storage, JSON backups/imports, CSV exports, cloud payloads, and conflict checks. No database migration, Firebase configuration, or security-rule update is required. Existing games remain unchanged.

Validation: all 15 Node suites pass, including new score-only and automatic-update regressions. These cover simulated DOM/storage/Firebase and service-worker interfaces. Real installed iOS/Android lifecycle behavior and authenticated production Firebase transactions were not exercised here; the browser-runtime download was unavailable.

Release files: keep `version.js` and `build.json` on the same version for each deployment.

## Previous release: v29 — September 15, 2026

Built directly on the verified live September 11 v28 sync-reconciliation release (`5bf1e1c`), including the earlier pre-Discord rollback. The old page labels v24/v26 were stale; `version.js` now supplies both the visible release label and offline cache version. There is no update prompt.

- Empty series forms no longer create unfinished-entry notices; empty drafts left by older releases are cleared while entered scores (including zero), notes, and ball details remain recoverable.
- Session search includes current and legacy session names, dates, notes, session types, and every recorded ball, alongside the existing date/scoring filters.
- The progress chart has a labeled adaptive score scale and a choice of running average or a rolling average of up to ten games within the selected filters.
- Closed frame percentage is visible in At a glance. Account wording uses the visible Profile → Cloud navigation and avoids backend terminology.
- Single-game and series entry reject contradictory scores, strikes, and open-frame counts while allowing legal tenth-frame fill shots. Existing saved records and imports are not rewritten.

Validation: ten Node test suites pass, covering these changes plus cloud concurrency, startup, account isolation, ball tracking, no-tap exclusions, stats, friends, and session tools. These tests simulate browser/storage/Firebase interfaces; they do not replace authenticated testing on two devices.

## Previous update: Multiple balls and frame counts (v24)

- Game entry still has one optional Ball field under Advanced. Select More balls / frames to reveal the counter, then + Add ball for another ball. Each row can be removed; no new page or mandatory entry step is added.
- Example: Venom — 4 frames, Mercy — 6 frames. Counts are optional whole numbers from 1 to 10, with at most 10 frames recorded for the game. Count each frame once; tenth-frame bonus shots are not extra frames. For overlapping strike/spare-ball use within the same frame, list both balls and leave counts blank. Partial counts are allowed without guessing the remainder.
- Sessions show a compact ball/frame breakdown. Saved ball suggestions and the Stats ball filter include every ball used in a game. A matching game is counted once, with its full score; ball-filtered statistics are not per-ball frame results. No-tap exclusions and closed-frame percentage are retained.
- In series entry, each game's Advanced section has the same editor. The starting entry's breakdown carries to Game 1; other rows use the optional shared ball without copying frame counts. Apply ball to all games asks before replacing an existing breakdown.
- Names and frame counts persist through edits, account-scoped game/series drafts, JSON backups/imports, the additional Ball Usage JSON column in CSV, cloud payloads, offline retries, and conflict review. Import and sync review show both versions' ball usage.
- Existing games remain unchanged on startup. Single-ball records are read without a migration, and the legacy Ball field remains the first ball for compatibility. Firebase setup, security rules, accounts, and database names are unchanged. Open v24 on every device before editing multi-ball games; older app versions do not understand the breakdown.

### Connection recovery in v24

Firebase startup can retry after an incomplete initialization, including when returning to the app. Cloud indicators distinguish offline and failed sync from completed sync, and offline-cache readiness waits for activation. Nine automated suites cover startup, durable sync retries, conflicts, account isolation, and the existing game/statistics flows. See BUG-TEST-REPORT.md for live verification and deployment status.

## Previous update: Closed frame percentage (v23)

- Stats → Accuracy & milestones now shows Closed frame %, with the number of closed frames out of total frames.
- Calculated as `(games × 10 − open frames) / (games × 10) × 100`, displayed to one decimal place. Tenth-frame fill shots do not add frames.
- Follows the selected date range, session type, and ball. No-tap games remain excluded. With no matching standard games, the percentage displays —.
- Uses existing saved open-frame counts; no new entry fields, database changes, or cloud changes are needed.

## Previous update: No-tap games (v22)

- In game entry, open Advanced and set Scoring to No-tap. In series entry, Advanced → Scoring for this series applies the tag to every game being entered. League / Practice / Tournament and ball tags remain independent.
- In Sessions, choose Scoring → No-tap only to find tagged games separately. Standard only and All games are also available. Typing "no tap", "no-tap", or "notap" in the session search works too, together with the session type and date filters.
- No-tap games are excluded from Home's normal average/game count, all Stats metrics and records, recent averages, charts, both comparison periods, group leaderboards, and friend comparisons. No-tap-only histories have no standard results. Three-game records never skip a no-tap game to create a consecutive standard series.
- Mixed-session headers show standard-game average and total; no-tap-only views explicitly label their separate average and total. Filtered rows keep their original game numbers and order controls.
- Existing untagged games remain standard with no bulk rewrite. To change an older game, select Actions → Edit game → Advanced → Scoring. Changing a game's scoring never changes other games' tags.
- Repeated entries into the same session keep the selected scoring mode. Continuing an existing session uses its last game's mode, shown in the entry summary. Start new session resets to Standard.
- The tag survives account-scoped drafts, local saves, JSON backups/imports, CSV exports (the new Scoring column), and cloud sync. Tag-only changes are included in duplicate and conflict detection, and import/sync review shows each version's scoring mode.
- Group summaries refresh when their bowler syncs. If a known no-tap summary is overwritten by an older app, the updated app withholds potentially mixed results until that bowler opens v22 and syncs. Open the updated app on every device before editing tagged games; older app versions do not understand the new field.
- Firebase configuration, database names, security rules, and the confirmed startup/sync repairs are unchanged. No Discord integration is included.

Validation: all seven Node suites pass, including tests/no-tap.cjs and expanded cloud retry/conflict tests. Tests simulate DOM, storage, and Firebase interfaces; browser rendering and production Firebase operation were not tested here.

## Previous update: simpler stats, history, and friend comparisons (v21)

- Stats opens with average, high game, high three-game series, and strike percentage, followed by recent form and the running-average chart. Accuracy, milestones, additional records, and previous-period comparison are expandable, with repeated statistics removed.
- All time, This month, Last 90 days, and This year shortcuts retain the selected session type and ball. Custom dates remain available; Reset filters returns to all history.
- Sessions use compact game rows with score, ball, strikes, open frames, and readable notes. Actions opens edit, Earlier/Later, and delete controls. Escape closes those controls, and successful reordering keeps keyboard focus on the moved game.
- Select a bowler's name in Friends to open their overall stats. Compare with me shows both bowlers' all-time totals and differences, independently of personal Stats filters. Selecting your own row opens your latest saved overall stats.
- Friends uses aggregate summaries shared with existing private group members. It does not read another account's private games or notes, and needs no Firebase configuration or rules update.
- Existing basic summaries work immediately. Additional stats appear after that bowler opens v21 and syncs. Missing or stale fields display — instead of zero. The view closes when its group, membership, or account changes.
- The confirmed startup and sync repairs, drafts, ball tracking, backup tools, and account isolation are retained. No Discord integration is included.

Validation at v21: six Node suites passed, including tests/stats-friends.cjs.

## What's new

- Four main pages: Home, Sessions, Stats, Friends. Navigation stays at the bottom on phones and near the top on desktop.
- Home opens directly to logging, with a compact recap and a Continue session shortcut.
- Single game, Enter a series, and Photo reference are clearly labeled entry choices.
- The entry form shows its target session and indicates unsaved changes separately from cloud sync status.
- Sessions have collapsible game lists, name and date filters, and a Show more button after 10 sessions.
- Series entry shows a running score total and average before saving.
- Drafts stay in place while switching pages and are saved locally across reloads. Discarding a changed entry or closing a changed series/session dialog requires confirmation.
- Account, sync, and settings actions are grouped under Account & settings.
- Larger touch targets, keyboard focus indicators, a skip link, active-page labels, and safe-area spacing improve accessibility.
- All prior bug fixes are retained. There is no journal feature.

## Update the existing GitHub Pages app

1. Export a backup from Settings before updating.
2. Extract this ZIP.
3. Upload the files **inside bowling-tracker-cloud** into the existing repository's publishing folder, replacing matching files. Keep index.html at the publishing folder's root; do not add an extra bowling-tracker-cloud folder above it.
4. Allow GitHub Pages to publish. Open the app online, close it, and reopen it to load the new offline version.
5. Confirm your games appear and check a saved game on a second signed-in device.

 Firebase configuration, security rules, database names, and saved-game layout are retained. Existing Firebase setup and accounts are reused; no data migration is required.

## Everyday use

- **Home:** choose Existing session or Start new session, then select the date and session type. Save one game, or open Enter a series to save multiple games together. Photo reference displays a scoreboard for manual reading.
- **Sessions:** search by session type, scoring tag, and/or date range. Expand a session to add a game or edit its date/type. Use each game's Actions button to edit, reorder, or delete it. Undo is available for 15 seconds after deleting a game.
- **Stats:** standard-game career statistics, recent averages, milestones, records, and the running-average chart. No-tap games are excluded.
- **Friends:** private group leaderboards and overall bowler stats with Compare with me. Manage groups from Account & settings → Account & sync.
- **Account & settings:** account login/sync, profile, JSON backup/import, CSV export, and existing account tools.

Strike opportunities stays visible in game entry and defaults to 10, with 11–12 available for tenth-frame fill shots.

## Validation

Run these from this folder:

```sh
node tests/startup.cjs
node tests/cloud-concurrency.cjs
node tests/ui-regression.cjs
node tests/session-tools.cjs
node tests/ball-tracking.cjs
node tests/stats-friends.cjs
node tests/no-tap.cjs
node tests/multiple-balls.cjs
```

Tests execute application logic with simulated DOM and storage interfaces. See BUG-TEST-REPORT.md for scope and limitations. Browser visual verification and live Firebase testing remain outstanding because a browser runtime is not available in this environment.


## Session tools update (v13)

- Game and series drafts are saved locally per account. Use Recover game or Recover series on Home after reopening. Photos are reference-only and are not included in drafts.
- League, Practice, and Tournament replace the free-text session name. Legacy games default to League without rewriting their grouping identifiers. Editing a session or its game type updates the session type.
- Start new session always creates a separate grouping; Existing session explicitly chooses the destination.
- Stats supports inclusive date ranges, type filters, and the immediately preceding equally long date period. Home and friend leaderboards remain all-history summaries.
- Earlier/Later controls correct game order; best consecutive three-game series respects the corrected order. CSV exports include type, session ID and game order.
- Backup import shows additions, skipped duplicates and explicit per-conflict choices. No import writes occur before confirmation.
- Cloud game writes use Firestore transactions to compare the remote version against the version being edited. Concurrent changes trigger review. Stale leaderboard requests are ignored.

Checks: `node tests/ui-regression.cjs`, `node tests/session-tools.cjs`, `node tests/cloud-concurrency.cjs`.

## Ball tracking (v14)

Advanced game entry includes an optional ball name with suggestions from the active account's saved games. Edit existing games to tag or clear their ball. Ball names are matched ignoring capitalization and repeated spaces.

Series entry offers a shared ball with Apply ball to all games, plus an Advanced ball field for each game. Stats offers All balls, No ball recorded, and saved balls; the filter combines with date and session type and applies to both comparison periods. Consecutive three-game records never skip a different-ball game to form a series.

Ball fields are included in local drafts, JSON backups, CSV exports, Firebase payloads, and conflict review. Existing games remain untagged. Strike Opportunities remains visible. Additional regression: `node tests/ball-tracking.cjs`.

## Sync recovery (v15)

Local game changes now retain an account-specific retry record containing the original cloud comparison version. Offline/reload retries use that version and preserve newer cloud edits. Unresolved conflicts no longer block unrelated uploads or downloads. Explicit review resolutions clear their retry records. Sign-in no longer overwrites a failed/review sync message with a false success message.

No Firebase configuration or security-rule changes are needed.

## Startup repair (v16)

Fixed an undefined variable in the IndexedDB open handler that prevented app startup since v13. Existing records, session types, ball tags, Firebase config and rules are preserved. Startup failure now stops sync with a clear message. Regression: `node tests/startup.cjs`. The footer identifies v16 so installed-app users can verify the updated cache is active.

### v30 — Profile ball inventory

- Profile → Ball inventory lets each bowler add, rename, and remove ball names.
- Advanced entry uses inventory dropdowns for single games, series defaults, and additional balls. Optional frame counts and per-game overrides still work.
- Existing game tags populate the inventory. Renaming/removing inventory items never rewrites historical games; editing a past game or recovering a draft retains its original selection, even if it is no longer in the inventory. Statistics continue to use recorded game names.
- Inventory is stored in the active profile's IndexedDB database, included in JSON backups/imports, and synced privately through the existing Firebase user profile. Per-name timestamps and removal markers preserve independent additions and prevent stale devices from resurrecting removed names. Same-name concurrent changes use the newest timestamp, with removal winning ties.
- The shared release/cache version is 30. No update prompt was added.

Validation: `node tests/ball-inventory.cjs` covers migration, edits, storage failures, historical records, legacy drafts, and account isolation. `node tests/cloud-concurrency.cjs` also covers inventory merging, offline retries, and removal protection. Run all regression suites with `for test in tests/*.cjs; do node "$test" || exit 1; done`.

## v31 — Saved alleys

Manage your locations in **Profile → Alleys** with Add, Rename, and Remove. Choose an optional alley under **Advanced** when entering a game or series. A series selection applies to every game in that entry; edit individual saved games to change or clear it. Continuing an existing session uses its last game's alley, while starting a new session clears the selection.

Game history shows the alley, session search includes it, and **Stats → Alley** filters averages, records, trends, and period comparisons by location. No-tap games remain excluded from standard statistics. Renaming or removing a saved alley preserves past game tags, which remain available in historical filters.

Alley lists are isolated by account and sync alongside ball inventories, with removal records preventing stale devices from restoring deleted names. JSON backups include lists and tags; CSV exports include an Alley column. Existing backups and drafts without an alley remain compatible.

Validation: run `for test in tests/*.cjs; do node "$test" || exit 1; done`. Alley coverage includes inventory lifecycle, storage failures, account isolation, draft recovery, series entry, filtering, backup/import, remote downloads, and durable offline edits.
