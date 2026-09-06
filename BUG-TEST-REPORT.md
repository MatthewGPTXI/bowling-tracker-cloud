# Bowling Tracker v13 validation

All three Node regression suites pass. Tests execute application functions with simulated DOM, IndexedDB and Firestore responses.

Covered: existing navigation/entry/series/session/undo/import guards; legacy grouping preserved and missing types treated as League; game type editing; unique new session identities; same-date latest-session ordering; persisted game and series recovery; inclusive date comparisons; type filters; atomic game reordering; import additions/duplicates/conflicts, no-write preview and stale preview rejection; CSV escaping; cloud stale-edit and deletion protection, atomic conflicting batches, account guards, and stale leaderboard responses.

Firebase config and security rules are unchanged. No production user records were changed during tests.

Limitations: physical iPhone/Android, browser rendering, actual reload recovery, real IndexedDB and live two-device Firebase transactions were not exercised in this environment. Photos are not persisted as drafts. Large cloud batches are processed in guarded chunks of 100; interrupted operations remain locally available for another sync.

## v14 ball tracking

All four regression suites pass. Added coverage for reusable ball names, independent game tags and clearing, series defaults/overrides, draft recovery, combined ball/date comparisons, consecutive-series correctness, old game defaults, validation, account-scoped suggestions and ball-only cloud conflict detection. Browser/physical-device/live Firebase limitations above still apply.

## v15 sync recovery

Reproduced sync-flow gaps: unresolved conflicts halted unrelated transfers; offline changes lost their originating versions; sign-in could overwrite sync results with misleading success text. Fixed with durable account-specific retry records and reconciliation that skips only unresolved records.

The cloud regression now executes the complete reconciliation flow with simulated Firestore/IndexedDB interfaces: new uploads, offline/reload retry, network-failure recovery, consecutive queued edits, conflict preservation, unrelated uploads while review is pending, explicit resolution, and account scoping. All four regression suites pass. Live production Firebase access is unavailable, so this does not establish the exact cause of the user's device-specific report.

## v16 confirmed startup regression

The screenshot's storage failure was reproduced by executing the real init/openInitialDatabase/openDatabase path. openDatabase referenced an undefined `tx` variable introduced in v13's storage-handler edit; it threw ReferenceError before the IndexedDB open succeeded. v12 correctly used the open request's onsuccess handler. Restored that handler while retaining transaction-completion handling for actual data transactions. This error was independent of League defaults and ball fields.

New tests/startup.cjs fails on the previous code and passes after the fix. It exercises full startup with existing legacy-shaped games, simulated cloud downloads, account switching, database-open failure, and cloud readiness success/failure. All five regression suites pass. The storage/event interfaces are simulated; live Firebase and physical iPhone testing remain unperformed. Startup errors now surface their cause and stop cloud initialization rather than hanging. Footer now identifies v16.

## v17 Discord preparation

Discord client tests pass for disabled/unconfigured behavior with no requests, Firebase-token authentication, allowed authorization URLs, connection/disconnection states and stale-account responses. Existing startup and sync tests pass. Live OAuth cannot be tested until the backend and Discord application are configured.
