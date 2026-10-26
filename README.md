# VOID Arena — ChatGPT Site

Hosted edition of the original two-player black-hole game.

## Hosted behavior
- Original landing page, username/password registration and login, Canvas artwork, and three maps.
- Passwords use salted scrypt hashes. Session cookies are HttpOnly, SameSite=Strict, Secure, and host-scoped in production.
- Cloudflare D1 stores accounts, hashed sessions, the shared arena, and each player's match history.
- Native WebSockets carry live state. Same-origin HTTP polling is an automatic fallback if a browser or hosting proxy cannot establish a WebSocket.
- Two players share one authoritative arena. D1 version checks serialize conflicting updates across Worker instances.
- Clients submit only direction. Growth, consumption, scores, map selection, match completion, and capacity are enforced by the server.
- The arena advances when authenticated players send updates; finished results are committed atomically with the final arena state.
- A dropped connection forfeits an active round. An unresponsive player is removed after ten seconds on the next arena update.
- Original localhost accounts are not uploaded. Register a new account on this Site.

## Layout
- `content/`: complete landing/game HTML.
- `public/assets/`: styles, rendering, input, and cloud WebSocket client.
- `lib/game/engine.js`: map generation and simulation.
- `lib/game/cloud-auth.js`: credentials and sessions.
- `lib/game/cloud-arena.js`: database-backed matchmaking, simulation, and results.
- `lib/game/cloud-api.js`: authenticated routes and WebSocket handling.
- `worker/index.ts`: Sites Worker entrypoint, retaining the starter's Sites integration.
- `db/schema.ts` and `drizzle/`: cloud database schema and migration.
- `tests/cloud.test.mjs`: account, security, concurrency, capacity, and durable-results checks.

## Validation
The cloud tests pass, the Sites production build succeeds, and the built Worker was checked locally with its actual D1 runtime. Browser checks verified registration, a native-WebSocket two-player match, movement, growth, and saved history.

## Development
Use Node.js 24.15+ in the 24.x series. Install dependencies with `npm ci`, then follow the Sites starter instructions for generating/applying local D1 migrations and previewing the built Worker. The Sites plugin applies hosted migrations when publishing.

The publication is self-contained and does not depend on the original localhost server. Production networking latency varies with each connection and database round-trip time. This implementation is intentionally scoped to two players, rather than a high-volume competitive game service.
