# VOID Arena — Cloudflare Workers

A real-time two-player hole game served from a Cloudflare Worker, with a Durable Object coordinating the live arena and D1 storing accounts, sessions, and results.

## Stack
- Cloudflare Workers serves the site and authenticated HTTP routes.
- A SQLite-backed Durable Object holds the authoritative live arena, coordinates both players over native WebSockets, and persists movement without a D1 write on every frame.
- D1 stores accounts, password hashes, sessions, match records, and scores.
- Registration, login, three maps, match history, capacity enforcement, and loser-request/winner-accept rematches are included.

## Deploy to your Cloudflare account
1. Install Node.js 24 or newer and install dependencies with `npm ci`.
2. Authenticate Wrangler with your Cloudflare account: `npx wrangler login`.
3. Create the database: `npx wrangler d1 create void-arena-db`. Copy the returned database ID into the `CLOUDFLARE_D1_ID` environment variable.
4. Apply the schema: `npm run build`, then `npm run db:apply:cloudflare`.
5. Publish the Worker and static assets: `npm run deploy:cloudflare`.

The first deployment creates the SQLite-backed Durable Object namespace from the Worker export and binding configuration. The public URL is printed by Wrangler and uses the `workers.dev` domain unless you configure a custom domain.

## Free-plan notes
Free usage has account-level limits. Worker and Durable Object requests, D1 reads/writes, and storage are subject to Cloudflare's current quotas. Going beyond a Free quota can interrupt requests until the quota resets.

## Local development
Run `npm run dev` for the front-end development server. Use `npm run build` to build the production Worker. Durable Object and remote D1 behavior require Wrangler local/remote bindings.
