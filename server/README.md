# NEARvest game server

Node.js + TypeScript + SQLite. Holds the game state, runs the village clock,
signs and pays for every NEAR transaction (relayer), and serves a JSON API for
the web game.

## Run locally

```sh
cd server
npm install
node scripts/init-env.ts      # creates .env with a fresh game key and MASTER_KEY (prints only the public key)
npm run dev                   # http://127.0.0.1:8787
npm test                      # unit + API tests (fake chain, in-memory database)
node scripts/e2e.ts           # full loop on testnet against the running server (needs DEV_LOGIN=true)
```

Set `CHAIN_MODE=fake` in `.env` to play without touching the blockchain.

## API

Public: `GET /health`, `GET /api/config`, `GET /api/stats` (Village Stats), `GET /api/darto`.

Auth: `POST /auth/google {credential}`, `POST /auth/dev {username}` (only when `DEV_LOGIN=true`), `POST /auth/logout`.
Both return `{ token, player }`; send `Authorization: Bearer <token>` afterwards.

Player (login required):

| Route | Body | Does |
|---|---|---|
| `POST /api/player` | `{ name, demo? }` | Creates the garden and `<name>.nearvest.testnet`, welcome pack (50 PANEN + Rare Durian seed) |
| `GET /api/me` | | Full game state (plots, seeds, fruits, items, check-in calendar, Mr. Darto, on-chain activity with explorer links) |
| `POST /api/checkin` | | 5 PANEN + Mango seed per day (day 7: 10 PANEN + Gold Mango seed) |
| `POST /api/plant` | `{ plot, seedId }` | Plants a seed and mints the Tree NFT |
| `POST /api/water` | `{ plot }` | Once per tree per game day |
| `POST /api/fertilize` | `{ plot }` | Uses 1 fertilizer: +50% growth for 1 day |
| `POST /api/harvest` | `{ plot }` | 1 fruit (+XP); an old tree drops a seed and becomes a Memorial Tree |
| `POST /api/chop` | `{ plot }` | Cuts the tree down (Memorial Tree) to free the plot |
| `POST /api/sell` | `{ species, quality, qty }` | Sells to Mr. Darto: `mint_reward` (Season rule) |
| `POST /api/shop/buy` | `{ item, qty }` | `seed_mango`, `seed_rambutan`, `seed_durian`, `fertilizer`: burns PANEN |

Every action answers instantly; the NEAR transaction is queued and appears in `activity` with its explorer link once it lands.

## Security notes

- Player keys are generated on the server and stored encrypted (AES-256-GCM, `MASTER_KEY`). This is a **custodial testnet design**: the game server controls player accounts. Back up `MASTER_KEY` privately; never commit `.env`.
- The game account key only lives in `.env`. It is a minter on both contracts and the only account the factory accepts.
- Welcome packs are limited to 3 per IP per day; login itself is never blocked by IP.
