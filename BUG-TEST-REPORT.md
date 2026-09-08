# Bowling Tracker validation

## v22 no-tap tagging and standard-only statistics

All seven Node suites pass. The new tests/no-tap.cjs exercises tagging and untagging individual legacy games; preserving session type, ball, IDs and timestamps; repeated-entry defaults; complete-series tagging; old and new game/series draft recovery; standard-only averages, counts, records, milestones, recent form, charts, ball/type filters and both comparison periods; consecutive three-game records; separate history search and scoring/date filters; original game numbering and Earlier/Later controls in filtered results; explicitly separated mixed/no-tap session summaries; JSON/CSV roundtrips; tag-only import conflicts and their preview; remote download retention; empty standard histories; friend comparisons; and stale or unranked group summaries.

The cloud suite now checks no-tap payloads, standard-versus-no-tap duplicate detection, a tag-only offline change retried from the durable outbox, concurrent tag/remote-edit conflict review, and tagged cloud downloads. Existing startup, navigation, ordering, atomic saves, account isolation, sync, and ball suites still pass.

JavaScript syntax and static HTML/ARIA checks pass. The service-worker cache is v22-no-tap. Firebase configuration and rules are byte-for-byte unchanged. No database version bump or bulk record migration is required; missing noTap fields mean standard games. Summary freshness markers prevent known no-tap totals written by an older client from appearing as standard results in the updated app. All devices should load v22 before editing tagged games.

Validation uses simulated DOM, IndexedDB, and Firestore interfaces, not production bowling records. Physical phone/browser rendering, real browser reloads, and authenticated live Firebase transactions were not tested because a browser runtime and live-account session are unavailable here.

## v21 stats, session history, and friend comparisons

All six Node suites pass, including the new tests/stats-friends.cjs. New coverage checks inclusive date shortcuts across year boundaries and leap day; type/ball filter retention and reset; custom-date errors; action-panel expansion, Escape and keyboard focus; visible failed reorder recovery; unfiltered overall summaries; clickable friend stats and comparisons; account/group/member changes; legacy and stale extended summaries; empty histories and genuine zero scores; offline summary labeling; escaped names, notes and ball strings; and account guards while publishing summaries.

All static element references resolve, HTML IDs are unique, and the Stats overview has four primary cards. The existing startup, cloud retry/conflict, draft, ordering, import/export, navigation, and ball regression suites remain green. The service worker includes the new friend-stats.js asset with a fresh v21 cache.

Friend views read existing group-member summaries. Additional aggregate fields carry the same timestamp as the basic summary, so an older client's later merge cannot present stale extended stats as current. No private game histories, notes, ball lists, email addresses, Firebase rules, or configuration are exposed or changed by this feature.

Validation uses simulated DOM, IndexedDB, and Firestore interfaces. A Chromium runtime is unavailable here, so physical phone/browser rendering and authenticated live Firebase operation were not tested. No production bowling data was used for tests.

## Earlier validation

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
