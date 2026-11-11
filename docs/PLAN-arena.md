# Plan: Arena 1 VS 1 (simple, not real-time)

Status: PLAN (2026-11-11), waiting for Ardian's OK. No code yet.
Schedule: Arena is built **today, Wed 11 Nov**; Thu 12 Nov = buffer + feature freeze (this replaces
the "Fri 13 Nov morning" Arena line in CLAUDE.md / docs/BACKLOG.md). If it slips, the pin stays "Soon".

Decisions already made (Ardian):
- Not real-time. A player challenges another player's garden, from "Farmers of Tandur" or from a
  "Duel" button while visiting a friend's garden.
- Best-fruit contest in 3 rounds, shown as a duel of the two TaniBots (each in the look of its
  owner's title).
- **No wagering of players' tokens.** The winner gets a small PANEN prize from the game with
  `mint_reward` (Season rule). Only a few duels per day.
- Result + tx link in the log. The challenged garden gets a notice and a Village red dot.
- Judge gardens can take part, so a judge can try it within 2 minutes.

Ground rules (same as the social package): no contract change, no free text, no private data
(only name, avatar, title, trees), design-system tokens only, safe with an old server / old web,
database change = new table only (rollback-safe).

---

## 1. Who wins a round

**Recommendation: compare the living trees on the plots (the Tree NFTs), not fruit in Storage.**
- Trees are public already (the visit view shows them, the NFTs are on chain), so a duel shows
  nothing private. Storage fruit is private (never shown to visitors) and it is gone once sold, so
  "best fruit in Storage" would punish players who sell and reward hoarding.
- "Best fruit" = what the garden's trees grow: their quality, how well they are kept, how ripe.
- The server reads the trees **at the moment of the duel** (same `advance()` as everywhere), so the
  web cannot send fake numbers. Memorial Trees and empty plots do not count.

Three rounds, each with a small **garden score 0-3** plus **one die (1-6)** per side; higher total
wins the round; a tie rolls both dice again (server side, max 5 times, then the challenged garden
wins the round). Best of 3 wins the duel (always 3 rounds shown, so the animation has a full story).

| Round | Name in the game | Score 0-3 | Why it is fair |
|---|---|---|---|
| 1 | **Fruit quality** | best living tree's quality: Common 1, Rare 2, Gold 3 | rewards good seeds / lineage, but the gap is small |
| 2 | **Care** | share of living trees that are not thirsty, not wilting and free of volcanic ash: all = 3, at least 2/3 = 2, at least 1/3 = 1, else 0 | a brand-new player can get 3 just by watering; no purchase needed (fertilizer does not count, so nobody must burn to win) |
| 3 | **Ripeness** | most grown tree: seed / sprout 1, tree or old 2, fruiting / ready 3 | a Mango reaches 3 in 1 game day (1 minute in demo) |

Species and title do **not** add points (a Durian King is not stronger than a Seedling; the title
only sets the TaniBot look). With a 0-3 score and a d6, a garden 2 points behind still wins a round
about 1 time in 5, and Care / Ripeness are easy for new players, so a new player can beat a veteran.
The dice come from `crypto.randomInt` on the server and are stored with the duel; the result is
saved before the answer is sent, so a refresh cannot re-roll.

No trees:
- **You** need at least 1 living tree to challenge (button off with "Plant a tree first").
- **Opponents** without a living tree are not offered (the list already holds only gardens with a
  tree; the visit panel hides "Duel"). If the last tree disappears between list and tap: 409
  `no_trees`, the duel is not counted.
- One side with fewer trees is fine: only its best tree counts in rounds 1 and 3; Care uses the
  trees it has.

## 2. Numbers (draft, in `server/src/rules.ts`)

| Rule | Value | Reason |
|---|---|---|
| Challenges per garden per day | **3** (`ARENA_DUELS_PER_DAY`) | "a few"; enough for a judge to try twice |
| Day | the normal 07:00 WIB village day, also for demo gardens (like help water) | a 1-minute demo day cannot farm |
| Prize for a challenger's win | **8 PANEN base, `mint_reward`** (`ARENA_PRIZE`) | Season 3 now (/4) = **2 PANEN**, Season 4 = 1; smaller than one Common Mango sale (10 base) |
| Paid wins per day | max **3** per garden (follows from 3 challenges) and max **3 per IP** per day (`ARENA_PAID_PER_IP_PER_DAY`) | stops many gardens on one network farming |
| Defender | never gets PANEN; wins give **+3 XP**, max 3 per day | being challenged cannot be farmed for tokens |
| Challenger XP | win +5 XP, loss +1 XP (demo x5 as usual) | small, the prize is the reward |
| Same opponent | **1 challenge from A to B per day**; B may still challenge A once that day ("Rematch") | no farming one weak garden; a rematch is fun |
| Loss | costs nothing | no wagering |

Worst case per day: 3 x 8 base = 24 base = 6 PANEN in Season 3 per garden.

## 3. Anti-cheat

- **Your own garden:** 400 `own_garden`.
- **Your second garden** (same browser or same Google / wallet identity; reuse `devices` +
  `sameIdentity` from `referral.ts`): the duel still plays but is a **"Practice duel"**: no PANEN,
  no XP, still counts toward the 3 per day. Shown as "Practice: no prize (same device)".
- **IP / device:** max 3 paid wins per IP per day and per device per day (counted from the stored
  duels); more wins are practice duels. Never blocks playing or logging in.
- **No trees:** see section 1.
- **The web sends only the opponent's name** (+ device id). Scores, dice, winner and prize are all
  decided and stored on the server.
- **Judge gardens:** can challenge (prize paid, so the judge sees a real `mint_reward` tx) and can be
  challenged; they are limited anyway (3 per IP / 50 per day). Practice rule still applies.
- **Note for local tests:** every garden comes from 127.0.0.1, so the 4th paid win of a day on a
  test server is a practice duel (IP limit).

## 4. Screens (tokens only: `--font-title/body/ui`, `--fs-*`, the 24 colours)

**Arena window** (Arena pin, which loses "Soon"; also a Village tab "Arena" box):
- Head: "ARENA" (`--font-title`, `--fs-h2`), "Duels left today 2/3", "Win: +2 PANEN (Season 3)"
  (`--gold-500` chip on `--hud`).
- Opponent list = the Farmers of Tandur rows (avatar, name, title, trees) with a **Duel** button
  (`--mint-500`); search box like Farmers. Judge gardens fill the list as in Farmers, so a judge
  always has opponents.
- "Recent duels": yours and challenges you received (last 10): "budi 2-1 you · today", prize +
  tx link (nearblocks), **Rematch** / **Visit**.
- Phone 390x844: full-height window, only the list scrolls (same fix as Farmers on iPhone).
  Laptop 1280x800: HUD panel in the right drawer style, 560 px wide.

**Visit panel:** a **Duel** button next to Sticker (same height, one row; phones: name row, then
3 equal buttons "← My garden / Sticker / Duel"). Disabled with a reason ("2 left" / "Dueled today" /
"No duels left").

**Duel screen** (full screen overlay on phones, centred 960x600 panel on laptops):
- Backdrop: the village scene dimmed (`--ink` 60%), the Arena gazebo area.
- Left: your TaniBot (tier from your title), right: theirs, mirrored (sd on phones, hd on laptops).
  Names + titles under them (`--font-ui`, `--fs-sm`).
- Each round (~2 s): round name banner ("ROUND 1 · FRUIT QUALITY", `--font-title`, `--fs-h3`), each
  side's tree icon + score pips, two dice rolling then stopping, the winner's TaniBot fires a beam
  (`--mint-500` / theirs `--cyan-500`), the loser shakes; scoreboard "1 - 0" (`--fs-h1`).
- Result (~1 s after round 3): "YOU WIN!" (`--gold-500`) or "THEY WIN" (`--red-500` text on
  paper), "+2 PANEN · on NEAR soon" then the tx link when the job lands, "+5 XP"; buttons
  **Share** (wins only), **Back to Arena**. **Skip** jumps to the result at any time.
- Reduced motion: no movement; each round appears as a still card, 1 s apart.
- Sounds: existing CC0 effects (`levelup`, `coins`, hit / laser effects already in `audio.ts`).

**Share card** (canvas, like `share.tsx`, colours via `token()`): "I won in the Tandur Arena!", the
two TaniBots, "2 - 1", both garden names, round icons; post text "I beat <name> 2-1 in the Tandur
Arena on @NEARProtocol #NEARHackathon". New moment `arena_win`: the popup once (first win only);
later wins have the Share button on the result screen.

**Defender:** on their next visit a notice "budi challenged you in the Arena: you won 2-1 (+3 XP)"
/ "you lost 1-2", the duel in "Recent duels" with **Rematch**, and the **Village red dot** (the
duel time joins `villageNews.latestAt`).

## 5. Server / web / contract / compatibility

**Contract:** no change. `mint_reward` already exists and the game account is the minter.

**Database:** one new table (old releases ignore it, rollback needs no restore):
`arena_duels (id, challenger_id, defender_id, duel_day, rounds TEXT /* JSON: scores + dice */,
challenger_wins INTEGER, practice INTEGER, prize_micro INTEGER, job_id INTEGER, xp_c INTEGER,
xp_d INTEGER, ip TEXT, device_id TEXT, created_at INTEGER)` + indexes on `(challenger_id,
duel_day)` and `(defender_id, created_at)`.

**Server:**
- `rules.ts`: ARENA_DUELS_PER_DAY 3, ARENA_PRIZE 8, ARENA_PAID_PER_IP_PER_DAY 3, ARENA_XP_WIN 5,
  ARENA_XP_LOSS 1, ARENA_XP_DEFEND 3, ARENA_DEFEND_XP_PER_DAY 3, plus the pure score functions
  `arenaScores(trees, now, sky)` and `playRound(a, b, rng)` (testable without a database).
- New `server/src/arena.ts` (`Arena` class like `Social`): `view(viewer)`, `duel(viewer, name, ip,
  device)`; prize through `Game.earnReward` (memo "Arena prize vs <name>"), XP through the normal XP
  path.
- `app.ts`: `GET /api/arena` (left today, prize now, opponents, recent), `POST /api/arena/duel
  { opponent, deviceId }` -> `{ duel }` (both public garden headers, rounds, winner, prize, jobId).
  Errors: 400 `own_garden`, 404 `unknown_garden`, 409 `no_trees` / `no_tree_you`, 429 `arena_limit`
  / `arena_pair_today`.
- `state()` adds `arena: { left, max, prizeNow, received: [...] }`; `villageNews` includes received
  duels; `activity()` marks the prize job `note: 'arena'` ("Arena prize" in the Village log).
- TaniBot never duels by itself (keeps its rules and budget story simple).

**Web:**
- New `web/src/arena.tsx` (Arena window, duel screen, result), `web/src/arena-play.ts` (pure:
  timeline of a duel, button states, texts; unit-tested), `art/hotspots.tsx` (Arena pin live),
  `friends.tsx` (Duel button in the visit panel), Village tab "Arena" box + notices in `app.tsx`,
  `share.tsx` / `moments.ts` (`arena_win` card), `text.ts` (strings).
- **Old server:** no `state.arena` -> the Arena pin keeps "Soon", no Duel button, no Arena box.
  **Old web on the new server:** nothing changes (the new field is ignored).

## 6. Tests and time

**Server** (`server/test/arena.test.ts`, fake chain): score functions (quality / care / ripeness,
memorials ignored, old tree = 2); fixed rng -> known winner, tie re-roll; 3 per day then 429;
same pair once a day, rematch allowed once; own garden 400; no trees 409 (both sides); same device
/ same identity -> practice, no mint job; 4th paid win from one IP -> practice; prize = `mint_reward`
job with 8 base and the Season divisor; defender XP cap; judge garden can duel and gets a prize;
the duel answer holds no private data (no balance, seeds, fruit, email, wallet, IP); the defender's
`news.latestAt` moves; the duel survives a re-request (no re-roll).

**Web unit** (`web/test/arena.test.ts`): duel timeline (3 rounds, skip, reduced motion), button
states (left / dueled today / no tree), result texts with Season prize.

**Browser** (`tools/ui-test.mjs --arena=<user>:<opponent>`, fake-chain server 8788 + vite 5174,
FAKE_DB): open from the pin, list, duel, animation frames, result, Skip, Share card, visit-panel
Duel button, defender's notice + Village dot; at **390x844** and **1280x800** (plus 390x664 for
iPhone Safari's visible area). Old-server check: pin says "Soon".

**Time estimate**

| Part | Time |
|---|---|
| Server: rules, table, arena.ts, endpoints, state / news / log | 3 h |
| Server tests | 1.5 h |
| Web: Arena window, Duel button, Village box, notices | 2 h |
| Web: duel animation + result | 2.5 h |
| Share card + moment | 1 h |
| ui-test mode, screenshots at 2-3 sizes, fixes | 1.5 h |
| Docs (CLAUDE.md, README notes) | 0.5 h |
| **Total** | **about 12 h** (more than half a day) |

**Recommended smaller version for today (about 6 h): "Arena v1"**
- Keep: all server rules (3 rounds, dice, limits, anti-cheat, prize, defender notice + Village dot)
  and their tests; Arena window with opponent list + Recent duels; Duel button in the visit panel.
- Simpler duel screen: the two TaniBots (existing sprites, still) facing each other, the 3 round
  cards appear one by one (1.2 s each, CSS only: banner, score pips, dice numbers, winner glow),
  then the result. Skip button.
- Share: a Share button on the result that reuses the existing card layout with the "2 - 1" text
  (no new moment popup).
- Moved to Thursday (only if time allows before freeze): rolling dice + beam / shake animation,
  `arena_win` moment popup, search in the Arena list (the Farmers search already finds people),
  Village "Arena" box (Recent duels stay in the Arena window).

Build order: server rules + tests -> `GET/POST` endpoints -> Arena window + visit button -> duel
screen -> notices / dot -> ui-test at 390x844 and 1280x800 -> local commit. Release to the VPS and
push only after Ardian's OK (normal steps in docs/DEPLOY.md, Entropy untouched).
