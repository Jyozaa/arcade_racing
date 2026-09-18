# Apex GP — 3D Arcade Racing

Vite + TypeScript + Three.js arcade racing game with AI races and live
multiplayer (Open Track). The complete game — frontend **and** multiplayer —
runs on Cloudflare: static assets plus a Worker with a `RaceRoom` Durable
Object for WebSocket rooms.

## Scripts

| Command            | What it does                                                   |
| ------------------ | -------------------------------------------------------------- |
| `npm run dev`      | Vite dev server for the game (AI Race works standalone)        |
| `npm run dev:worker` | Cloudflare Worker + Durable Object locally (port `8787`)     |
| `npm run build`    | Type-check + production build into `dist/`                     |
| `npm run preview`  | Preview the production build locally                           |
| `npm run deploy`   | Build, then deploy game + multiplayer to Cloudflare            |

## Local development

```bash
npm install
```

Terminal 1 — the game:

```bash
npm run dev        # http://localhost:5173
```

Terminal 2 — multiplayer (needed for Open Track):

```bash
npm run dev:worker # http://localhost:8787 (game + /ws/public + /health)
```

Open `http://localhost:5173` (Vite proxies `/ws` and `/health` to the Worker),
or open `http://localhost:8787` to play the Worker-served build directly.
Open Track connects same-origin to `/ws/public`; no URLs to configure.
For two-player testing, open the game in two browser windows — each sees the
other car, liveries sync, and laps feed the shared leaderboard.

Tip: append `?server=ws://localhost:8787/ws/public` to force an endpoint.

## Cloudflare Deployment

No environment variables or secrets are required. You need a Cloudflare
account (free tier works) and `npm install` completed.

### 1. Log in to Wrangler (one time)

```bash
npx wrangler login
```

This opens a browser window to authorize Wrangler against your Cloudflare
account. Verify with:

```bash
npx wrangler whoami
```

### 2. Deploy (creates Worker + Durable Object)

```bash
npm run deploy
```

This runs the production build and uploads it. On the **first** deploy,
Wrangler reads `wrangler.jsonc` and automatically:

- creates the `arcade-racing` Worker,
- registers the `RaceRoom` Durable Object class (migration `v1`, SQLite
  storage — this is what persists the leaderboard),
- uploads `dist/` as static assets served from the same origin.

No manual Worker/Durable Object creation is needed; there is nothing to click
through for the defaults.

### 3. Get your URL

After deploy, Wrangler prints:

```text
https://arcade-racing.<your-subdomain>.workers.dev
```

Open it: the game loads, and Open Track connects to
`wss://arcade-racing.<your-subdomain>.workers.dev/ws/public` automatically
(same origin — the client derives it from `window.location`, so there is
nothing to configure per environment).

### 4. Custom domain (later, optional)

1. In the Cloudflare dashboard, go to **Workers & Pages → arcade-racing →
   Settings → Domains & Routes**.
2. Click **Add → Custom Domain**, enter e.g. `race.example.com`.
3. If the domain's DNS is on Cloudflare, the record is created for you;
   otherwise add the suggested CNAME/TXT at your registrar.

The game and multiplayer move together — no client change needed, since the
WebSocket endpoint stays same-origin (`wss://race.example.com/ws/public`).

### 5. Test the WebSocket endpoint

Health check (any browser/`curl`):

```bash
curl https://arcade-racing.<your-subdomain>.workers.dev/health
# {"ok":true,"service":"arcade-racing"}
```

Socket check (needs `node` ≥ 21):

```bash
node --input-type=module -e "
const ws = new WebSocket('wss://arcade-racing.<your-subdomain>.workers.dev/ws/public');
ws.onmessage = (e) => { console.log('got:', e.data.slice(0, 120)); ws.close(); };
ws.onerror = (e) => { console.error('error', e); process.exit(1); };
"
# got: {\"type\":\"init\",\"playerId\":\"player_...\", ...}
```

An `init` message with a `playerId` means the Durable Object room is live.
Room routing is `idFromName(roomId)` on `/ws/:roomId`, so extra rooms work
without code changes (the game uses `/ws/public`).

### Dashboard notes

- **No environment variables, secrets, KV, R2, or D1 are used.** The only
  binding is the `RACE_ROOM` Durable Object (visible under the Worker's
  **Settings → Bindings**).
- Leaderboard rows live in Durable Object SQLite storage and survive Worker
  restarts/redeploys. To wipe the leaderboard, delete the Durable Object
  data (**Workers & Pages → arcade-racing → ... → Durable Objects**) or bump
  the storage key / migration tag in code.
- Logs: `npx wrangler tail` streams live Worker logs.

## How multiplayer works

- `worker/index.ts` — Worker entry: serves `dist/` assets, `/health`, and
  routes `/ws/:roomId` to the `RaceRoom` Durable Object.
- `worker/RaceRoom.ts` — one Durable Object per room; owns players,
  broadcast, and the persisted leaderboard. Same message protocol as the old
  Node server (`init`, `player_joined/left/update/livery`,
  `leaderboard_update` / `update`, `livery`, `lap_completed`), with server-side
  throttling, payload caps, lap-spam and impossible-lap guards.
- `worker/protocol.ts` — dependency-free validation/leaderboard helpers.
- `src/network/MultiplayerClient.ts` — unchanged behaviour; defaults to the
  same-origin `/ws/public` endpoint with the `?server=` override kept for
  debugging.

## Finish cinematic

Winning (or finishing) an AI race plays a 3-shot cutscene
(`src/camera/FinishCinematic.ts`, ~2s + ~2s + ~2.5s): a side tracking shot
drifting frontwards, a locked-off trackside pass-by, and a rear three-quarter
hero shot — then the results screen. The car rolls on under autopilot during
the sequence. `Escape` skips to results. Open Track is unaffected (no
cutscene; continuous racing).
