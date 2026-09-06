# Discord integration

The Worker backend, slash commands, account-linking flow and setup helpers are implemented in [bot/README.md](bot/README.md). Follow that guide to deploy to Cloudflare and configure Discord. The app-side serviceUrl remains empty until you provide the Worker URL or update discord-config.js yourself.

The linking flow uses a top-level popup with an HttpOnly browser nonce, Firebase-authenticated link start, Discord identify authorization, single-use state, and unique D1 account mappings. Verified identity and group-data sharing are separate; sharing defaults off. No Discord tokens are stored after callback and no game notes are requested.

The bot reads Firebase through a dedicated service account with Cloud Datastore Viewer and Firebase Authentication Viewer permissions. It never writes bowling games. D1 stores links, explicit sharing choices, a server/group binding and delivery/replay state.
