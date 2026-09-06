# Bowling Tracker Bot — setup guide

The bot is programmed for Discord application **1546004844970770443**. It runs as a Cloudflare Worker, uses D1 for verified account links/settings, and reads your existing Firebase project. It does not edit bowling games. No milestone announcements are included.

**Status:** code and local tests are complete. Cloudflare deployment, real OAuth linking, Discord installation and live Firebase permissions still need the steps below. The existing app remains usable while you do this. You need a computer for this one-time setup, but it can be switched off afterward.

## 1. Get the code and sign in to Cloudflare

Install Node.js 22 or newer from https://nodejs.org/ and Git if needed. In Terminal:

```bash
git clone https://github.com/MatthewGPTXI/bowling-tracker-cloud.git
cd bowling-tracker-cloud/bot
npx wrangler@4 login
```

If you already cloned the repository, pull its latest changes and open its `bot` folder instead. The Cloudflare login command opens your browser. Authorize your new free Cloudflare account. Every command below runs from the `bot` folder. There is no npm install step: runtime code uses platform APIs; Wrangler is run through npx.

## 2. Create the D1 database

```bash
npx wrangler@4 d1 create bowling-bot
```

Copy the returned database ID. If asked whether to add the binding automatically, decline because this project already contains the binding template.

Open `wrangler.toml` and replace `REPLACE_WITH_D1_DATABASE_ID` with that ID. Keep the binding name **DB**.

Initialize the database:

```bash
npx wrangler@4 d1 execute bowling-bot --remote --file=schema.sql
```

This creates new bot tables only. It does not touch Firebase. See [Cloudflare's D1 guide](https://developers.cloudflare.com/d1/get-started/) for the dashboard equivalent.

## 3. Deploy once to get the Worker address

```bash
npx wrangler@4 deploy
```

Copy the HTTPS URL it prints, such as `https://bowling-tracker-bot.your-subdomain.workers.dev`.

In `wrangler.toml`, set `WORKER_ORIGIN` to that exact origin **without a trailing slash**, then deploy again:

```bash
npx wrangler@4 deploy
```

Keep Workers on the Free plan. No custom domain is required. Do not set a paid CPU limit in the config.

## 4. Add the Discord secrets

In https://discord.com/developers/applications open **Bowling Tracker Bot**:

- **Bot:** obtain/reset the bot token, then run:

```bash
npx wrangler@4 secret put DISCORD_BOT_TOKEN
```

Paste it into Wrangler's private prompt.

- **OAuth2:** obtain the Client Secret, then run:

```bash
npx wrangler@4 secret put DISCORD_CLIENT_SECRET
```

The Public Key and Application ID you supplied are already in `wrangler.toml`; they are not secrets. The bot token and Client Secret must not go in that file, the app, GitHub, chat or screenshots. [Cloudflare secret documentation](https://developers.cloudflare.com/workers/configuration/secrets/).

## 5. Give the bot read access to Firebase

Use the [Google Cloud console](https://console.cloud.google.com/) and select **bowling-tracker-aad74**:

1. Open **IAM & Admin → Service Accounts → Create service account**.
2. Name it `bowling-discord-reader`.
3. Grant **Cloud Datastore Viewer** (`roles/datastore.viewer`) and **Firebase Authentication Viewer** (`roles/firebaseauth.viewer`). Do not grant Owner, Editor or write access.
4. Open the new service account → **Keys → Add key → Create new key → JSON**.
5. Save the downloaded JSON outside your repository, such as in Downloads.
6. From the bot folder run, replacing the path:

```bash
node upload-firebase-secrets.mjs "/full/path/to/downloaded-service-account.json"
```

The helper checks the project and uploads only the email and private key to Cloudflare secrets. It does not copy or print the key. Keep the original key private or delete the local download after successful setup; deleting the download does not revoke the Google key.

Existing Firestore security rules remain unchanged. Server service-account reads use IAM, so bot code separately checks account existence, group membership. [Firestore REST authentication](https://firebase.google.com/docs/firestore/use-rest-api).

Visit `YOUR_WORKER_URL/health`. It should return `ok: true` and `configured: true`. This checks that settings exist; the first real command verifies Google access. If authentication lookup is blocked, confirm the Firebase Authentication Viewer role. If the app's Firebase web API key has browser-referrer restrictions, supply a separate key restricted to Identity Toolkit API for `FIREBASE_API_KEY` in the Worker's configuration; do not weaken the browser key's restrictions.

## 6. Connect the Worker to Discord

In the Discord Developer Portal:

1. **OAuth2 → Redirects:** add exactly `YOUR_WORKER_URL/discord/callback` and save. It must match the Worker's origin and callback path exactly.
2. **General Information → Interactions Endpoint URL:** enter `YOUR_WORKER_URL/interactions` and save. Discord verifies the endpoint's signature handling and PING response.
3. **Installation:** enable Guild Install with scopes **bot** and **applications.commands**. Grant **View Channels** and **Send Messages**. No Administrator or privileged gateway intents are needed.
4. Open the install link and select your Discord server.

This direct installation link is already filled with your application ID:

https://discord.com/oauth2/authorize?client_id=1546004844970770443&permissions=3072&integration_type=0&scope=bot%20applications.commands

This is an HTTP interaction bot, so slash commands work without maintaining an online presence connection. Its status dot may appear offline.

## 7. Register the commands in your server

In Discord, enable **User Settings → Advanced → Developer Mode**. Right-click your server icon → **Copy Server ID**.

```bash
npm run register -- YOUR_SERVER_ID
```

The script asks for the bot token locally, or reads `DISCORD_BOT_TOKEN` from your environment. This registers server-specific commands using Discord's command API; it replaces this application's existing commands in that server. If slash commands do not immediately appear, reopen Discord. Keep the token private.

## 8. Enable app linking

In the repository root's `discord-config.js`, set:

```js
window.BOWLING_DISCORD_CONFIG = {
  serviceUrl: 'https://bowling-tracker-bot.YOUR-SUBDOMAIN.workers.dev'
};
```

Use your actual origin with no path or trailing slash, then commit this one file through GitHub so GitHub Pages publishes it. Alternatively, send Codex just the Worker URL and ask to apply this change. Do not send any secrets.

Open Bowling Tracker online, close and reopen it, and verify the **v18** footer. Sign in → Account settings → **Connect Discord**. Allow the popup, authorize **identify** in Discord, then return to the app. Refresh connection if the browser does not refresh it automatically. The popup has its own one-time browser cookie; a copied authorization link cannot complete a link from another browser.

Have the other players connect their own accounts too. A Discord ID can be linked to only one bowling account. Disconnect before changing accounts.

## 9. Configure your bowling server

The person doing this must have **Manage Server** in Discord and own the bowling group in the app. Find the group's eight-character invite code, then run:

```text
/bowling configure group:ABCDEFGH
```

Other players must join that same bowling group in the app.

Linked group members are automatically available for comparisons, leaderboards and recaps. No separate sharing opt-in is required. All command replies are public in the channel where the command is used. Disconnect Discord in the app to stop future access; previously posted messages remain in Discord.

## 10. Try the commands

| Command | Example / behavior |
|---|---|
| `/bowling link` | Opens the app link and explains account linking |
| `/bowling stats` | Your stats; optional `player`, `from`, `through`, `type` |
| `/bowling session` | Latest session; optional `player` |
| `/bowling ball` | Lists recorded ball names when omitted; `ball:Phaze II` filters statistics |
| `/bowling leaderboard` | All-history rankings; optional metric |
| `/bowling compare opponent:@Player` | Compare yourself with a tagged player; optional `player` changes the first person; optional dates/type |
| `/bowling recap` | Group recap for the previous seven complete UTC dates |
| `/bowling configure` | Bind the server's bowling group and configure weekly recaps |
| `/bowling disable` | Remove this server's group binding and stop scheduled recaps |

Date format: `YYYY-MM-DD`. Date ranges are inclusive. All command responses are public in the channel where the command is used. Scheduled recaps are posted to the configured channel. Notes never appear. Only Firebase-synced games are available. Untagged old games default to League, and ball matching ignores case/extra spaces.

## 11. Optional automatic weekly recap

Only enable this if you want channel posts. Use a channel restricted to your bowling group:

```text
/bowling configure group:ABCDEFGH channel:#bowling weekly:true
```

The default schedule is **Mondays at 16:00 UTC** (9 AM Pacific daylight time / 8 AM Pacific standard time). To change it, edit `[triggers].crons` in `wrangler.toml` and redeploy; Cloudflare cron uses UTC. It covers the previous seven complete UTC dates. Linked group members are included. To stop posts, reconfigure with `weekly:false` or use `/bowling disable`.

## Limits and verification

This free-tier-oriented version supports one connected Discord server per Worker, up to 100 group members for leaderboard lookup, up to 15 linked players in a weekly recap, 2,000 stored game/deletion records per player for all-history commands, and 500 games/player in a recap week. Larger histories return an explanation rather than silently calculating incomplete stats. Recap jobs reserve each week before posting to avoid duplicates; a failed run is not automatically resent. `/bowling recap` can still post it in the current channel.

Cloudflare request/CPU/subrequest and Firebase read quotas still apply. This is designed for a small group; free-tier performance must be checked with your actual data. Google network calls and D1 are bounded, but no paid services are automatically enabled. Monitor both dashboards during initial tests. Some group commands read multiple users' histories.

Run tests locally:

```bash
npm test
```

Tests include real Ed25519 signature verification, bad/replayed OAuth state rejection, mocked Firebase/OAuth integration, linked-account and group authorization, command schema and bowling calculations. They do not prove live Cloudflare, Google IAM, Discord OAuth or browser-popup behavior. After deployment test two different linked users: self stats, public comparison without a separate opt-in, a nonmember rejection, disconnect, and a real channel recap only if you chose to enable it.

For logs:

```bash
npx wrangler@4 tail
```

Do not paste tokens, full interaction payloads or service-account JSON into bug reports. Send the command name, sanitized error message and Worker URL.

## Public reply update (v19)

The sharing command has been removed. The existing D1 share column is unused and can stay in place; no migration is required. If you already deployed an earlier bot, pull the latest source, run `npx wrangler@4 deploy`, then `npm run register -- YOUR_SERVER_ID` to replace the command definitions. For a new installation, simply use the current setup steps above.
