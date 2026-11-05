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

## 9-day plan (DRAFT — not in the GDD; proposed by Claude, confirm with Ardian)

| Day | Date (2026) | Goal |
|---|---|---|
| 1 | Fri 6 Nov | Tooling check, Google login decision, $PANEN contract (NEP-141 + Seasons + burn) on testnet |
| 2 | Sat 7 Nov | Tree NFT (dynamic NEP-171) + Garden contract (plots, plant/water/harvest, TaniBot spending limit) |
| 3 | Sun 8 Nov | Server: login, sub-account creation, relayer, database, village clock, demo mode |
| 4 | Mon 9 Nov | Web: pixel garden UI, core loop, Shop, check-in |
| 5 | Tue 10 Nov | Mr. Darto + TaniBot (NEAR AI Cloud + rule fallback, budget, Log with tx links) |
| 6 | Wed 11 Nov | Tutorial, Try as Judge, Village Stats, full end-to-end test — **all Must features done** |
| 7 | Thu 12 Nov | Important features (weather/wilting, quality/lineage, Granary/Festival, P2P Market, SBT) |
| 8 | Fri 13 Nov | Remaining Important features, Vercel deploy, README, bug fixing |
| 9 | Sat 14 Nov | Feature freeze, demo video + X post (Ardian), repo public + submit (with Ardian's OK) |

## Open questions to verify while building

- Replace the draft 9-day plan above with the "Rencana kerja 9 hari" section once the updated GDD is in `docs/`.
- SBT standard (NEP-393) and wallet support.
- How the relayer pays gas for new players.
- NEAR AI Cloud credit claim and model choice.
- Name "NEARvest" does not clash with another submission.
