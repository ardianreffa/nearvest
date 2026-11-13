# NEARvest game server

Node.js 24 + TypeScript (run directly, type stripping) + built-in `node:sqlite` + Hono. Holds the
game state, runs the village clock (day changes at 07:00 WIB; demo gardens: 1 day = 1 minute),
decides prices, weather, catches and duels, signs and pays for every NEAR transaction (relayer),
and serves a JSON API for the web game.

## Run locally

```sh
cd server
npm install
# Fake chain (default): nothing is sent to NEAR, no real keys needed.
CHAIN_MODE=fake DEV_LOGIN=true WEB_ORIGINS=http://localhost:5173 FISHING=on ARENA_ONLINE=on \
  MASTER_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" \
  npm run dev                 # http://127.0.0.1:8787
npm test                      # unit + API tests (fake chain, in-memory database)
npm run typecheck
```

- Settings: variable names only in [`.env.example`](.env.example). An empty value uses the safe default (fake chain, dev login off, Arena online off, Fishing off).
- Real testnet: `CHAIN_MODE=near` plus your own game account. `node scripts/init-env.ts` creates `.env` with a fresh game key and `MASTER_KEY` (prints only the public key). `node scripts/e2e.ts` plays the full loop on testnet against a running server (needs `DEV_LOGIN=true`).
- Switches: `FISHING=on|off`, `ARENA_ONLINE=on|off`, `TANIBOT_AI=on|off` (NEAR AI Cloud; needs `NEAR_AI_API_KEY`, with a daily call limit and a dollar brake), `DEMO_MODE_DEFAULT`, `FAKE_SEASON=1..4` (fake chain only).

## API

Every answer is JSON. Send `Authorization: Bearer <token>` after login. Every action answers at once;
the NEAR transaction is queued and shows up in the game state's activity with its nearblocks link
once it lands. Request bodies over 32 KB are refused (413); more than 600 requests per IP per minute
get 429 `rate_limited`.

**Public:** `GET /health`, `GET /api/config` (contracts, Shop prices, rules, switches), `GET /api/stats` (Village Stats from the contracts and the database), `GET /api/darto` (today's prices).

**Sign in** (each returns `{ token, player }`):

| Route | Body | Does |
|---|---|---|
| `POST /auth/google` | `{ credential }` | Google ID token checked with jose (RS256, issuer, Client ID, expiry, verified email). 1 Google account = 1 garden |
| `POST /auth/near/challenge` | | One-time 32-byte nonce (5 minutes, single use) + recipient |
| `POST /auth/near` | NEP-413 proof | NEAR wallet login; the key must be a full access key of the account |
| `POST /auth/judge` | `{ deviceId }` | Try as Judge: a new ready garden per device (limits per IP and per day; then the least used judge garden is shared) |
| `POST /auth/dev` | `{ username }` | Local testing only (`DEV_LOGIN=true`, switched off for public origins) |
| `POST /auth/logout` | | Deletes the session |

**Garden and account** (login required):

| Route | Body | Does |
|---|---|---|
| `GET /api/session`, `GET /api/me` | `?device=` | Session check / full game state (plots, seeds, fruit, items, check-in, weather, Mr. Darto, TaniBot, social, Arena, fishing, activity) |
| `POST /api/player` | `{ name, demo?, ref?, deviceId? }` | Creates the garden and `<name>.nearvest.testnet` (max 16 characters), welcome pack (50 PANEN + Rare Durian seed) |
| `POST /api/checkin` | | Daily check-in: 5 PANEN (`mint`, day 7: 10) + a Mango seed (day 7: Gold seed). Demo: at most 7 paid check-ins per real day |
| `POST /api/plant` | `{ plot, seedId }` | Plants a seed, mints the Tree NFT (max 50 new trees per garden per real day) |
| `POST /api/water`, `/api/fertilize`, `/api/clean` | `{ plot }` | Water (once per tree per day), fertilizer (1.5x speed for 1 day, better fruit), clean volcanic ash |
| `POST /api/harvest` | `{ plot, then? }` | 1 fruit + XP; an old tree drops a superior seed and becomes a Memorial Tree (`then: 'plant' \| 'sell'` when Storage is full) |
| `POST /api/chop`, `/api/memorial/move` | `{ plot }` | Cut a tree down (Memorial Tree) / move a Memorial Tree off its plot |
| `POST /api/sell` | `{ species, quality, qty, expectedPrice? }` | Sells fruit to Mr. Darto (`mint_reward`); 409 `price_changed` if the day changed |
| `POST /api/seeds/sell`, `/api/seeds/discard` | `{ seedIds }` | Mr. Darto buys seeds (`mint_reward`) / throw seeds away |
| `POST /api/shop/buy` | `{ item, qty, signedBurn? }` | `seed_mango`, `seed_rambutan`, `seed_durian`, `fertilizer`: the PANEN is burned. Wallet gardens add `signedBurn` |
| `POST /api/wallet/burn` | | Wallet gardens: the exact burn (nonce, deadline) for the browser's game key to sign |
| `POST /api/wallet/link`, `/api/google/link` | NEP-413 proof / `{ credential }` | Link a NEAR wallet to a Google garden / a Google account to a wallet garden |
| `POST /api/avatar`, `/api/tutorial`, `/api/judge/step` | `{ avatar }` / `{ action }` / `{ step }` | Avatar (unlocked by title), tutorial progress, Judge tour progress |
| `POST /api/market/seen`, `/api/village/seen` | | Clears the Market / Village red dots |

**TaniBot:**

| Route | Body | Does |
|---|---|---|
| `GET /api/tanibot` | | Account, budget, daily limit, settings, Log |
| `POST /api/tanibot/setup` | `{ dailyLimit?, budget? }` | Creates the bot account with its function call key and links it (`set_bot` + `bot_accept`) |
| `POST /api/tanibot/linked`, `/api/tanibot/sync` | | Wallet gardens: after the wallet signed `set_bot` / re-read budget and limit from the chain |
| `POST /api/tanibot/settings` | e.g. `{ autoPlant: 'off' \| 'common' }`, on/off, style, limit | Settings (a new limit is written to the contract) |
| `POST /api/tanibot/fund`, `/api/tanibot/withdraw` | `{ amount }` | Google gardens: budget player → bot / bot → player (`bot_withdraw`) |

**Social:**

| Route | Does |
|---|---|
| `GET /api/farmers?q=` | Farmers of Tandur list or name search |
| `GET /api/farmers/:name` | Public garden view (no private data) |
| `POST /api/farmers/:name/water` | Help water 1 tree a day (+XP for both) |
| `POST /api/farmers/:name/sticker` | Send a template sticker (max 3 per garden per day) |
| `POST /api/visitors/:id/wave` | Wave back to a visitor |
| `POST /api/friends/:name`, `/api/friends/:name/remove` | Add / remove a friend (one-way) |
| `POST /api/ping` | `{ away? }`: Online dot; also delivers Arena invites |

**Arena** (3 duels a day, 1 per opponent; prize 8 PANEN `mint_reward` for the winner; draw = no prize):

| Route | Does |
|---|---|
| `GET /api/arena`, `GET /api/arena/can/:name` | Opponents, duels left, recent duels / can I challenge this garden |
| `POST /api/arena/match` | `{ opponent, live?, deviceId }`: start a duel vs that garden's TaniBot, or invite the player (`live`, needs `ARENA_ONLINE=on`) |
| `POST /api/arena/match/:id/accept`, `/decline`, `/leave` | Online invites and leaving |
| `GET /api/arena/match/:id`, `POST /api/arena/match/:id/pick` | Match state / `{ turn, pick }` (rock, paper, scissors or the Gold Durian) |
| `POST /api/arena/duel` | Old instant duel: answers 410 `duel_v1_off` |

**Fishing** (only with `FISHING=on`; else 404 `fishing_off`):

| Route | Does |
|---|---|
| `GET /api/fishing` | Casts left today, open line |
| `POST /api/fishing/cast` | `{ deviceId }`: the catch is rolled and stored, never sent before the reel (5 casts a day) |
| `POST /api/fishing/:id/reel` | Reveals the catch and pays it (409 `too_early` before the bite) |

## Security notes

- Google garden keys are generated on the server and stored encrypted (AES-256-GCM, `MASTER_KEY`). This is a **custodial testnet design**: the game server controls these accounts. Back up `MASTER_KEY` privately; never commit `.env`.
- The game account key lives only in `.env`. It is the minter on both contracts and the only account the factory accepts.
- Wallet Shop purchases are only accepted for a burn the server handed out, signed by a burn-only game key that is on the account; a burn that fails on chain takes the item back.
- Limits on free rewards are per IP (last `X-Forwarded-For` entry written by Caddy, `src/client-ip.ts`) and per browser device id. The device id can be changed by a script, so these are light testnet guards; login itself is never blocked by IP.
