# UI v12 verification — September 6, 2026

Passed application-logic checks for four-page navigation, active-page accessibility labels, draft retention across pages, session pagination, collapsed-session markup, inclusive name/date filtering, no-results and clear-filter flows, discard cancellation, session entry shortcuts, series total preview and saving, transaction rollback, session-wide editing, undo/account isolation, chronological averages, and invalid-import validation.

Fixed an additional false unsaved-draft warning after a session edit updates the entry form's date/name.

Structural checks passed for balanced HTML, unique element IDs, expected content on each page, JavaScript syntax, and DOM references. Firebase configuration, rules, and cloud-sync code were byte-compared against the preceding bug-fixed package and preserved. The scoped offline cache has a new version for the updated interface.

The executable regression test is included in tests/ui-regression.cjs. It uses simulated interfaces; it does not replace visual Safari/Chrome testing or a real Firebase integration check. No live games, accounts, or deployments were changed.

---

## Previous bug-fix verification (historical)

# Bowling Tracker bug test — September 5, 2026

Tested the session-tools package based on the pre-journal stable version. UX proposals were reviewed but not implemented in this bug-fix pass.

## Reproduced and fixed

| Issue | Reproduction | Correction |
| --- | --- | --- |
| Backdated entries distort the last-5 average | Six September games scored 150, followed by entering an August game scored 50, produced 130 instead of 150. | Recent stats now sort by bowling date, then entry order, consistently with the last-10/30 windows. |
| Impossible dates accepted from backups | 2026-02-31 passed import validation. | Validate real calendar dates, including leap years, in imports and entry/edit flows. |
| Malformed numeric backup fields break statistics | A strike-opportunities value of "oops" was accepted and became NaN. | Reject malformed values before writing; explain which backup rows need correction. Valid older backups without strike opportunities still default appropriately. |
| Offline updates delete unrelated caches | Worker activation deleted another app's cache on the same origin. | Version and clean caches within this application's URL scope; read assets only from the current version cache. Older unscoped caches are left alone. |
| Stale account details in sync review | Account A's delayed cloud response produced a review containing A's notes after switching to B. | Discard stale responses, clear review on authentication changes, and keep remote local-write batches bound to their originating database. |

## Passed automated checks

- Single-game and full-series saving, selected-session retention, and unique IDs within a series.
- Whole-series rejection on invalid input and no partial writes on a simulated transaction failure.
- Session date/name edits preserve IDs, scores, and notes; existing-session merges require confirmation.
- Deletion and undo restore the same ID with a newer modification timestamp and remove the tombstone.
- Undo and remote batches cannot write to a different active account's database.
- Last-5/10/30 chronology; cumulative averages weighted by games; empty history and leap-day handling.
- Invalid backup rejection before any rows are written; legacy strike-opportunity defaults.
- Ordered cloud delete/undo and batch writes; offline pending feedback; originating-account checks.
- Delayed old-account sync review is discarded.
- Scoped worker cleanup, current-version cache selection, offline navigation/config fallback, and cross-origin pass-through.
- JavaScript syntax, unique HTML IDs, DOM references, linked assets, and manifest icons.

## Firebase and deployment compatibility

Byte comparisons confirmed firebase-config.js, firestore.rules, and manifest.webmanifest are unchanged from stable v1. The project is bowling-tracker-aad74. Local database names, version, game stores, and tombstone stores also match. New features continue using the existing account and game document layout.

Upload the extracted contents of bowling-tracker-cloud into the existing GitHub Pages publishing folder, with index.html at its root. Keep the same Firebase configuration, repository URL, and existing Firebase setup. No new project, account recreation, or data migration is required by these changes. No Firebase rules update is needed for this release.

## Limits

Tests executed actual application logic against simulated DOM, database, cache, and Firebase interfaces. This was not a Safari/Chrome device test, live Firebase test, or formal security audit. Private cloud data, live settings/rules, and the currently deployed configuration were not inspected. No live accounts or games were changed and no GitHub deployment was made.

After publishing, reopen the installed app while online, confirm the expected games are present, and verify one new game appears on a second signed-in device. Export a backup before updating.
