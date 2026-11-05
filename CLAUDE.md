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

- **Login:** Google login to our own game server. On first login the server creates the player's sub-account `<name>.nearvest.testnet` and pays the gas. The player's account key is generated and held by the server and **must be stored encrypted** (key from an env variable, never in the repo or plain text in the database). The README must say honestly that this is a custodial testnet design. Fallback login: NEAR wallet via `@hot-labs/near-connect` (do not use MyNearWallet, deprecated 2026-10-31).
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
- **Login:** Google Identity Services button on the web -> ID token -> `POST /auth/google` (verified against Google's keys; only the Client ID is needed, no secret). `POST /auth/dev` exists only when `DEV_LOGIN=true` (never on a public server). Sessions are Bearer tokens (stored hashed).
- **HTTPS (agreed 2026-11-05, not installed yet):** Caddy on the VPS with a free `150-109-24-35.sslip.io` hostname and automatic Let's Encrypt certificates, proxying to the server on 127.0.0.1:8787. Fallback: Cloudflare Tunnel.
- **Draft game numbers (not in the GDD; approved by Ardian 2026-11-05 as starting values, tune in testing; all in `server/src/rules.ts`):** grow days to first fruit mango 1 / rambutan 2 / durian 4; regrow 0.5 / 1 / 2 days; harvests before old 3 / 4 / 5; XP per harvest 10 / 25 / 60; titles at 0 / 50 / 200 / 600 / 1500 / 4000 XP; plot 3 unlocks at 50 XP (Farmhand); watering lasts 1 game day and is allowed once per tree per day (free for now by Ardian's choice; weather water comes with the Important features); fertilizer +50% speed for 1 day; Mr. Darto price swing ±30% minus up to 15% when many fruits were sold yesterday, bounded by [seed price, base +30%]; day-7 check-in bonus seed = Gold Mango; old tree drops 1 superior seed then becomes a Memorial Tree.

## Web game (2026-11-05)

- **Stack:** Vite 8 + Preact 10 (10.29.8; Preact 11 skipped because the Vite plugin was not updated for it yet) + TypeScript. Static build (`npm run build` -> `web/dist`), deploys to Vercel as-is.
- Dev: `cd web && npm run dev` -> http://localhost:5173, talks to `VITE_API_URL` (default `http://127.0.0.1:8787`).
- Mobile first (390 px), English UI, fonts Tiny5 (text, clear digits) + Pixelify Sans (headings). Colors from the GDD as CSS variables in `web/src/styles.css`.
- Art: original sprites in `web/src/sprites.tsx` plus CC0 files in `web/public/assets/cc0/` (see `docs/ASSETS.md`).
- Screens: login (Google button slot + dev login), create garden (name -> `<name>.nearvest.testnet`, demo toggle), Garden (3 plots, check-in calendar), Storage, Shop, Market (Mr. Darto), Village (stats + on-chain log). A mint-green flash and toast with a tx link appear whenever a chain job lands.
- Tab names (Ardian, 2026-11-05): "Storage" (not "Barn": sounds like "burn") and "Market" (Mr. Darto lives inside it).
- Layout: phone = bottom tabs; `>= 1024px` = garden large on the left (pixel art at an integer 2x zoom), check-in + Storage/Shop/Market/Village panels on the right.
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
- Titles: Seedling, Farmhand, Pak Tani, Juragan, Durian Sultan, Legend (TaniBot v1 -> v4 visuals).
- Watering: rain = free water, drought = water twice; 2 days without water = plant goes back one stage. Seed storage ~20 slots.
- Demo mode: 1 day = 1 minute. "Try as Judge" opens a pre-filled sample garden.
- Anti-cheat: 1 Google account = 1 garden; never block by IP; welcome/referral bonus limited per IP/device (e.g. max 3/day); referral pays after the friend's first harvest.
- Colors: leaf #2E7D4F, soil #6B4A2F, NEAR mint #00EC97, tech cyan #22D3EE, gold #F5C542, purple #8B5CF6.

## Feature priority (from the GDD)

If time runs short, cut from the bottom (Bonus first, then Important). All **Must** features must ship.

- **Must (Wajib):** Google login (fallback: NEAR wallet login), 3 plots, plant-water-harvest loop, $PANEN with Seasons and Shop burn, dynamic Tree NFT, TaniBot + budget + spending limit + Log, Mr. Darto, check-in, tutorial, Try as Judge, demo mode, Village Stats.
- **Important (Penting):** P2P Market + TaniBot trading, weather and wilting, seed quality and lineage, Village Granary and Harvest Festival, titles, TaniBot v2, Farmer Card SBT, share to X (moments, profile, referral), buy plots, Memorial Trees, browser notifications.
- **Bonus:** pests, friends and garden visits, agent-to-agent negotiation, TaniBot v3 and v4, badges, family tree view, leaderboard, extra fruit types.

## 9-day work plan (from the GDD, "Rencana kerja 9 hari")

- **Checkpoint:** all Must features done by **Tue 10 Nov**. If not reached, cut Important features first.
- **Feature freeze:** Thu 12 Nov evening.
- **Submit:** Sat 14 Nov evening. Sun 15 Nov 06:59 WIB (= 14 Nov 23:59 UTC) is the last-resort backup deadline.

**Thu 5 Nov (afternoon-evening): preparation**
- [x] Create testnet account nearvest.testnet and fund it from the faucet
- [ ] Claim NEAR AI Cloud credits via NEAR Builders, create an API key
- [x] Create the GitHub repo nearvest (private for now), store the GDD in docs/
- [x] Find CC0 pixel-art assets (garden, fruit, robot) and record their licenses (`docs/ASSETS.md`)
- [ ] Test Google login on NEAR; if too complicated, use wallet login (decided: Google login to our server, see Decisions; still to be tested)

**Fri 6 Nov: core contracts**
- [x] $PANEN contract (NEP-141): mint when earned, burn when spent, Seasons
- [x] Tree NFT contract (NEP-171) with updatable data
- [x] Deploy to testnet and test (done early, Thu 5 Nov)

**Sat 7 Nov: game server on the VPS**
- [x] Database, village clock (07:00 WIB), gas-paying relayer (on the Mac; VPS move still to do)
- [x] Actions: plant, water, fertilize, harvest, sell, check-in (plus Shop burn, welcome pack, demo mode, Village Stats endpoint)
- [x] Simple Mr. Darto (daily price with upper and lower bounds)
- [ ] Google OAuth Client ID (Ardian) and test real Google login
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

## Open questions to verify while building

- SBT standard (NEP-393) and wallet support.
- How the relayer pays gas for new players.
- NEAR AI Cloud credit claim and model choice.
- Name "NEARvest" does not clash with another submission.
