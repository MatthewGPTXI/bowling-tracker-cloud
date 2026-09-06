# Discord linking handoff

The v17 app-side linking UI is implemented. The linking Worker and bot are not deployed yet; `discord-config.js` intentionally has an empty serviceUrl. Leave it empty until the service below exists and has been tested. This build cannot yet link real Discord accounts.

## API required from the linking Worker

All app requests require a current Firebase ID token in Authorization: Bearer. Verify that token server-side, including project/audience, issuer, expiry and user identity. Never trust a UID supplied in the request body. Allow only the actual app origin through CORS. Responses must not be cached.

- GET /discord/link: return {linked:false} or {linked:true,discordUserId:"snowflake string",username:"display name"} for the authenticated Firebase user.
- POST /discord/link/start: return {authorizationUrl:"https://discord.com/oauth2/authorize?..."}. Request only identify, use response_type=code, and a cryptographically random, short-lived, single-use state bound to the verified Firebase user. Callback URL is configured server-side.
- GET /discord/callback: validate and atomically consume state, exchange the code on the server, then call Discord /users/@me. Atomically store a unique Firebase UID ↔ Discord user ID mapping in server-controlled storage. Neither an arbitrary username nor a submitted Discord ID proves ownership. Reject identities already connected elsewhere. Return only to the fixed app URL; never put credentials in its URL. Discard Discord access tokens after identity verification if no continued API access is needed.
- DELETE /discord/link: remove both directions of the authenticated user's mapping. Return 204. Do not touch games. Account deletion must also remove mappings; linking/lookup must reject deleted Firebase accounts.

The browser rejects OAuth redirect URLs outside Discord's authorization endpoint and ignores responses from a previously active account. Failed Discord operations do not participate in game sync.

## Compare command integration

Define Discord command arguments as USER options so people can select or mention members. Resolve their immutable Discord IDs through verified mappings; missing mappings should prompt that person to connect. Keep identity linking separate from consent to publish data. Enforce server/group membership and sharing permissions for both players on every request; private notes are excluded. Never treat a linked identity as permission to read another player's private history.

## Setup still needed

Discord Application ID, Public Key, chosen callback URL and deployed Worker origin; configure the client secret, bot token and server-side Firebase access privately in Worker secrets. Do not paste secrets into chat or commit them. Once the backend works, set serviceUrl to its HTTPS origin in discord-config.js, test OAuth with two users, then enable compare commands.
