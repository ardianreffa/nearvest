# NEARvest

**Grow. Harvest. Own.**

A pixel farming game where your tree is a living NFT and an AI farmer tends it while you sleep.

- Live demo: **https://nearvest-six.vercel.app** (game: https://nearvest-six.vercel.app/play)
- Network: **NEAR testnet only**. Tokens and NFTs have no real value.
- On chain so far (testnet, 9 Nov 2026; the numbers keep growing): [139 Tree NFTs minted](https://testnet.nearblocks.io/nft-token/pohon.nearvest.testnet), [5,487 PANEN supply across 43 holders](https://testnet.nearblocks.io/token/panen.nearvest.testnet), [1,386 transactions sent by game.nearvest.testnet](https://testnet.nearblocks.io/address/game.nearvest.testnet).
- Demo video: coming soon.
- Built during the NEAR Hackathon (first commit 2026-11-05) by a solo builder, with Claude Code. License: MIT.

![NEARvest: the pixel village of Tandur with TaniBot](web/public/og-image.png)

---

## 1. Problem and idea

Most web3 games ask a new player to install a wallet, buy gas, approve pop-ups and understand tokens before they can plant a single seed. Most people leave at that step, and the game loop never gets a chance.

NEARvest does it the other way round: **play first, own later.**

- Sign in with Google. The game creates your own NEAR account (`<name>.nearvest.testnet`) and pays every fee.
- No wallet pop-ups while you play. The chain works in the background: your trees are NFTs, your coins are a token, your AI helper has its own wallet.
- A NEAR wallet is optional. If you already have one (Meteor and others via near-connect), you can sign in with it and keep everything in your own account.

The core loop: daily check-in → plant a seed (a Tree NFT is born) → water / fertilize (you or TaniBot) → harvest → sell to Mr. Darto (earn $PANEN) → spend in the Shop (the PANEN is burned) → plant again. Old trees drop a better seed and become Memorial Trees that stay visible in the garden.

---

## 2. Try it in 2 minutes (for judges)

Best on a laptop with Chrome. Phones work too (portrait).

**Fastest path: Try as Judge** (no sign-in, a ready garden with real testnet NFTs and tokens; demo mode: 1 game day = 1 minute).

| # | Do | See |
|---|---|---|
| 1 | Open https://nearvest-six.vercel.app and click **Try as Judge** (or open https://nearvest-six.vercel.app/play?judge=1). | A new garden `judge-xxxx.nearvest.testnet` opens in a few seconds: 3 Tree NFTs (a ripe Rare Durian on plot 1), 100 PANEN, seeds, and TaniBot switched on. A gold **Judge tour 0/5** chip is in the top-left status bar. |
| 2 | Click **Judge tour** → **Go to the garden** → click plot 1 → **Harvest**. | A Rare Durian goes to your Storage. The Tree NFT on `pohon.nearvest.testnet` is updated (stage, harvest count). The tour step gets a **View transaction on nearblocks** link. |
| 3 | Open the **Market** (Mr. Darto) and sell the fruit. | PANEN is minted to your account with `mint_reward`; the reward follows the Season halving (Season 3 on testnet now = rewards ÷ 4). The tour links the transaction. |
| 4 | Open the **Shop** and buy **Fertilizer**. | The PANEN you spend is **burned** on chain (`burn` on `panen.nearvest.testnet`). Your PANEN balance goes down and the burned total goes up. |
| 5 | Open **TaniBot** (robot button in the menu header on laptops, TaniBot tab on phones). | Its **Log**: every action (water, harvest, sell) with its reason and a transaction link, sent from TaniBot's own account `bot.judge-xxxx.nearvest.testnet`. Its budget and daily spending limit are enforced by the PANEN contract. |
| 6 | Open the **Village** tab. | Village Stats read live from the contracts: PANEN supply, total burned, Season and halving, plus your on-chain activity with nearblocks links. |

The Judge tour window ticks each step and links its proof. Judge gardens are limited (3 per IP per day); after that a recent judge garden is shared.

**Other ways to sign in** (all tested on a laptop, Android Chrome and iPhone Safari):

- **Sign in with Google** at https://nearvest-six.vercel.app/play. The game creates your NEAR account and pays every fee. On iPhone / iPad the page goes to Google in the same tab (no pop-up) and comes back to the game.
- **Connect NEAR Wallet**: near-connect wallet list, NEAR **testnet** wallets only (tested with **Meteor Wallet**, web and mobile app). You sign one message (NEP-413), no transaction.

---

## 3. Tracks

**`games` (main): Games With Real Economies.** The game loop comes first and players barely notice the chain: Google sign-in, no fees, no pop-ups. Two NPCs take part in the economy: Mr. Darto buys fruit at a daily price that moves with supply (price bounds, never below the seed price), and TaniBot is an agent NPC with its own wallet and budget.

**`memecoins`: Memecoins With Mechanics.** $PANEN (NEP-141) has no pre-mint and 0% team: it is only minted when players farm. Harvest rewards halve per **Season** as total supply grows, and every PANEN spent in the Shop is **burned**. Live supply, burned total and Season are on the Village tab.

**`nfts`: NFTs That Do Something.** Each tree is a dynamic NEP-171 NFT in the player's own account: it grows, fruits and ages on chain as it is cared for, its stage and harvest count change in its metadata, and an old tree drops a superior seed (lineage) before becoming a Memorial Tree. The Memorial Tree keeps standing on its plot until the player plants a new seed there, and is listed with its harvests and NFT link in the Village tab; its NFT (marked `memorial` on chain) stays in the player's account. Ending an old tree and planting over a Memorial Tree are always the player's decisions: TaniBot never does either.

**`agents`: Agent Economy.** TaniBot has its own NEAR sub-account with a function call key, a budget the player sends it, and a **daily spending limit enforced by the PANEN contract** (`set_bot` / `bot_accept`; a bot can only burn within its limit and can never transfer). It earns for its player (harvest, sell) and spends from its own budget (buys seeds); every action is logged with its transaction. TaniBot's decisions come from an LLM on NEAR AI Cloud, checked by the game rules.

---

## 4. Built on NEAR

All on **NEAR testnet**.

| What | Account | Source | Explorer |
|---|---|---|---|
| $PANEN token (NEP-141, NEP-145, NEP-148, 18 decimals, Seasons, burn, TaniBot limits) | `panen.nearvest.testnet` | [`contracts/panen`](contracts/panen) | [nearblocks](https://testnet.nearblocks.io/token/panen.nearvest.testnet) |
| Tree NFT (NEP-171, NEP-177, NEP-178, NEP-181) | `pohon.nearvest.testnet` | [`contracts/pohon`](contracts/pohon) | [nearblocks](https://testnet.nearblocks.io/nft-token/pohon.nearvest.testnet) |
| Player account factory (creates `<name>.nearvest.testnet`) | `nearvest.testnet` | [`contracts/factory`](contracts/factory) | [nearblocks](https://testnet.nearblocks.io/address/nearvest.testnet) |
| Game server account (minter, relayer that pays gas, the only caller of the factory) | `game.nearvest.testnet` | [`server`](server) | [nearblocks](https://testnet.nearblocks.io/address/game.nearvest.testnet) |

NEAR features used:

- **Sub-accounts**: every player gets `<name>.nearvest.testnet` (through the factory contract); every TaniBot gets its own account (`bot.<player>.nearvest.testnet`, or `<name>-bot.nearvest.testnet` for wallet players).
- **Function call keys**: TaniBot signs with a key that can only call the PANEN contract; wallet players add one limited game key (only `burn` on PANEN) for the Shop.
- **Contract-enforced spending limit**: the PANEN contract stores each bot's daily limit and refuses anything above it.
- **NEP-366 meta transactions**: burns are signed by the player's key and relayed by `game.nearvest.testnet`, which pays the gas.
- **NEP-413** signed-message login for NEAR wallets, through `@hot-labs/near-connect`.
- **NEAR AI Cloud**: On the hosted demo, TaniBot's planner runs on NEAR AI Cloud (`Qwen/Qwen3-VL-30B-A3B-Instruct`); every suggestion is checked by the game rules, with a rule-based fallback.

---

## 5. $PANEN economy

- **Fair launch**: no pre-mint, 0% team. PANEN exists only because players farmed it.
- **Earning**: selling fruit (and seeds) to Mr. Darto mints PANEN with `mint_reward`, which follows the Season rule. The daily check-in (5 PANEN) and the welcome pack (50 PANEN) use a plain `mint` and are the same in every Season.
- **Season halving**: harvest rewards halve each Season, based on the total ever minted (burning never rewinds a Season), down to a floor of 1/8.
  - Testnet thresholds: **2,000 / 5,000 / 10,000 PANEN** (low on purpose, so judges can see halving). At the time of writing the testnet is in Season 3 (rewards ÷ 4); check `season_info` on `panen.nearvest.testnet`.
  - Mainnet plan: 100,000 / 200,000 / 400,000 PANEN (the contract's built-in defaults).
- **Burn**: every PANEN spent in the Shop (seeds, fertilizer) is burned.

---

## 6. Architecture

```
  Browser (phone / laptop)
  web/ : Vite + Preact, static site on Vercel
        |  HTTPS JSON API (session token)
        v
  Game server (VPS, Node.js 24 + TypeScript + SQLite)
  server/ : Google / NEAR wallet login, game state, village clock,
            Mr. Darto prices, TaniBot scheduler (+ NEAR AI Cloud),
            chain job queue, relayer
        |  signed transactions (game.nearvest.testnet pays gas)
        v
  NEAR testnet
  panen.nearvest.testnet (NEP-141)   pohon.nearvest.testnet (NEP-171)
  nearvest.testnet (factory)         player and TaniBot sub-accounts
```

- **Instant game, chain in the background**: an action updates SQLite at once and queues the NEAR transaction. One worker sends the queue in order, retries network errors, and reverts the local balance if a token job fails for good. The game shows a toast with the transaction link when it lands.
- **Relayer**: `game.nearvest.testnet` signs and pays for everything. Burns must come from the player, so the player's key signs a NEP-366 delegate action and the game relays it.

---

## 7. Honest notes

- **Custodial testnet design for Google players**: the server creates the player's NEAR account and keeps its key, **encrypted with AES-256-GCM** (the key comes from a server environment variable, never stored in the repo or in plain text in the database). Wallet players keep their own keys.
- **Wallet gardens**: the first Shop purchase adds one limited game key to the player's account; this single AddKey transaction is paid by the player's wallet (a tiny testnet fee). After that the game pays.
- **NEAR Intents and Chain Signatures are not used** (there is no Intents testnet, and the game is testnet only).
- **Everything is on testnet**: tokens and NFTs have no real value.
- **Coming soon, not in this version**: weather and volcano events, garden visits, Arena (1v1), P2P market. The village shows them as "Soon".

---

## 8. AI disclosure, assets and libraries

- **Code**: written together with **Claude Code** by a solo builder, Ardian Reffa (not a programmer), during the hackathon.
- **Art**: the village backgrounds, Mr. Darto, TaniBot's looks, the Shop and Market scenes were made with **ChatGPT** at Ardian's request and converted to pixel art with small scripts in [`tools/pixelize`](tools/pixelize); the original images are in [`docs/art-source`](docs/art-source). Trees, icons and effects are drawn in code.
- **Third-party assets**: CC0 art and sounds, and OFL fonts (Silkscreen, DotGothic16, Tiny5, self-hosted) are listed with their licenses in [`docs/ASSETS.md`](docs/ASSETS.md).
- **Libraries**: web: Preact, Vite, `@hot-labs/near-connect`, `near-api-js`. Server: Hono, `jose` (Google token check), `near-api-js`, Node's built-in `node:sqlite`. Contracts: `near-sdk` and `near-contract-standards` (Rust).

---

## 9. Run locally

Needs Node.js 24+ (and Rust + `cargo-near` only for the contracts). No real keys are needed for a local test: the fake chain keeps everything in the local database.

```sh
# 1) Game server on a fake chain (no NEAR transactions)
cd server
npm install
CHAIN_MODE=fake DEV_LOGIN=true WEB_ORIGINS=http://localhost:5173 \
  MASTER_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" \
  npm run dev                      # http://127.0.0.1:8787

# 2) Web game (second terminal)
cd web
npm install
npm run dev                        # open http://localhost:5173/play and use "Dev login"
```

- All settings are listed, without values, in [`server/.env.example`](server/.env.example) and [`web/.env.example`](web/.env.example). For the real testnet, `CHAIN_MODE=near` and a game account key are needed (see `server/scripts/init-env.ts`).
- Tests: `cd server && npm test`, `cd web && npm test`, `cd contracts && cargo test`. Type check: `npm run typecheck` in `server` and `web`.
- More detail: [`server/README.md`](server/README.md) (API), [`web/README.md`](web/README.md), [`contracts/README.md`](contracts/README.md).

---

## 10. Roadmap (after the hackathon)

- Full garden visits: visit friends' gardens, help water, stickers and messages.
- PvP: 1v1 Arena duels between gardens and their TaniBots.
- Weather and volcano events, the P2P market with TaniBot trading.
- Mainnet plan (not built): $PANEN stays 0% team; development funded by a small share of market fees and cosmetics; a $PANEN/NEAR pool on a NEAR DEX such as Rhea; **legal advice before any mainnet token launch**.

---

## 11. License

MIT, see [LICENSE](LICENSE).
