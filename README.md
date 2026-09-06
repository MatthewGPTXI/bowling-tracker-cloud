# Bowling Tracker — UI v12

Updated September 6, 2026. Built on the pre-journal version with the session tools and bug fixes.

## What's new

- Four main pages: Home, Sessions, Stats, Friends. Navigation stays at the bottom on phones and near the top on desktop.
- Home opens directly to logging, with a compact recap and a Continue session shortcut.
- Single game, Enter a series, and Photo reference are clearly labeled entry choices.
- The entry form shows its target session and indicates unsaved changes separately from cloud sync status.
- Sessions have collapsible game lists, name and date filters, and a Show more button after 10 sessions.
- Series entry shows a running score total and average before saving.
- Drafts stay in place while switching pages. Discarding a changed entry or closing a changed series/session dialog requires confirmation. Closing/reloading the browser asks about unsaved entries where the browser supports it; drafts are not stored across reloads.
- Account, sync, and settings actions are grouped under Account & settings.
- Larger touch targets, keyboard focus indicators, a skip link, active-page labels, and safe-area spacing improve accessibility.
- All prior bug fixes are retained. There is no journal feature.

## Update the existing GitHub Pages app

1. Export a backup from Settings before updating.
2. Extract this ZIP.
3. Upload the files **inside bowling-tracker-cloud** into the existing repository's publishing folder, replacing matching files. Keep index.html at the publishing folder's root; do not add an extra bowling-tracker-cloud folder above it.
4. Allow GitHub Pages to publish. Open the app online, close it, and reopen it to load the new offline version.
5. Confirm your games appear and check a saved game on a second signed-in device.

 Firebase configuration, security rules, cloud-sync code, database names, and saved-game layout match the preceding bug-fixed build. Existing Firebase setup and accounts are reused; no data migration is required.

## Everyday use

- **Home:** select an existing session or enter a date and optional name. Save one game, or open Enter a series to save multiple games together. Photo reference displays a scoreboard for manual reading.
- **Sessions:** search by session name and/or date range. Expand a session to add a game, edit its date/name, or edit/delete individual games. Undo is available for 15 seconds after deleting a game.
- **Stats:** career statistics, recent averages, milestones, records, and the running-average chart.
- **Friends:** private group leaderboards. Manage groups from Account & settings → Account & sync.
- **Account & settings:** account login/sync, profile, JSON backup/import, CSV export, and existing account tools.

Strike opportunities stays visible in game entry and defaults to 10, with 11–12 available for tenth-frame fill shots.

## Validation

Run `node tests/ui-regression.cjs` from this folder. Tests execute the application logic with simulated DOM and storage interfaces. See BUG-TEST-REPORT.md for scope and limitations. Browser visual verification and live Firebase testing remain outstanding because a browser runtime is not available in this environment.


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

## Discord linking preparation (v17)

Account settings includes Discord connection controls. They remain disabled until the linking service is deployed and configured. The app-side authorization/status/disconnect flow is ready; real OAuth linking and the bot still require backend setup. See DISCORD-INTEGRATION.md. No credentials or account mappings are stored in this build.

## Discord bot implementation (v18)

The complete Worker source and step-by-step setup guide are in [bot/README.md](bot/README.md). Commands: link, stats, session, ball, leaderboard, compare, recap, sharing, configure and disable. Weekly channel recaps are optional; milestone announcements are excluded.

Your app's linking service is still disabled until the deployed Worker origin is entered in discord-config.js. The bot cannot become live until the Cloudflare/Discord secrets, D1 binding and Firebase IAM permissions are configured.
