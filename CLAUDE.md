# CLAUDE.md — NEARvest project rules

## What NEARvest is

NEARvest is a mobile-friendly, web-based pixel-art farming game on NEAR.
Tagline: **Grow. Harvest. Own.**
For judges: *A pixel farming game where your tree is a living NFT and an AI farmer tends it while you sleep.*

- Theme: Solarpunk Nusantara (futuristic tropical Indonesian village named **Tandur**).
- Core loop: daily check-in -> plant seed (tree NFT is born) -> tend (player or TaniBot) -> harvest -> sell to Mr. Darto (earn $PANEN) -> shop (spent $PANEN is burned) -> plant again. Old trees drop superior seeds.
- Design principles: play first, ownership later (players should barely notice the chain); Google login, no approve popups, game pays gas; the player is never stuck; only core assets live on-chain ($PANEN, Tree NFT, Farmer Card SBT, TaniBot wallet). Everything else lives on the game server.

**Source of truth:** `docs/NEARvest-Game-Design-Document.pdf` (GDD) for every feature and number. Hackathon rules: `docs/HACKATHON.md` (re-check the live version at https://nearhackathon.com/HACKATHON.md before submitting). If the GDD and this file disagree, the GDD wins; ask Ardian if unclear.
Tip: the Read tool cannot render this PDF without poppler. Extract text with macOS PDFKit (a small Swift script) into the scratchpad instead of installing tools.

## Hackathon

- Event: NEAR HACKATHON. Development ends **2026-11-14 23:59 UTC** (Sun 15 Nov 06:59 WIB). Target: submit Saturday 14 Nov evening.
- Solo builder: Ardian Reffa, built with Claude Code (say so in the README).
- One submission, 4 tracks:
  - `games` (main) — Games With Real Economies: agent NPCs (Mr. Darto, TaniBot), social login, judged on the game loop.
  - `memecoins` — Memecoins With Mechanics: $PANEN (NEP-141), fair launch, Seasons/halving, Village Granary, Harvest Festival, burns.
  - `nfts` — NFTs That Do Something: Living Tree NFT (dynamic NEP-171, produces fruit, lineage), Memorial Tree, Farmer Card SBT.
  - `agents` — Agent Economy: TaniBot has its own sub-account wallet, budget, contract-enforced daily spending limit, trades in the P2P market.
- Repo must be public before the deadline, with MIT LICENSE (already present). README for humans and AI: product, problem, "do X - see Y" steps, NEAR features used, assets and libraries, AI-assisted code, honest note that NEAR Intents/Chain Signatures are not used (no Intents testnet).
- Hosted demo on Vercel, kept alive until 2026-11-25.

## Network and accounts

- **Everything runs on NEAR testnet.** Never mainnet.
- Main account: `nearvest.testnet`. Its key is in the macOS keychain via near-cli-rs 0.30.1. Never print, export, or copy the key into files.
- Player accounts: sub-accounts like `ardian.nearvest.testnet`; TaniBot: `bot.ardian.nearvest.testnet`.
- The game server (VPS, Singapore, ~1 GB RAM free; another bot "Entropy" also runs there) is the only signer for the game (relayer). Players never pay gas or approve transactions.

## Decisions (agreed with Ardian, 2026-11-05)

- **Login:** Google login to our own game server. On first login the server creates the player's sub-account `<name>.nearvest.testnet` and pays the gas. The player's account key is generated and held by the server and **must be stored encrypted** (key from an env variable, never in the repo or plain text in the database). The README must say honestly that this is a custodial testnet design. Second login: NEAR wallet via `@hot-labs/near-connect` (do not use MyNearWallet, deprecated 2026-10-31). Both are done and were tested by Ardian on 2026-11-07 (see Game server -> Login).
- **Smart contracts:** Rust with `near-sdk-rs` (NEAR's only official contract SDK; standard NEP-141/NEP-171 implementations available).
- **Assets:** only assets listed in `docs/ASSETS.md`. Check the license on the source page before adding any asset, and record it there with any requested attribution.

## Deployed contracts (testnet)

| Contract | Account | Source | Owner | Minters |
|---|---|---|---|---|
| $PANEN (NEP-141, 18 decimals) | `panen.nearvest.testnet` | `contracts/panen` | `nearvest.testnet` | `game.nearvest.testnet` |
| Tree NFT (NEP-171/177/178/181) | `pohon.nearvest.testnet` | `contracts/pohon` | `nearvest.testnet` | `game.nearvest.testnet` |
| Player account factory | `nearvest.testnet` | `contracts/factory` | itself (`set_creator` only from `nearvest.testnet`) | creator: `game.nearvest.testnet` |

- First deploy 2026-11-05 (near-sdk 5.30.0, Rust 1.99.1, cargo-near 0.22.0). Keys of `nearvest`, `panen`, `pohon` are in the macOS keychain.
- **Game server account:** `game.nearvest.testnet` (minter, relayer that pays all gas, the only allowed caller of the factory). Its key exists **only** in `server/.env` (created by `node scripts/init-env.ts`, never printed). The temporary minter `nearvest.testnet` was removed on 2026-11-05.
- Why a factory: on NEAR only `nearvest.testnet` can create `<name>.nearvest.testnet`. The factory contract lets the server create players without holding the main account's full access key.
- Storage for new players and trees is paid from each contract's own balance: top up from the faucet when low.
- Build: `cd contracts/<name> && cargo near build non-reproducible-wasm`. Test: `cd contracts && cargo test`.
- **$PANEN upgrade 2026-11-07 (TaniBot budgets)**: tx `DwbAPm6pZDFJvCKKN2v3knfotAGfNLCbCSG2Ksk3yroc`. Adds `set_bot(bot_id, daily_limit)` (player, 1 yocto), `bot_accept(owner_id)` (the bot, callable with its function call key), `bot_withdraw(bot_id, amount)` (player, 1 yocto, accepted bots only), `bot_info(bot_id)`. A linked bot can only `burn` up to its daily limit (00:00 UTC = 07:00 WIB) and can never transfer. Bot records are stored under raw keys `bot:<account>` outside the contract struct (no migration). Before any contract upgrade: run the sandbox test `cargo test -p panen --test upgrade -- --ignored --nocapture` (imports the live code + data, upgrades, compares) and back up the live wasm.
- **Rollback of a contract upgrade:** old wasm files are kept in `backups/contracts/` (git-ignored; e.g. `panen-before-tanibot-2026-11-07.wasm`, code hash `3FHwKSyADanTXLLNM3PXgstdNdeNDEGe3i58cYcSzaFR`). Back up first: download the live code with the RPC `view_code` query (base64) and check its sha256/base58 hash equals the account's `code_hash`. Roll back (ask Ardian first): `near contract deploy panen.nearvest.testnet use-file backups/contracts/panen-before-tanibot-2026-11-07.wasm without-init-call network-config testnet sign-with-keychain send`. Data stays (the old code simply ignores the `bot:` keys; linked bots would then lose their limits, so pause TaniBot before a rollback).

## $PANEN rules (agreed with Ardian, 2026-11-05)

- **Halving applies only to harvest sales** (`mint_reward`). Daily check-in (5) and the welcome pack (50) use exact `mint` and stay the same in every season.
- **Season thresholds** (total ever minted; burning never rewinds a season):
  - Hackathon / testnet: **2,000 / 5,000 / 10,000 PANEN** (set on-chain 2026-11-05 via `set_season_thresholds`), so judges can see halving happen.
  - Mainnet plan: **100,000 / 200,000 / 400,000 PANEN** (the contract's built-in default).
- `burn` does not require a 1 yoctoNEAR deposit, so TaniBot (function call key) and the relayer can burn for Shop purchases. Only the caller's own tokens can be burned.

## Game server (agreed with Ardian, 2026-11-05)

- **Stack:** Node.js 24+ running TypeScript directly (type stripping), built-in `node:sqlite`, Hono (HTTP), near-api-js 7, jose (Google token check). Tests: `cd server && npm test` (built-in `node:test`), type check: `npm run typecheck`.
- **Build and test on the Mac first** (`npm run dev`, port 8787, localhost only). Move to the VPS only after asking Ardian.
- **VPS:** `ssh ubuntu@150.109.24.35` (Ubuntu, Singapore, 1.9 GB RAM, ~1 GB free). The bot **"Entropy" runs there: never stop, change or touch anything of it.** Always ask Ardian before connecting to or changing the VPS. Passwordless SSH from the Mac works (checked 2026-11-05: Ubuntu 22.04.5 LTS, ~1 GB RAM available, 27 GB disk free). Never ask Ardian to paste a password.
- **Players:** the server creates `<name>.nearvest.testnet` through the factory (0.003 NEAR storage paid by the game), generates the key pair and stores the secret key **AES-256-GCM encrypted** with `MASTER_KEY` from `.env`. Losing `MASTER_KEY` = losing all player keys: back it up privately.
- **Gas:** the game account signs everything. Burns must come from the player, so the server signs a meta transaction (NEP-366) with the player key and the game account relays it and pays gas.
- **Chain job queue:** actions update SQLite instantly and queue the NEAR transaction; one worker sends them in order, retries network errors and reverts the local balance if a token job fails for good.
- **Login (done, tested manually by Ardian 2026-11-07):**
  - **Google:** Google Identity Services button (forced English) -> ID token -> `POST /auth/google`, checked with jose (RS256, issuer accounts.google.com, aud = Client ID, not expired, `email_verified` required). Identity = Google `sub`; 1 Google account = 1 garden. Only the public Client ID is needed (no secret). Sessions are Bearer tokens (stored hashed, 30 days; survive refresh; logout deletes them).
  - **NEAR wallet (non-custodial):** `@hot-labs/near-connect` 0.12.0 on testnet (`web/src/wallet.ts`). No manual wallet list: near-connect shows only wallets whose manifest supports testnet. **HOT Wallet does not support testnet**; Ardian tests with **Meteor Wallet** (`nearvestwallet.testnet`, `ardianwallet65.testnet`). Login = NEP-413 signed message "Sign in to NEARvest", recipient `nearvest.testnet`, one-time 32-byte nonce from `POST /auth/near/challenge` (5 minutes, single use), ed25519 check, and the key must be a FullAccess key of the account (RPC `view_access_key`). Shared check: `verifyWalletProof` in `server/src/wallet.ts`. A wallet garden uses the player's own account (`players.custody = 'wallet'`, no key stored).
  - **Connect NEAR Wallet** (Village tab, Google gardens): same proof -> `POST /api/wallet/link`; `players.wallet_account_id` is unique (1 wallet = 1 garden); the linked wallet can then sign in to that Google garden.
  - **Shop for wallet gardens:** the first purchase asks "Set up Shop": near-connect asks the wallet to add a limited game key (function call key, only `burn` on `panen.nearvest.testnet`, 0.01 NEAR allowance) whose secret stays in the browser (`localStorage nearvest.gamekey.<account>`). **This one AddKey step is paid by the player's wallet (tiny testnet fee); say so in the README.** After that the browser signs each burn as a NEP-366 delegate action (`POST /api/wallet/burn` gives the exact burn, `signedBurn` goes with `POST /api/shop/buy`), the game relays it and pays gas; no more wallet popups. Wallet balances are re-synced from the chain (`ft_balance_of`) at most every 30 s.
  - `POST /auth/dev` exists only when `DEV_LOGIN=true` and the server is local-only (never on a public server).
  - **.env names:** server `GOOGLE_CLIENT_ID` (set in `server/.env`), `DEV_LOGIN`, `WEB_ORIGINS`; web only `VITE_API_URL` (the web reads the Client ID from the server's `/api/config`). Google Cloud Console "Authorized JavaScript origins" must list every web origin (`http://localhost:5173`, `http://localhost` and the Vercel site `https://nearvest-six.vercel.app`; set by Ardian 2026-11-08, app In production). Open the dev web at `http://localhost:5173`, not `127.0.0.1` (Google rejects IP origins).
  - **Tests:** `server/test/google.test.ts` (fake Google key set: valid, wrong aud, expired, unverified email, wrong issuer, forged, same garden on second login, logout, dev login switch) and `server/test/wallet.test.ts` (valid proof, reused/expired/unknown nonce, key not owned, wallet linked elsewhere, signed burn accepted/refused, missing game key). Login page in the browser: `node tools/ui-test.mjs <outDir> --login-only 390 844` and `... 1280 800` (screenshots login + wallet picker, creates no account).
- **HTTPS (agreed 2026-11-05, not installed yet):** Caddy on the VPS with a free `150-109-24-35.sslip.io` hostname and automatic Let's Encrypt certificates, proxying to the server on 127.0.0.1:8787. Fallback: Cloudflare Tunnel.
- **Draft game numbers (not in the GDD; approved by Ardian 2026-11-05 as starting values, tune in testing; all in `server/src/rules.ts`):** grow days to first fruit mango 1 / rambutan 2 / durian 4; regrow 0.5 / 1 / 2 days; harvests before old 3 / 4 / 5; XP per harvest 10 / 25 / 60; titles at 0 / 50 / 200 / 600 / 1500 / 4000 XP; plot 3 unlocks at 50 XP (Farmhand); watering lasts 1 game day and is allowed once per tree per day (free for now by Ardian's choice; weather water comes with the Important features); fertilizer +50% speed for 1 day; Mr. Darto price swing ±30% minus up to 15% when many fruits were sold yesterday, bounded by [seed price, base +30%]; day-7 check-in bonus seed = Gold Mango; old tree drops 1 superior seed then becomes a Memorial Tree.

## Gameplay additions (Ardian, 2026-11-05)

- **Seed storage is a hard limit (20).** Check-in only adds seeds while there is room (Gold seed first) and reports the rest as `skipped`; the web asks before a check-in with full storage. Mr. Darto buys seeds (`POST /api/seeds/sell`, 40% of the shop price, Rare x2 / Gold x5 when known, paid with `mint_reward` so the Season rule applies) and seeds can be discarded (`POST /api/seeds/discard`). Never stuck: an old tree with full storage keeps its seed (409 `storage_full`) until the player picks `then: 'plant'` (plant it right there, lineage kept) or `then: 'sell'`.
- **Fertilizer:** 1.5x speed for 1 day (badge + countdown + green glow) and better fruit on the next harvest: Common tree 75/20/5 (Common/Rare/Gold), Rare tree 80/20 (Rare/Gold). Draft numbers (`FERT_STEP1/2` in `rules.ts`). Without fertilizer fruit = tree quality.
- **Demo mode XP x5** (`DEMO_XP_MULTIPLIER`); normal mode unchanged.
- **Sell picker:** - / + / slider / Max with a live total, for fruit and seeds; the price lock (`expectedPrice`, 409 `price_changed`) still applies. Totals on the sell buttons are what the player really receives after the Season rule (`state.season` from the server, e.g. Rare Mango 16 -> 8 in Season 2), with a small note "Season 2: harvest rewards 50%".
- **Audio:** music and sound effects switch separately (`nearvest.music`, `nearvest.sfx` in localStorage).
- **Immersive game mode (laptop/PC, >= 1024px, Ardian 2026-11-05):** the garden fills the whole window at a whole-number pixel scale k (`immersiveLayout` in `web/src/scene.tsx`: cover the window if that crops <= 20% of the width, else fit and fill the rest with a blurred copy of the backdrop). The laptop backdrop is the HD 480x270 image (`bg-*-hd.png`) at k/2 px per pixel (1280x800 -> 3x, 1920x1080 -> 4x); trees, plots and TaniBot keep their 240-grid size (k = 6 / 8), so proportions match the phone. Menus are HUD panels in semi-transparent wood frames: top bar (player, title/XP, PANEN, music/sound, small browser-fullscreen button), right drawer (check-in + Storage/Shop/Market/Village, scrolls inside, open/closed remembered in `nearvest.drawer`; closed = icon rail), bottom action bar (selected plot + Water/Fertilize/Harvest). Toasts sit top-left. No page scroll.
- **Phones (Android and iPhone):** normal mobile layout, no fullscreen button (hidden below 1024px, on iPhone/iPad and on touch phones).
- **Share to X** (`web/src/share.tsx`): canvas cards (first harvest, first Gold tree, TaniBot evolved, 7-day streak, new title, Legend, profile) shown once per moment, with Save image / Share image (phones) / Post on X (`x.com/intent/tweet`, text with @NEARProtocol #NEARHackathon). Demo mode has test buttons in the Village tab.
- Trees stand in the middle of their bed (the soil's front lip covers the trunk base); status labels stay where they were.
- Market and Shop scenes have ChatGPT backdrops (`web/src/art/scenes.tsx`) with a light veil and shadows so the characters stay readable. On phones, Mr. Darto's face says "Thanks!" next to the sell list when the scene is scrolled away.
- Tests: `cd server && npm test` (storage, seeds, never-stuck, fertilizer, titles, demo XP in `test/storage.test.ts`); `cd web && npm test` (quantity picker, `web/test/qty.test.ts`).

## Web game (2026-11-05)

- **Stack:** Vite 8 + Preact 10 (10.29.8; Preact 11 skipped because the Vite plugin was not updated for it yet) + TypeScript. Static build (`npm run build` -> `web/dist`), deploys to Vercel as-is.
- Dev: `cd web && npm run dev` -> http://localhost:5173, talks to `VITE_API_URL` (default `http://127.0.0.1:8787`).
- Mobile first (390 px), English UI, fonts Tiny5 (text, clear digits) + Pixelify Sans (headings). Colors from the GDD as CSS variables in `web/src/styles.css`.
- Art: original pixel art drawn in code (`web/src/sprites.tsx` icons, `web/src/art/` trees, TaniBot, Mr. Darto, backdrop) plus CC0 palms in `web/public/assets/cc0/` (see `docs/ASSETS.md`). Dev-only gallery: http://localhost:5173/preview.html (not in the production build).
- Visual polish (2026-11-05): TaniBot stands next to the selected plot (v1 rusty + bamboo hat for Seedling/Farmhand, v2 chrome + LED hat + 2 drones from Farmer) with idle hover, blinking eyes, LED and screen animations, and action animations (plasma hoe, watering drone, harvest laser + fruit to basket, nano spray, laser saw + light motes). Garden backdrop = Ardian's ChatGPT village images (day + night, `web/public/assets/bg/`, 240x135) cross-faded from the village clock (dawn/dusk mix both with a warm tint), with light overlays in `web/src/art/backdrop.tsx` (passing drones, LEDs, lanterns, holograms, waterfalls, volcano smoke); ground = bottom 28% of the image, plots sit on it between 11% and 89% of the width. Juice in `web/src/fx.tsx` (floating numbers, coins to balance, burn flame, leaves, level-up confetti). Bamboo/wood panels with mint neon. Mr. Darto = Ardian's ChatGPT design (`web/src/art/darto-sprite.ts`, 3 poses: idle default, wave when the Market opens, hold when selling: he lifts the fruit that was sold, his original durian or a code-drawn mango/rambutan in the same hand; sparkle animation; hover cart with flickering thrusters). Shop tab has the ChatGPT stall (`web/src/art/shop-sprite.ts`) with a floating, blinking guard robot; seed packets show mango/rambutan/durian. Regenerate both with `tools/pixelize/sheet.py` + `make-market-shop.py` (commands at the top of that script).
- Laptops draw the garden at a whole-number scale k for the window (trees at k px, TaniBot at round(k/2)); phones fit the backdrop to ~104% of the width (whole village visible), trees at 2 px.
- **TaniBot official design (2026-11-05):** Ardian's ChatGPT image (`docs/art-source/tanibot-ai.png`) converted to a 58x64 sprite (`web/src/art/tanibot-sprite.ts`). Use this design (Seedling) for the tutorial too.
- **TaniBot evolutions (2026-11-07):** one look per title (Seedling = original; Farmhand, Farmer, Orchard Master, Durian King, Legend from Ardian's ChatGPT images), `web/src/art/tanibot-evolutions.ts` generated by `tools/pixelize/evolve.py` (registered on the original's eyes; body only). `TaniBot tier=...`: `sd` 58x64 at scale 1 (phones), `hd` 116x128 from scale 2 (laptops). Layers (eyes, hat LEDs, glow, can, leaves, capes) are split by color and position in `layersOf`; tier effects and real quadcopter drones are CSS. Plan and details: docs/BACKLOG.md.
- Fonts: Pixelify Sans only for the logo and h1 (its 2 and 5 look like 8 and S); everything with digits uses Tiny5.
- Screens: login (Google button slot + dev login), create garden (name -> `<name>.nearvest.testnet`, demo toggle), Garden (3 plots, check-in calendar), Storage, Shop, Market (Mr. Darto), Village (stats + on-chain log). A mint-green flash and toast with a tx link appear whenever a chain job lands.
- Tab names (Ardian, 2026-11-05): "Storage" (not "Barn": sounds like "burn") and "Market" (Mr. Darto lives inside it).
- Layout: phone = bottom tabs; `>= 1024px` = immersive game mode (see Gameplay additions).
- Selling sends the price the player saw (`expectedPrice`); if the day changed, the server answers 409 `price_changed` and the game asks before selling at the new price.
- Seeds of the same kind are stacked ("Mango seed x7"); unknown quality is shown as "Revealed when planted".
- Audio (`web/src/audio.ts`): CC0 chiptune music loop + sound effects, starts only after the first tap/click, mute button remembered in localStorage. All files listed in `docs/ASSETS.md`.
- Demo mode streak grace: a streak survives up to 10 missed demo days (minutes); normal mode still resets after one missed day.
- Browser test: the Claude in Chrome extension was not connected, so a headless Chrome (temporary profile) is driven over the DevTools protocol to play the full loop and take screenshots.

## Hard rules (never break)

1. **Never commit keys or secrets.** Secrets go in `.env` (git-ignored). Keep `.env.example` with variable names only, no values. Check `git diff --cached` for secrets before every commit.
2. **Never without Ardian's explicit permission in the current conversation:**
   - `git push` / force-push
   - making the repository public
   - deploying anything to mainnet or signing any mainnet transaction
   - sending the hackathon submission (print the full JSON payload first and wait for "yes"; only one submission ever)
   - posting on X or any social network
3. Testnet deploys and testnet transactions from `nearvest.testnet` are OK, but say what you are about to do first.
4. Do not install global tools or new dependencies without saying what and why.

## How to talk to Ardian

- Ardian is **not a programmer**. Explain everything in **simple Bahasa Indonesia**: short sentences, no jargon (or explain jargon in one line), say what was done, what it means, and what Ardian needs to do next.
- **All code, code comments, README, commit messages, and in-game text are in English.**
- When a choice is needed, give one recommendation with a short reason, not a long list.

## Planned structure

- `contracts/` — NEAR smart contracts (Rust, near-sdk-rs): $PANEN (NEP-141), Tree NFT (NEP-171, dynamic), Farmer Card (SBT, check NEP-393), Garden & Market (plots, granary, P2P market, TaniBot spending limits).
- `server/` — game server on the VPS: Google login, player database (water, inventory, friends, XP), village clock (day changes at 07:00 WIB), relayer, TaniBot scheduler (3x/day), NEAR AI Cloud calls with rule-based fallback.
- `web/` — pixel-art web game (English UI, mobile first), deployed to Vercel.
- `docs/` — GDD and hackathon rules.

## Key numbers from the GDD (draft values, tuned during testing)

- Plots: start 2, 3rd unlocks by level, plots 4-9 bought with $PANEN at 50, 100, 200, ... (max 9 = 3x3). Plots 7-9 and Gold seeds are high-level only.
- Seeds: Mango (fast, low risk, always profitable), Rambutan (medium), Durian (slow, high risk/pests, big, Gold chance).
- Seed price 5 / 15 / 40. Sell to Mr. Darto: Mango 10, Rambutan 25, Durian 60. Quality multiplier Rare x2, Gold x5.
- Fertilizer 8, pesticide 10, tool upgrade 100 / 300 (wood -> iron -> gold).
- Check-in: 5 $PANEN (day 7 streak: 2x) + always 1 free mango seed. 7-day reward calendar, day 7 = Gold seed.
- Welcome pack: 1 Rare Durian seed + 50 $PANEN. First harvest ~3 minutes.
- Initial quality odds: Common 80%, Rare 17%, Gold 3% (Gold parent raises Gold to ~10%).
- Mr. Darto prices move ~30%/day, never below the seed price; price bounds enforced by contract.
- $PANEN: 0% team, no pre-mint. Seasons halve harvest rewards at supply thresholds, floor 1/8 of initial. 1% of Mr. Darto sales -> Village Granary. Weekly Harvest Festival goal (e.g. 1,000 harvests) distributes the Granary + 1 day free rain. Shop spend burned 100%, P2P market 2% burned.
- High-level perks: harvest bonus +2% per title (max +10%), shop discount 5-10%.
- Titles (all English, Ardian 2026-11-05; the GDD's Pak Tani / Juragan / Durian Sultan were renamed): Seedling, Farmhand, Farmer, Orchard Master, Durian King, Legend (TaniBot v1 -> v4 visuals).
- Watering: rain = free water, drought = water twice; 2 days without water = plant goes back one stage. Seed storage ~20 slots.
- Demo mode: 1 day = 1 minute. "Try as Judge" opens a pre-filled sample garden.
- Anti-cheat: 1 Google account = 1 garden; never block by IP; welcome/referral bonus limited per IP/device (e.g. max 3/day); referral pays after the friend's first harvest.
- Colors: leaf #2E7D4F, soil #6B4A2F, NEAR mint #00EC97, tech cyan #22D3EE, gold #F5C542, purple #8B5CF6.

## Feature priority (from the GDD)

If time runs short, cut from the bottom (Bonus first, then Important). All **Must** features must ship.

- **Must (Wajib):** Google login (fallback: NEAR wallet login), 3 plots, plant-water-harvest loop, $PANEN with Seasons and Shop burn, dynamic Tree NFT, TaniBot + budget + spending limit + Log, Mr. Darto, check-in, tutorial, Try as Judge, demo mode, Village Stats.
- **Important (Penting):** P2P Market + TaniBot trading, weather and wilting, seed quality and lineage, Village Granary and Harvest Festival, titles, TaniBot v2, Farmer Card SBT, share to X (moments, profile, referral), buy plots, Memorial Trees, browser notifications.
- **Bonus:** pests, friends and garden visits, agent-to-agent negotiation, TaniBot evolutions per title (done 2026-11-07, see docs/BACKLOG.md), badges, family tree view, leaderboard, extra fruit types.

## New schedule (replaces the dates below) (Ardian, 2026-11-07; work may be done earlier when there is time)

- **Mon 9 - Tue 10 Nov:** first deploy (VPS + Vercel, only with Ardian's OK) and tests on phones. MUST checkpoint.
- **Wed 11 Nov:** atmosphere package: weather + wilting, living trees, living sky, dusk backdrop, ambient sound.
- **Thu 12 Nov:** interactive backdrop (hotspots to Shop / Market / Village, a train passes about every 2 minutes); simple garden visits (farmer list -> view their garden -> help water 1 tree per day, both get a little XP; template stickers / messages, no free chat); share popup per moment; referral.
- **Fri 13 Nov morning:** simple Arena (not real-time): challenge another player's garden; best-fruit contest in 3 rounds with a TaniBot duel animation; NO wagering of players' tokens; the winner gets a small PANEN prize from the game via `mint_reward` (follows the Season rule), a few duels per day; result + tx link in the log. If the schedule slips, Arena goes back to "coming soon".
- **Fri 13 Nov afternoon:** feature freeze. **Fri evening:** README + demo video. **Sat 14 Nov:** submit.
- Moved forward and **done Sat 7 Nov**: living trees (`art/trees.tsx`: 3 shapes per species from the NFT id, sway, falling leaves), living sky + dusk backdrop (`art/sky.tsx`, `bg-dusk*.png`), login evolution journey, `?time=day|dusk|night` (dev builds), share card layout (`share.tsx`). Still to do Wed: weather + wilting, ambient sound.

## 9-day work plan (from the GDD, "Rencana kerja 9 hari")

- **Checkpoint:** all Must features done by **Tue 10 Nov**. If not reached, cut Important features first.
- **Feature freeze:** Thu 12 Nov evening.
- **Submit:** Sat 14 Nov evening. Sun 15 Nov 06:59 WIB (= 14 Nov 23:59 UTC) is the last-resort backup deadline.

**Thu 5 Nov (afternoon-evening): preparation**
- [x] Create testnet account nearvest.testnet and fund it from the faucet
- [ ] Claim NEAR AI Cloud credits via NEAR Builders, create an API key
- [x] Create the GitHub repo nearvest (private for now), store the GDD in docs/
- [x] Find CC0 pixel-art assets (garden, fruit, robot) and record their licenses (`docs/ASSETS.md`)
- [x] Test Google login (done 2026-11-07, plus NEAR wallet login)

**Fri 6 Nov: core contracts**
- [x] $PANEN contract (NEP-141): mint when earned, burn when spent, Seasons
- [x] Tree NFT contract (NEP-171) with updatable data
- [x] Deploy to testnet and test (done early, Thu 5 Nov)

**Sat 7 Nov: game server on the VPS**
- [x] Database, village clock (07:00 WIB), gas-paying relayer (on the Mac; VPS move still to do)
- [x] Actions: plant, water, fertilize, harvest, sell, check-in (plus Shop burn, welcome pack, demo mode, Village Stats endpoint)
- [x] Simple Mr. Darto (daily price with upper and lower bounds)
- [x] Google OAuth Client ID (Ardian) and test real Google login (2026-11-07)
- [ ] Move the server to the VPS with HTTPS (ask Ardian first)

**Sun 8 Nov: web UI**
- [x] Pixel-art garden with 3 plots, mobile friendly, login (dev login; Google button ready for the Client ID)
- [x] Plant, water, harvest, sell and Shop loop working
- [ ] Deploy to Vercel

**Mon 9 Nov: TaniBot**
- [ ] TaniBot sub-account and function call key
- [ ] Budget and spending limit in the contract
- [ ] NEAR AI Cloud brain, 3x/day schedule, simple-rules fallback, Log with transaction links

**Tue 10 Nov: finish Must features (checkpoint)**
- [ ] Tutorial, Try as Judge, demo mode
- [ ] Check-in and streak, Village Stats
- [ ] Re-test the whole loop from a new account

**Wed 11 Nov: Important features part 1**
- [ ] Weather and wilting, seed quality and lineage
- [ ] Village Granary and Harvest Festival
- [ ] Titles and Farmer Card (SBT)

**Thu 12 Nov: Important features part 2 (feature freeze tonight)**
- [ ] P2P Market and TaniBot trading
- [ ] TaniBot v2, buy plots, Memorial Trees
- [ ] Share to X, browser notifications

**Fri 13 Nov: test and polish**
- [ ] Full testing, bug fixes, mobile UI polish
- [ ] README (do X, see Y), MIT LICENSE, list of assets and libraries
- [ ] Record the demo video

**Sat 14 Nov: release and submit**
- [ ] Repo public, Vercel demo live (only with Ardian's explicit OK)
- [ ] X post with video, tag @NEARProtocol and #NEARHackathon (Ardian posts it)
- [ ] Re-check everything, then submit the form (once only, with Ardian's explicit OK)

## Mainnet plan (write in README only, do not build)

- $PANEN stays 0% team; development funded by a small share of Market fees and cosmetic sales (TaniBot skins, decorations) in NEAR.
- $PANEN/NEAR pair on a NEAR DEX such as Rhea.
- Get legal advice before any mainnet token launch.

## Status and next steps (2026-11-08)

**Done (all tested; pushed to the private repo):**
- **Login:** Google (jose check, 1 Google account = 1 garden) and NEAR wallet (near-connect on testnet, NEP-413 proof); linking both ways: "Connect NEAR Wallet" for Google gardens, "Link Google account" for wallet gardens. Details in Game server -> Login.
- **Profile** (avatar/name top left): account, sign-in methods, NEAR wallet, Google link, Farmer Card placeholder, Sign out; 8 pixel avatars + 6 TaniBot head avatars unlocked by title (server checks, 403 `avatar_locked`).
- **$PANEN contract with TaniBot budgets** deployed 2026-11-07 (bot_set / bot_accept / bot_withdraw / bot_info, contract-enforced daily limit, bots cannot transfer); sandbox upgrade test; rollback steps and wasm backup: see Deployed contracts.
- **TaniBot:** own NEAR account (`bot.<player>` or `<name>-bot`) with one function call key; budget + daily limit on chain; rules brain; quick reactions in demo; Log with tx links; ON/OFF, styles Thrifty / Balanced / Turbo; status chip, bubbles ("Not now"), goodbye bubble.
- **TaniBot AI brain** on NEAR AI Cloud (`Qwen/Qwen3-VL-30B-A3B-Instruct`), every suggestion checked by the game rules, fallback to rules, safety net; usage meter (`ai_usage` table, server log) with daily call limit and dollar brake. **`TANIBOT_AI=off` by default** (turn on only for tests / the deployed demo). Used so far: 4 calls, about US$0.0004.
- **TaniBot 6 tiers** (Seedling .. Legend) from Ardian's ChatGPT images with per-tier animations, real quadcopter drones, evolution moment and share card (docs/BACKLOG.md).
- **UI:** new HUD (status group top left with PANEN / Check-in / Day chips, quiet system capsule top right, rail = navigation only, chamfered shape tokens, 8px grid); Market one row per fruit; seed cards; fullscreen fix (half-step backdrop scale); check-in window from the chip.

- **TaniBot wallet test B (Meteor) passed** (Ardian, 2026-11-07): activate (set_bot), add budget, take back. Success indicators for TaniBot actions: button "Waiting for wallet..." / "Confirming on NEAR...", green toast with check mark + tx link, counting budget; "Cancelled in wallet. Nothing changed." (`web/src/tanibot.tsx`, `web/src/outcome.ts`).
- **Demo recording mode:** `?record=1` hides the share card on title/evolution moments (`web/src/record.ts`); dev aid `tools/dev-xp.mjs <devGarden> <xp>`.
- **Try as Judge (MUST) done 2026-11-07** (`server/src/judge.ts`, `web/src/judge.tsx`): one click on the login page -> a NEW garden `judge-xxxx.nearvest.testnet` per device (device id in localStorage; same device returns). Filled by the server: ripe Rare Durian, nearly ripe Gold Rambutan, Mango sprout (3 real Tree NFTs), Gold/Rare seeds, 100 PANEN, Farmhand XP, demo mode, TaniBot ON (limit 50, budget 30) that waits for the judge's first harvest (max 3 min). Judge tour chip + window: harvest, sell, Shop burn, TaniBot Log, Village Stats with nearblocks proofs. Cost about 0.04 testnet NEAR per garden; limits 3 per IP per day and 50 per day (then the newest judge garden is shared). Tested on real testnet (`judge-hh50`, all jobs done). Tests: `server/test/judge.test.ts`; browser: `node tools/ui-test.mjs <outDir> --judge [w] [h]` (creates a real judge garden on the normal server; use a fake-chain server to avoid that).

- **Tutorial + How to play done 2026-11-07** (`web/src/tutorial.tsx`, `web/src/help.tsx`): new gardens get a TaniBot-guided tutorial (plant, water, buy fertilizer = burn, fertilize, check in, harvest, sell, then meet TaniBot), progress in `players.tutorial_step`, steps finish when their goal is reached (any order), Skip any time; existing and judge gardens skip it. How to play = 4 pages with Back/Next/Skip. Judge gardens hold share cards until the tour is 5/5; Village share previews fold into "Preview share cards". TaniBot avatars show the full robot per title with a still aura (Durian King, Legend).

- **Layered village backdrop done 2026-11-07 (night):** three villages without sky (day / dusk / night, `web/public/assets/bg/village-*`), the sky in code behind them (`art/sky.tsx`, `art/sky-colors.ts`: pixel bands, sun, moon, clouds, birds 5x3 px, stars, meteor, UFO), monorail train in 3 cars (locomotive, middle, rear; about 40% of the rail) that follow the curve with whole-pixel stair-step tilts (`art/train.tsx`, `art/train-sprite.ts`), turning rotors (the first code-drawn village animals were removed: too small to read; a new version with ChatGPT sprites is a Friday polish item in docs/BACKLOG.md), hotspots with always-visible place pins (`art/hotspots.tsx`: Shop = the stall, Market = the small house in the middle, Village Stats = the farm tower, Friends and Arena = Soon). `?time=day|dusk|night|<hour>` in dev builds; `window.__trainT = <s>` freezes the train (dev).
- **TaniBot auto-plant done:** "Auto-plant: Off / Common seeds only" in the TaniBot window (off for existing gardens, on for judge gardens); only Common / unknown seeds, never Rare, Gold or superior seeds; Thrifty never buys, Balanced / Turbo may buy a Mango seed (burn, within the contract limit); AI "plant" action checked by the rules. A Tree NFT stores about 490 bytes (about 0.005 testnet NEAR from `pohon.nearvest.testnet`; on 2026-11-07 only about 0.37 NEAR of its 3.50 NEAR was free = about 75 more trees: **top up pohon before deploy**).
- **Village v3 = default (2026-11-08; local commits, not pushed yet)** (`art/village.ts` `V3_WEB` / `V3_PHONE`; dev builds compare with `?bg=v1` / `?bg=v2`): ChatGPT day, dusk and night images (day -> dusk -> night cross-fade; dusk added 2026-11-08), converted with `pixelize.py --hq` (laptop 480x270, phone 480x720); phone night lined up with `tools/pixelize/warp.py`, sky outlines matched with `samesky.py` (commands in docs/ASSETS.md). ChatGPT soil mounds (`mound.png`, tree behind the front lip), "1 VS 1" billboard on the Arena gazebo, soft hologram glow, sloped ChatGPT train on laptops (`SlopeTrain`, off on phones: rail too short), Ardian's ChatGPT robot (`art/robot-sprite.ts`) stays at the Friends house day and night (hover, blink, glowing orb). Phones: the village fills the screen width (k = width / 120, trees keep whole pixels), less sky, TaniBot 1.5x, plot sheet at most 20%, empty plot = small seed buttons (icon + count) in one row.
- **Deploy prep (BACKLOG #9, 2026-11-08; local commit):** login footer + How to play page 1 say "Google or a NEAR wallet"; Dev login left out of production builds; `/privacy` and `/terms` pages (contact ardianreffaramadhan65@gmail.com; put their Vercel URLs on the Google OAuth consent screen); `.env.example` files are names only (empty value = the server's safe default). Phones: the tutorial coach floats over the scene's sky (mounds stay in view), tree labels sit just above the tree and never above the grass line.
- **Landing page (2026-11-08, local):** `/` = landing (`web/index.html`, `src/landing.tsx`, `src/landing.css`), `/play` = sign-in + game (`web/play.html`), `/privacy`, `/terms`. Signed-in players and old links with game options (`?record`, `?time`, `?bg`, `?judge`) go to `/play`; `/play?judge=1` makes a judge garden right away. Tab titles "NEARvest - ...", TaniBot-head favicon, X preview (`og-image.png`, summary_large_image). Fonts (Ardian 2026-11-08): Bungee titles and logo, DotGothic16 reading text, Tiny5 buttons / labels / numbers, all self-hosted; no sans-serif anywhere. One type scale (13/16/20/26/42/68), stepped pixel corners on every box. ui-test's UI_URL now points at /play.
- **Phone garden = one fixed screen (2026-11-08, local):** on phones the Garden tab never scrolls or bounces (`.shell.phone-fit`, `html.page-locked`, 100dvh); the code sky reaches the top edge behind the floating HUD, the village sits right above the plot sheet and its bottom bushes continue (mirrored strips) under the sheet and the tabs (`layout.ts phoneFill`, `Backdrop groundBelow`). TaniBot stands in front of the mounds (labels above the mounds, its ON/OFF chip under its feet). Seed row: cards fit their count, pixel scrollbar + one-time "Swipe for more" hint (laptops keep the arrows). Storage: "+ SEEDS (6)" / "− SEEDS (6)" sections showing 2 rows + "... 4 more" (remembered in `nearvest.storageOpen`). Village log: up to 50 transactions with time and short hash. Phones held sideways see a "turn your phone upright" screen (`rotate.tsx`, CSS media query: landscape, height <= 520 px and width < 1024 px or a touch screen). Browser check: `--phonefit=<newDevUser>` in tools/ui-test.mjs (FAKE_DB adds seeds, fruit, items).
- **Open notes:** the Shop stall is partly covered by the tree on plot 1 (the pin moves to a free spot, so it stays clickable); the Market house is often behind the plot 2 tree (same: use its pin).

**Next, in this order:**
1. **Deployed 2026-11-08** (docs/DEPLOY.md): game server on the VPS (`https://150-109-24-35.sslip.io`, systemd `nearvest` + `nearvest-caddy`, own Node in /opt/nearvest, daily backup 03:30), web on Vercel `https://nearvest-six.vercel.app`. The Mac server must NOT run any more (same game key). Updates: stage a release on the Mac (`deploy/stage.sh`), switch `/opt/nearvest/app`, restart only `nearvest` (ask Ardian). Remaining from the old plan: At deploy: raise `TANIBOT_AI_MAX_CALLS_PER_DAY` from 30 (development) to **1500**, keep `TANIBOT_AI_BUDGET_USD=8`; add the Vercel URL to Google's Authorized JavaScript origins and to `WEB_ORIGINS`; top up `nearvest.testnet`, `game.nearvest.testnet`, `pohon` and `panen` from the faucet (Try as Judge spends about 0.04 NEAR per judge garden).
2. Wednesday: Weather / Village events + volcano eruption (docs/BACKLOG.md item 3; never call them seasons), ambient sound. Then Thursday: simple garden visits, share popup per moment, referral (the interactive backdrop is done).

**How-tos:**
- **AI image:** keep the original in `docs/art-source/`, convert with `python3 -I tools/pixelize/pixelize.py <image.png> <rows> <out_dir>` (`--keep-bg [--colors N]` for backgrounds); TaniBot looks with `tools/pixelize/evolve.py`; record it in `docs/ASSETS.md` as AI-generated at Ardian's request.
- **Browser tests** (`tools/ui-test.mjs`, headless Chrome): `--login-only`, `--profile=<devUser>`, and on a fake-chain server (`CHAIN_MODE=fake PORT=8788 ... ` + `vite --port 5174` with `VITE_API_URL`, then `UI_URL=http://localhost:5174`): `--layout`, `--tanibot`, `--motion`, `--market`, `--fullscreen`, `--tiers`. The full loop (`<name>`) creates real testnet accounts.
- Server and web are not deployed yet.

## Open questions to verify while building

- SBT standard (NEP-393) and wallet support.
- How the relayer pays gas for new players. (Answered: the factory on `nearvest.testnet` pays 0.003 NEAR per player; only ~0.68 NEAR is free there on 2026-11-07, top up before deploy.)
- NEAR AI Cloud credit claim and model choice.
- Name "NEARvest" does not clash with another submission.
