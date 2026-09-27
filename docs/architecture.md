# Reliability refactor (v39 candidate)

This is an incremental extraction of v38. The app remains vanilla JavaScript with no bundler or runtime dependency added. Firebase continues to load from the existing official SDK URL. Development dependencies run tests only and are excluded from the deployment artifact.

## Ownership and boundaries

| Concern | Owner |
| --- | --- |
| Startup and dependency wiring | `main.js` |
| Account scope, loaded games, form workflow, mutations | `app.js` |
| Game normalization, validation, data and backup versions | `modules/games.js` |
| UUID/legacy IDs and ordering | `modules/ids.js` |
| Grouping and stable session identity | `modules/sessions.js` |
| Statistics, series, trends | `modules/statistics.js` |
| IndexedDB transactions and one-time migration | `modules/storage.js` |
| Account-scoped recovery draft persistence | `modules/drafts.js` |
| Backup reconciliation and CSV escaping | `modules/backup.js` |
| Inventory merge, storage and edit lifecycle | `modules/inventory.js` |
| Shared Profile inventory editor | `modules/inventory-editor.js` |
| History templates and keyed DOM updates | `modules/history-renderer.js` |
| Active route and reload scroll state | `modules/navigation.js` |
| Modal page lock and open/close operations | `ui.js` |
| Pure conflict/reconciliation plan | `modules/reconciliation.js` |
| Bounded cloud reads and cursor protocol | `modules/cloud-reader.js` |
| Ownership transfer/leave transaction | `modules/groups.js` |
| Firebase execution, outbox, account revisions | `cloud.js` |

The import graph is acyclic and checked in CI. Browser diagnostics retain read-only `window.Bowling*` handles for the preserved browser suites; runtime modules never read them. App/cloud status and update coordination is injected once at bootstrap.

IndexedDB is the durable source of truth for saved games and settings. `app.js` owns the current account's in-memory snapshot; successful transactions replace it. Forms remain transient edit buffers with an explicit baseline, stable session ID and recovered draft. Database scope transitions are serialized so an earlier slow account load cannot replace a later requested account. They do not overwrite saved records until validation and an atomic commit succeed. Session storage owns route/scroll only. Account-scoped localStorage owns recovery drafts and the existing durable sync outbox. Tombstones remain in IndexedDB. Switching accounts clears transient UI state; late operations are guarded by the captured database, UID and revision.

## Data compatibility

New games use `crypto.randomUUID()`. Existing numeric IDs are never regenerated. Numeric/UUID records work through edits, deletion/Undo, backups, import review, IndexedDB and cloud reconciliation. Record schema 6 and backup schema 9 are separate from the public release version. A one-time, atomic IndexedDB migration normalizes old fields without changing IDs, explicit timestamps or tombstones. Unknown legacy fields survive the migration. Score-only, no-tap, multi-ball/frame allocations, alleys, session types and old drafts remain supported.

Stable session IDs preserve the old date/name grouping when first migrating. Subsequent session metadata edits retain that ID. Changing two sessions to the same date does not silently merge them. Schema-5 cloud `sessionId` values were aliases of the session name and are normalized through the legacy grouping rule.

Devices running older releases do not understand UUID records. Update all devices to v39 before editing newly created games on another device. No forced destructive migration or database replacement is used.

## Sync safeguards and rollout

`planSync` accepts local records, tombstones, remote records, pending changes and optional reviewed choices. It returns local upserts/deletes, cloud writes and unresolved issues without performing I/O. Explicit conflict review, earliest outbox base/latest edit, 100-write transaction chunks, version checks, account isolation and stale-response guards remain.

Cloud reads use pages of 250 documents. Incremental reads are intentionally gated on `users/{uid}.syncProtocolVersion == 1`, which only a trusted admin can set under the supplied rules. Without that marker, each sync uses paginated full reconciliation. All new game/tombstone writes include a server timestamp.

To activate incremental mode safely:

1. Publish the new app and verify every active device has updated.
2. Deploy the emulator-tested `firestore.rules` with Firebase administration access. A GitHub Pages deployment does not deploy Firebase rules.
3. After checking compatibility, set `syncProtocolVersion: 1` on selected user profiles through trusted administration. Clients cannot set, remove or change this field under the new rules.
4. The first successful sync records a full baseline and server cutoff in that account's IndexedDB. Later syncs fetch timestamp changes, including the cutoff boundary, with document-ID tie breaking and pagination. The cursor advances only after reconciliation succeeds. A missing baseline starts with a full read. Failed reads/account changes never advance it. Invalid or unsupported remote records pause sync visibly instead of being silently skipped.

Do not enable the marker against the old ownership-only rules: older clients could write without a timestamp and make cursor reads miss changes. Full fallback remains deliberately available during rollout. Remote physical document deletion is not the application deletion protocol; game deletion uses tombstones. Account deletion retains its existing cleanup path.

Group owners transfer ownership atomically to another current member when leaving or deleting their account. A sole-owner group is dissolved. No empty owner UID is written. A disappearing successor or changed account aborts the operation. The new rules validate the successor's membership. An owner can inspect membership even if interrupted group creation omitted their member row. Ownership changing during a leave operation requires a fresh attempt. Legacy ownerless groups are not silently claimed.

Leaderboards remain casual, self-reported social summaries. Field validation limits malformed values but does not make scores authoritative. Competitive rankings would require trusted server aggregation.

## Tests and deployment

- `npm ci`, `npx playwright install --with-deps chromium`, then `npm test` runs legacy/direct-import suites, browser suites and Firestore emulator rules tests. Java 17 is required by the pinned emulator tooling.
- `npm run test:unit`, `npm run test:browser`, and `npm run test:rules` run each category separately. Existing VM suites remain with a test-only ESM adapter while new modules are tested through direct imports.
- `npm run test:performance` measures grouping, stats, trends, filtering, reconciliation and history templates at 1,000 and 5,000 games. `tests/scale-browser.mjs` measures real IndexedDB, reload/startup and rendering at both sizes.
- CI runs the same tests on PRs and main. The Pages job depends on the required `Tests` job and publishes only application assets.
- Apply `node scripts/configure-repository.mjs` using an authenticated GitHub CLI with administration rights to require PRs/passing `Tests` (including administrators), prohibit force pushes/deletion, and switch Pages from branch publishing to GitHub Actions. These settings are external to Git and are not enabled merely by committing the workflow.

All module dependencies are pre-cached atomically by the service worker; an offline test reloads the ES module app and generates a score card. Native iOS/PWA lifecycle and authenticated production two-device sync still require device verification; the automated browser tests emulate mobile geometry and touch input, and Firebase tests use synthetic/emulated data.

## Measured performance and CSS scope

On the development container (Node 24, Chromium mobile viewport), the 5,000-game fixture has 1,667 sessions, 12 balls and 8 alleys. Median pure stats calculation: approximately 3.2 ms; grouping: 0.5 ms; reconciliation: 0.5 ms. Browser full render: approximately 190 ms; reload/startup: 446 ms; filter interaction: 55 ms; initial IndexedDB write plus rendering: 937 ms. These are environment measurements, not phone guarantees. Replacing locale-based ID comparison removed a measured sorting cost. No broad derived-data cache was introduced without a measured need.

CSS cleanup removes 22 superseded rules, introduces reusable spacing/tap-target tokens, and preserves the existing responsive cascade. A computed-style comparison of all five pages at ten widths from 320 to 1280px found no differences. A broader breakpoint reorder changed geometry, so it was not retained. Deeper consolidation is intentionally deferred until those responsive relationships can be changed and reviewed separately.

The v39 pre-release findings and regression evidence are recorded in `BUG-TEST-REPORT.md`.
