# Bowling Tracker — Cloud Sync Edition

An offline-first bowling PWA for iPhone and desktop. Games are saved locally in IndexedDB first. Optional Firebase Authentication + Cloud Firestore adds cross-device sync and private friend leaderboards.

## Features

- Career average, high game, best 3-game series, strike percentage, average open frames, clean games, total strikes, 200+/250+/300 milestones, last-5 average, best session average
- Games grouped into dated sessions
- Manual entry and scoreboard-photo reference workflow
- JSON backup/import and CSV export
- Offline PWA support
- Optional Firebase email/password account
- Cross-device cloud sync
- Conflict-safe sync using `updatedAt` timestamps and deletion tombstones
- Private bowling groups with 8-character invite codes
- Sortable leaderboards: average, high game, high series, strike %, clean games, total strikes, best session average
- Full game history remains private to its owner; group members see only leaderboard summary stats

## Files

- `index.html` — interface
- `styles.css` — styling
- `app.js` — local bowling tracker / IndexedDB
- `cloud.js` — Firebase sync, authentication, groups, leaderboard
- `firebase-config.js` — your Firebase Web App configuration
- `firestore.rules` — security rules to paste into Firebase Console
- `service-worker.js` — offline cache
- `manifest.webmanifest` — installable PWA manifest
- `icons/` — Home Screen icons

# One-time Firebase setup

## 1. Create the project

1. Go to https://console.firebase.google.com/
2. Choose **Create a project**.
3. Name it something like `bowling-tracker`.
4. Google Analytics is not required for this app; you can leave it off.
5. Stay on the no-cost **Spark** plan.

## 2. Create Cloud Firestore

1. In Firebase Console, open **Build / Firestore Database**.
2. Choose **Create database**.
3. Pick **Production mode**. The supplied rules will replace the initial locked rules.
4. Choose the database location carefully because Firebase does not let you change it later. If most users are in Southern California, `us-west2 (Los Angeles)` is a sensible regional choice; otherwise choose the closest supported region to your users.
5. Finish creating the database.

## 3. Publish the security rules

1. Open **Firestore Database / Rules**.
2. Open the local file `firestore.rules` from this package.
3. Replace everything in the Firebase Rules editor with its contents.
4. Click **Publish**.

Do not use an `allow read, write: if true` ruleset. The supplied rules keep each user's full bowling history private and restrict group leaderboard writes to that user's own row.

## 4. Enable email/password accounts

1. Open **Build / Authentication**.
2. Click **Get started** if prompted.
3. Open **Sign-in method**.
4. Enable **Email/Password**.
5. Save.

## 5. Register the web app

1. Return to **Project Overview**.
2. Click the Web icon (`</>`) to add a web app.
3. Nickname it `Bowling Tracker`.
4. You do **not** need Firebase Hosting because GitHub Pages is hosting the app.
5. Register the app.
6. Firebase will show a configuration object similar to:

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

7. Open `firebase-config.js` from this package and replace each `PASTE_...` placeholder with the matching Firebase value.

The Firebase Web App API key is designed to be present in browser code. Your data security comes from Firebase Authentication and the Firestore Security Rules, not from hiding this configuration file.

## 6. Authorize the GitHub Pages domain

Once you know your GitHub Pages hostname, for example:

`yourusername.github.io`

open **Authentication / Settings / Authorized domains**, choose **Add domain**, and add only the hostname (no `https://` and no `/bowling-tracker/` path).

## 7. Upload this edition to GitHub

Upload/replace the contents of this folder at the root of your existing `bowling-tracker` repository. In particular, the repo root should include:

```text
index.html
styles.css
app.js
cloud.js
firebase-config.js
firestore.rules
service-worker.js
manifest.webmanifest
README.md
icons/
```

GitHub Pages should continue publishing from the `main` branch and `/(root)`.

## 8. First cloud sync

1. Open the GitHub Pages site while online.
2. Open **Cloud**.
3. Create an account with your email/password and leaderboard display name.
4. The app uploads existing local games and merges any cloud history into the device.
5. Under **Leaderboard profile**, choose which local bowler name should supply your public leaderboard stats.
6. Tap **Sync now** if you want to force a reconciliation.

## 9. Create a friends leaderboard

1. Open **Cloud**.
2. Under **Private bowling groups**, enter a group name and tap **Create group**.
3. The app creates an 8-character invite code.
4. Send that code to a friend.
5. Your friend installs/opens the same PWA, creates their own Firebase account, enters the code under **Join group**, and their stats appear on the leaderboard.

The group's leaderboard stores summary statistics only. Other group members cannot read your private per-game history under `users/{uid}/games`.

# How sync works

The local IndexedDB database remains the primary offline copy:

1. A new or edited game saves to the phone immediately.
2. When online and signed in, the change is also written to Firestore.
3. If the device is offline, the app keeps the local change and performs a full reconciliation when connectivity returns.
4. Each record has an `updatedAt` timestamp. Newer edits win when two devices contain different versions of the same game.
5. Deletions create small local/cloud **tombstones** so a stale second device cannot accidentally resurrect a game you intentionally deleted.

# Backups

Keep using **Export backup** periodically even with cloud sync. The JSON file is an independent backup of your bowling history and deletion metadata. **Import backup** can restore it. CSV remains a convenient spreadsheet/reporting export.

# Updating an installed iPhone PWA

After replacing files in GitHub, open the web app while online. The service worker is versioned and will replace the previous cached app assets. `firebase-config.js` is handled network-first so configuration updates do not stay trapped behind an old cache.

# Notes

- Firebase cloud features require an internet connection; the bowling tracker itself does not.
- Scoreboard photos are currently used as a visual reference and are not uploaded to Firebase.
- Automatic scoreboard OCR can be added later without changing the game data model.
