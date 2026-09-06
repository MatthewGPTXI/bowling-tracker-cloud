# Bowling Tracker v13 validation

All three Node regression suites pass. Tests execute application functions with simulated DOM, IndexedDB and Firestore responses.

Covered: existing navigation/entry/series/session/undo/import guards; legacy grouping preserved and missing types treated as League; game type editing; unique new session identities; same-date latest-session ordering; persisted game and series recovery; inclusive date comparisons; type filters; atomic game reordering; import additions/duplicates/conflicts, no-write preview and stale preview rejection; CSV escaping; cloud stale-edit and deletion protection, atomic conflicting batches, account guards, and stale leaderboard responses.

Firebase config and security rules are unchanged. No production user records were changed during tests.

Limitations: physical iPhone/Android, browser rendering, actual reload recovery, real IndexedDB and live two-device Firebase transactions were not exercised in this environment. Photos are not persisted as drafts. Large cloud batches are processed in guarded chunks of 100; interrupted operations remain locally available for another sync.
