# Plan: Arena 1 VS 1 (simple, not real-time)

Status: **Arena v1 live 2026-11-11 (`nearvest-e8312ea`). Arena v2 lite live 2026-11-11 (`nearvest-edfb355`; section 7.7). v3 part 1 = Add friend + Online dot BUILT 2026-11-11 (local, not released; section 7.11). The online duel (v3 part 2) is NOT built.** v1 was built 2026-11-11. Server `server/src/arena.ts`
(table `arena_duels`, `GET /api/arena`, `GET /api/arena/can/:name`, `POST /api/arena/duel`, `state.arena`, Village news,
log note 'arena'), tests `server/test/arena.test.ts` (13); web `web/src/arena.tsx` + `arena-play.ts` (Arena window from
the pin, duel screen, Village "Arena" box, Duel button in the visit panel, notice for received duels), tests
`web/test/arena.test.ts`; browser `--arena=<me>:<foe>` in `tools/ui-test.mjs` at 390x844 and 1280x800. Not in v1:
search in the Arena list, Rematch in the Village box, rolling dice / laser / moment popup (Thursday).
Was: **Arena v1 approved by Ardian 2026-11-11 ("OK v1") with 3 changes**: paid wins per IP
per day 10 (not 3; per device and per garden stay 3), the duel screen keeps TaniBot's living idle
animation (hover, blink, per-title effects; it will be in the demo video), and the odds for a new
player are written below (section 1.1) and checked by a server test. Rolling dice, laser and the
automatic share popup stay for Thursday.
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

## 0. Before release: Fruit Fight, winner XP, Duel button (Ardian 2026-11-11, built the same day)

**Fruit Fight (web only, no server change):** the duel screen plays the server's result like a
fighting game (`web/src/arena.tsx DuelScreen`, pure logic `web/src/arena-play.ts` `fightHits` /
`fightAt` / `fightTimes`, unit tests `web/test/arena.test.ts`).
- Above each TaniBot: garden name, title, life bar (mint above 50%, gold above 20%, red below).
- Each round its winner steps forward and throws its fruit in an arc at the other TaniBot. The fruit
  comes from the trees the server already sends in every duel: rounds 1 and 2 = the garden's best
  tree (`best`: species + quality), round 3 = its most grown tree (`ripest`). Mango small and fast
  (0.45 s), rambutan 0.6 s, durian big, slow (0.85 s), bounces once, heavy drum sound
  (`momentDurian`); Gold fruit = gold glow + trail (`momentGold` sound), Rare = purple glow + trail.
  Durian and Gold hit harder (more damage, bigger knock-back and shake).
- Hit: short white flash, small screen shake, knocked back and back, turning stars, the bar drops.
- **Always the server's result:** the duel's loser gets the winner's hits, split by fruit power so
  they add up to exactly 100 (K.O. on the last one); the winner gets at most one hit (it lost at
  most one round) of 20-60, so it always keeps at least 40. Unit test: every 2-1 and 3-0 order,
  both sides, both viewers, 5 fruit kinds each side (400 cases): loser 0, winner > 0.
- Last hit: big "K.O.!" (title font), the loser sleeps (TaniBot's OFF look + Zzz), the winner jumps
  + confetti, then the result. About 12 s (intro 1.2 s, 3 rounds of 2.7 s, K.O. 1.3 s, celebration
  1.4 s); Skip any time. Reduced motion: nothing flies or shakes, the bars jump each round (~6 s).
- A new title from the duel's XP is celebrated after the duel screen closes (not over it).
- Light on phones: the screen is drawn again only when something changes (phase, hit, bars); the
  motion is CSS (transform / opacity, short filters). Headless Chrome at 390x844 (x2 pixels): about
  58-60 fps during a real fight. Dev builds: `window.__duelT = <ms>` freezes the fight (screenshots).
- Sounds: CC0 files already in the game (`click`, `harvest`, `momentDurian`, `momentGold`,
  `momentEvolve`, `levelup`); no new files.

**Winner XP (server):** a challenger's win gives **15 XP** (demo x5 = 75), at most 3 wins with XP per
village day (`ARENA_XP_WIN`, `ARENA_XP_WINS_PER_DAY`; the same as the 3 challenges a day, so the
caps meet). A loss 1 XP, a defender's win 3 XP (max 3 a day), practice (one person's gardens) none.
The result shows the PANEN really received (after the Season rule, from the server) and the XP as
chips ("+2 PANEN", "+15 XP") and a small Season line from `state.season` ("Season 3: rewards are
25% now"; never written in).

**Duel button while visiting:** in the visit panel next to Sticker (phones: the middle of the three
buttons under the garden name; laptops: the bottom bar, between Sticker and "Back to my garden"),
with the Arena's sparkle icon. Shown only when the server has the Arena (`state.arena`) and the
garden is not your own. On = you can challenge it now; off with a reason: "Dueled" (check mark,
already challenged today), "No duels" (3 used), "Duel" greyed (you or they have no tree). The
first screenshots showed only the "Dueled" state (the duel had just happened), faded to 45%, so it
was easy to miss: now it keeps 80% and its icon, and ui-test also shows a visit with the button on.

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

### 1.1 Rough odds for a new player (Ardian 2026-11-11)

Exact odds of the rule above (2 dice per round, ties rolled again; the challenged garden wins a
round only after 5 ties in a row, which almost never happens). "Veteran" = a Gold tree, every
tree cared for, a ripe tree: scores 3 / 3 / 3.

| New player (Seedling, Common tree) | Scores | Wins the duel vs the veteran |
|---|---|---|
| Watered Mango with fruit (1 day of play, 1 minute in demo) | 1 / 3 / 3 | **about 34%** (1 in 3) |
| Welcome pack Rare Durian, watered, ripe | 2 / 3 / 3 | about 41% |
| Watered Mango still growing ("tree" stage) | 1 / 3 / 2 | about 26% |
| Watered Mango just planted (seed / sprout) | 1 / 3 / 1 | about 19% |
| Thirsty seed nobody looks after | 1 / 0 / 1 | about 6% |
| Two equal gardens | 3 / 3 / 3 each | 50% |

So a new player who simply waters a Mango until it fruits wins about **1 duel in 3** against the
strongest garden, and the round they can lose (Fruit quality) still gives them about 19%
(Common vs Gold). Care and Ripeness reward playing, not spending. Server test: "a new player has a
real chance" in `server/test/arena.test.ts` (exact odds 30-40% for 1 / 3 / 3 vs 3 / 3 / 3, plus a
seeded run of 20,000 duels through the real duel code).

## 2. Numbers (draft, in `server/src/rules.ts`)

| Rule | Value | Reason |
|---|---|---|
| Challenges per garden per day | **3** (`ARENA_DUELS_PER_DAY`) | "a few"; enough for a judge to try twice |
| Day | the normal 07:00 WIB village day, also for demo gardens (like help water) | a 1-minute demo day cannot farm |
| Prize for a challenger's win | **8 PANEN base, `mint_reward`** (`ARENA_PRIZE`) | Season 3 now (/4) = **2 PANEN**, Season 4 = 1; smaller than one Common Mango sale (10 base) |
| Paid wins per day | max **3** per garden (follows from 3 challenges), max **3 per device** (`ARENA_PAID_PER_DEVICE_PER_DAY`) and max **10 per IP** (`ARENA_PAID_PER_IP_PER_DAY`) per day | 10 per IP because many Indonesian mobile players share one IP (carrier NAT), and friends on one WiFi or judges in one office should all be able to win; the device limit stops one browser farming with many gardens |
| Defender | never gets PANEN; wins give **+3 XP**, max 3 per day | being challenged cannot be farmed for tokens |
| Challenger XP | win **+15 XP** (max 3 a day; Ardian 2026-11-11), loss +1 XP (demo x5 as usual) | a win should feel worth it; the cap equals the prize limit |
| Same opponent | **1 challenge from A to B per day**; B may still challenge A once that day ("Rematch") | no farming one weak garden; a rematch is fun |
| Loss | costs nothing | no wagering |

Worst case per day: 3 x 8 base = 24 base = 6 PANEN in Season 3 per garden.

## 3. Anti-cheat

- **Your own garden:** 400 `own_garden`.
- **Your second garden** (same browser or same Google / wallet identity; reuse `devices` +
  `sameIdentity` from `referral.ts`): the duel still plays but is a **"Practice duel"**: no PANEN,
  no XP, still counts toward the 3 per day. Shown as "Practice: no prize (same device)".
- **IP / device:** max 10 paid wins per IP per day and max 3 per device per day (counted from the
  stored duels); more wins are practice duels. Never blocks playing or logging in.
- **No trees:** see section 1.
- **The web sends only the opponent's name** (+ device id). Scores, dice, winner and prize are all
  decided and stored on the server.
- **Judge gardens:** can challenge (prize paid, so the judge sees a real `mint_reward` tx) and can be
  challenged; they are limited anyway (3 per IP / 50 per day). Practice rule still applies.
- **Note for local tests:** every garden comes from 127.0.0.1, so the 11th paid win of a day on a
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
- `rules.ts`: ARENA_DUELS_PER_DAY 3, ARENA_PRIZE 8, ARENA_PAID_PER_IP_PER_DAY 10, ARENA_PAID_PER_DEVICE_PER_DAY 3, ARENA_XP_WIN 5,
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
/ same identity -> practice, no mint job; 4th paid win from one device and 11th from one IP -> practice; prize = `mint_reward`
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
- Simpler duel screen: the two TaniBots facing each other with their **living idle animation**
  (hover, blinking eyes, LEDs, per-title effects: the same `TaniBot` component as the garden; not a
  frozen picture, Ardian 2026-11-11), the 3 round
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

---

## 7. v2 / v3: Rock Paper Scissors Fruit Fight (PLAN ONLY, Ardian 2026-11-11; no code yet)

**v2 = against the computer (the opponent's TaniBot), built first. v3 = against an online player +
Add friend, built only after v2 is stable; if v3 is not done before the feature freeze (Thu 12 Nov
evening) its online part and Add friend stay hidden** (the server sends no `live` / `friends` flags,
so the web shows nothing of them).

### 7.1 One duel engine on the server (both kinds)

A **match** is played turn by turn. Every turn each side picks **Rock / Paper / Scissors**, or fires
its **Gold Durian** when its skill bar is full. The server stores the picks, decides the turn, keeps
the life and skill bars, and ends the match. The web only sends "my pick for turn N" and plays the
animation of what the server decided.

| Rule | Value (draft, `rules.ts`) |
|---|---|
| Life | 100 each (`ARENA_HP`) |
| Turn | Rock beats Scissors, Scissors beat Paper, Paper beats Rock. Same pick = **both dodge**, no damage |
| Turn winner's throw | a random fruit: Mango 50% / Rambutan 35% / Durian 15%; quality Common 70% / Rare 22% / Gold 8% (`crypto.randomInt`, server only) |
| Damage | Mango 14, Rambutan 18, Durian 24; x1 Common, x1.3 Rare, x1.6 Gold (average about 19: a K.O. needs 5-6 hits) |
| Garden bonus | all hits x (1 + bonus), **bonus 0-20%** from the v1 garden score (fruit quality + care + ripeness, 0-9): `bonus = max(0, score - 3) / 6 x 20%`. Veteran 3/3/3 = +20%, new player with a watered fruiting Mango 1/3/3 = +13%, neglected seed = 0% |
| Skill bar | +1 per turn won, full at **3** (`ARENA_SKILL_MAX`). Full = the **Gold Durian** button lights up |
| Gold Durian | used **instead of** a pick: a sure hit of **40** (x garden bonus) that cannot be dodged; the bar empties. If both fire in the same turn, both hit. A side that fires does not get the Rock / Paper / Scissors result that turn |
| Length | max **15 turns**; no K.O. by then = most life wins; equal life = most hits landed; still equal = the challenged side (same as v1's tie rule) |
| TaniBot (computer side) | picks uniformly at random (it cannot be read or exploited); fires its Gold Durian on the first turn its bar is full |

**Secrecy:** the opponent's pick (the TaniBot's or the other player's) is locked in the database at
the start of the turn (TaniBot) or when it arrives (player), and is **never sent to the web before
both picks of that turn are in**. A test scans every answer for it. Picks are idempotent per turn
(a retry of the same turn returns the same result; a pick for an old turn = 409 `turn_over`), so a
refresh can never re-roll.

**Prize and limits (same as v1):** 8 PANEN base `mint_reward` (Season rule), 15 XP for a win
(`DEMO_XP_MULTIPLIER` as usual), loss 1 XP, 3 challenges per garden per day (v1 duels and v2/v3
matches counted **together**), 1 per opponent per day (rematch the other way allowed), max 3 paid
wins per garden / per device, 10 per IP; same person = practice (no prize, no XP); judge gardens
take part. A match **counts toward the day's 3 from the moment it starts**.

**Leaving a computer match:** the web polls the match while it is open. No poll for **2 minutes** =
the match ends as a **loss without prize** for the player (TaniBot wins; defender XP as in v1). A
sweep every 10 s in the existing worker loop (`main.ts`) closes such matches, so nobody has to come
back for it to finish. Closing the page and coming back within 2 minutes = the match continues where
it was (the turn has no clock against the computer).

**The challenged garden** gets the notice and the Village red dot as in v1 ("budi challenged your
TaniBot: your TaniBot won 72-0 (+3 XP)!"), through the fixed notice strip (section A fix: important
notices are never lost behind a window).

### 7.2 v3: online player + Add friend

**Online dot:** a garden is **Online** when its web sent a sign of life in the last 60 s. The web
calls `GET /api/ping` every **4 s while the page is visible** (not while the tab is hidden; on
coming back it calls at once). The server stores `players.active_at` (written at most every 20 s, so
pings cost almost no disk writes) and answers with any invite waiting for this player. `last_seen_at`
(updated only every 10 minutes) stays as it is.

**Challenge an online player:**
1. The challenger taps Duel on an online garden: `POST /api/arena/match { opponent, live: true }`.
   The server creates the match as `invite` for **30 s**. The challenger sees "Waiting for budi to
   accept... 30".
2. budi's next ping (at most 4 s later) returns the invite: a popup **"<NAME> CHALLENGES YOU!"** with
   **Accept / Decline** and the countdown. Accept = `POST /api/arena/match/:id/accept`.
3. Declined or no answer in 30 s: the same match goes on **against budi's TaniBot** (rules of 7.1;
   the challenger sees "budi is busy: you fight budi's TaniBot!"). Never stuck.
4. A player can be in only one match at a time; an invite to a busy player is answered at once with
   "budi is in a duel: fight budi's TaniBot?" (409 `busy`, the web offers the computer match).

**Turns online:** each turn has **10 s**; a side that has not picked by then gets a random pick
(server). During a live match both browsers poll `GET /api/arena/match/:id` about every **1 s**
(answer = one row, about 1 KB). The turn result is shown to both once both picks are in.

**Leaving / connection lost:** a side whose browser has not polled for **5 s** is "gone": the match
pauses (the turn clock stops) and the other side sees **"Waiting for <name>... 20"**.
- Back within 20 s: the match continues (the turn restarts its 10 s).
- Not back: the player who stayed **WINS** (same prize and XP as a normal win, counted in their
  daily caps); the one who left loses (loss XP only).
- Left **before the first turn was decided**: the match is **cancelled** (no prize, no XP, it does
  NOT count toward either player's 3 a day).
- Both gone for 20 s: the match ends without winner (counts for the challenger, nobody paid).
- The countdown and the decision are made by the server (on the next poll or by the 10 s sweep), so
  the player who stays is never left waiting.

**Who gets the prize online:** the **winner, whichever side** (both played live; budi accepted). The
match uses **1 of the challenger's 3 challenges**; accepting does **not** use one of budi's. A paid
win counts toward the **winner's** own caps (3 paid Arena wins per garden per day, all kinds
together; 3 per device; 10 per IP). When the winner's caps are full the win is shown as "Practice:
no prize today". The loser gets 1 XP. Same person on both sides = practice, as in v1. When the match
fell back to budi's TaniBot, it is a computer match: only the challenger can win the prize; budi
gets the v1 defender XP if the TaniBot wins.

**Add friend (one way, no accept needed):**
- "Add friend" in the visit panel and on each row of Farmers of Tandur; "Remove friend" to undo.
- Friends come first in Farmers of Tandur (section "FRIENDS (n)"), each with the Online dot, Visit
  and Duel.
- The added player gets the notice **"<name> added you as a friend"** with **Add back** (and the
  Village red dot; a "Friends" row in the Village Visitors box). Removing sends no notice.
- Limits (proposal): at most **50 friends** per garden (`FRIENDS_MAX`), at most **20 adds per day**
  (`FRIENDS_ADDS_PER_DAY`, so nobody can spam notices), one notice per pair ever (add / remove / add
  again does not notify twice). No chat, no free text.
- Judge gardens can add friends and be added (they are filled in Farmers already).

**Why polling and not WebSockets:** the VPS has about 1 GB free and Entropy must stay safe. Short
HTTP polls keep no open connections and no new process: one indexed SQLite read per poll. Estimate:
50 players online = about 13 pings/s, plus 2 polls/s per live match; Hono + node:sqlite handle that
in well under 1% CPU and with no extra memory (the server stays far below its 300 MB limit; now
64 MB). If it ever gets busy, the ping moves to 6 s and the match poll to 1.5 s (only the countdown
gets less smooth). Server-Sent Events would be smoother but hold one connection per player through
Caddy; not needed for this size.

### 7.3 Server changes

New tables only + one new column with DEFAULT (old releases name their columns, so they ignore them):
- `arena_matches (id, kind 'bot'|'live', status 'invite'|'playing'|'paused'|'done'|'cancelled',
  challenger_id, defender_id, duel_day, turn, hp_c, hp_d, skill_c, skill_d, bonus_c, bonus_d,
  pick_c, pick_d /* this turn's locked picks, NULL until chosen */, turn_ends_at, invite_ends_at,
  paused_side, pause_ends_at, seen_c, seen_d /* last poll of each side */, winner, end_reason
  'ko'|'turns'|'left'|'abandoned'|'cancelled', practice, prize_micro, job_id, xp_c, xp_d,
  log TEXT /* JSON per decided turn: picks, fruit, quality, damage, special */, ip, device_id,
  created_at, updated_at)` + indexes `(challenger_id, duel_day)`, `(defender_id, created_at)`,
  `(status)`.
- `friends (player_id, friend_id, created_at, notified INTEGER, PRIMARY KEY (player_id, friend_id))`
  + index `(friend_id, created_at)` (v3).
- `players.active_at INTEGER DEFAULT 0` (v3).

v1's `arena_duels` stays untouched: old 3-round duels keep showing; matches live in their own table,
so an old release never reads a JSON format it does not know.

Endpoints:
- v2: `POST /api/arena/match { opponent, deviceId }` -> the match (computer side); `GET
  /api/arena/match/:id` (poll: life, skill, turn, last decided turn, never the open pick);
  `POST /api/arena/match/:id/pick { turn, pick: 'rock'|'paper'|'scissors'|'gold' }`;
  `GET /api/arena` and `state.arena` gain `v: 2`, `active` (a running match to resume) and
  `matches` (recent matches, both roles). `POST /api/arena/duel` (v1) keeps working for old webs.
- v3: `GET /api/ping` -> `{ invite?: { id, from, title, avatar, endsAt } }`;
  `POST /api/arena/match { ..., live: true }`; `POST /api/arena/match/:id/accept|decline`;
  `POST /api/friends/:name`, `DELETE /api/friends/:name`; `GET /api/farmers` rows gain `friend`,
  `online`; `state.friendAdds` (who added you, with `mutual`), `state.arena.live: true`,
  `news.latestAt` includes friend adds.
- Sweep (every 10 s, inside the existing worker interval): ends matches whose time ran out.

**Old release `nearvest-e8312ea` on the new database: yes, it runs.** It ignores the new tables and
the new column (checked the same way as before: start the old release on a copy of the upgraded
database and load a garden). After a rollback, v2/v3 matches simply do not show and do not count
toward v1's daily limit that day; their prizes are normal `mint_reward` jobs the old worker sends.
No database restore needed.

**New web on the v1 server (`nearvest-e8312ea`): safe.** The web uses the turn-based duel only when
`state.arena.v >= 2`; otherwise it keeps the v1 Fruit Fight (the server decides 3 rounds). It pings
and shows Online / invites / Add friend only when the server sends `live` / `friends`. **Old web on
the new server:** v1 endpoints stay, new fields are ignored. Release order as always: server first,
then web.

### 7.4 Screens (tokens only)

**Duel screen, phone 390x844** (also fits 390x664 with no scroll):
- Top (as v1): names, titles, life bars; under each life bar a **skill bar** of 3 pixel segments
  (`--gold-500` fill on `--hud`, the Gold Durian icon at the end).
- Middle: the two TaniBots facing each other (v1). After both picks: the two pick icons pop over the
  bots for 0.6 s (16x16 pixel icons: rock, paper, scissors), then the v1 fruit throw / hit / knock-
  back, or a tie: both sidestep ("Dodge!"). Gold Durian = the big v1 durian throw with gold trail
  and the heavy drum.
- "Turn 4/15" (`--font-ui`, `--fs-sm`) and, online only, a 10 s bar (`--cyan-500`) shrinking.
- Bottom (thumb zone): **Rock / Paper / Scissors** = 3 equal buttons in one row, at least 56 px high
  (`--paper-light`, `--ink` outline, icon above the word, `--font-ui --fs-body`; the chosen one
  `--mint-500`, then "Waiting for budi..." under them). Above them one wide **Gold Durian** button:
  off = `--soil-300` with the bar's progress "2/3"; full = `--gold-500` with a soft pulse (still
  with reduced motion: steady glow). Skip only for replays.
- Result: v1 result panel (K.O.!, chips "+2 PANEN" / "+15 XP", Season line, Share, Back).

**Laptop 1280x800:** the v1 centred panel; the buttons sit under the stage (3 x 160 px + the Gold
Durian button on the right). Keys 1 / 2 / 3 and Space work as well.

**Challenge popup (v3)**, on top of any window (not over a running duel): a paper window 320 px wide
on phones / 400 px on laptops: "<NAME> CHALLENGES YOU!" (`--font-title --fs-h3`), their avatar +
title, the 30 s bar, **Accept** (`--mint-500`) / **Decline** (`--paper-light`). Short chime
(existing sound). A notice strip stays out of its way (fixed strip rules).

**"Waiting for <name>..." (v3):** the stage dims (`--ink` 60%), centre paper card with the name, a
big countdown "20" (`--font-ui --fs-h1`) and "If budi does not come back, you win." Nothing to tap
but "Leave" (= you lose; confirm first).

**Online dot (v3):** an 8 px square `--mint-500` with `--ink` outline on the avatar's corner plus
the word "Online" (`--fs-xs` on phones, `--fs-sm` on laptops) in Farmers of Tandur and the Arena
list. Online players are listed first after friends.

**Add friend (v3):** in the visit panel a small button next to the garden name (person + "+" pixel
icon, "Add friend" / check mark "Friend"; tap "Friend" -> "Remove budi from your friends?"); in
Farmers rows a small "Add" chip. Phones keep the name row + "← My garden / Sticker / Duel" row
unchanged. Village Visitors box: "budi added you as a friend · today" with **Add back** + **Visit**.

**Judge gardens:** the Arena window shows a duel against the first opponent's TaniBot at the top
("Quick duel"); 15 turns at about 3 s each = under 1 minute.

### 7.5 Tests

**Server (`server/test/arena-match.test.ts`, fake clock + seeded rng):** Rock/Paper/Scissors table;
damage table and garden bonus (never above 20%, new player > 0); tie = no damage; skill bar fills at
3 wins, Gold Durian = 40 x bonus, cannot be dodged, both firing = both hit, bar resets; 15 turns ->
most life, then most hits, then the challenged side; **the open pick never appears in any answer**
(deep key scan of every endpoint before both picked); pick idempotent, old turn 409; computer
match: 2 minutes without a poll = loss, no prize; back within 2 minutes = continues; limits shared
with v1 duels (3 a day, pair once a day, practice, device / IP caps); judge garden can play.
v3: invite 30 s -> TaniBot; decline -> TaniBot; busy -> 409; turn 10 s -> random pick; gone 5 s ->
paused; back within 20 s -> continues; 20 s -> the stayer wins with prize and caps; left before turn
1 decided -> cancelled and not counted for either; both gone -> no winner; online prize goes to the
winner of either side and counts in the winner's caps; friends add / remove / limits / one notice
per pair / no private data; ping writes `active_at` at most every 20 s.
**Database:** the upgraded database opened by the `nearvest-e8312ea` code (a git worktree of that
commit) still serves `/api/me` and `/api/arena`.

**Web unit (`web/test/arena-match.test.ts`):** button states (picking, waiting, Gold Durian off /
full), the turn animation timeline from a decided turn, countdown texts, `v` < 2 -> v1 duel.

**Browser (`tools/ui-test.mjs`, fake-chain server):** `--match=<me>:<foe>` (v2): full computer
match, Gold Durian, result, leave + come back, at 390x844, 390x664 and 1280x800. `--live=<a>:<b>`
(v3): **two browsers** (two Chrome pages, two dev users): b's popup within 5 s, Accept, both pick,
picks hidden until both, one side lets the 10 s run out, **b's page is closed in the middle** -> a
sees "Waiting for b... 20" -> b reopens within 20 s -> the match continues; second run b stays away
-> a wins + prize notice; b closes before turn 1 -> cancelled, a's "Duels left" unchanged; Decline ->
TaniBot match; Add friend -> b's notice + Add back; WebKit (iPhone profile) with the page hidden ->
"gone" after 5 s. `--oldserver`: the new web on `nearvest-e8312ea` shows the v1 duel and no Online /
Add friend.

### 7.6 Time

| v2 (computer match) | Time |
|---|---|
| Engine (pure rules) + table + endpoints + limits + 2-minute rule + sweep | 3 h |
| Server tests | 1.5 h |
| Web: picks, skill bar, Gold Durian, turn animation from the v1 Fruit Fight, resume, compat | 3 h |
| Browser checks at 3 sizes + fixes, docs | 1.5 h |
| **Total v2** | **about 9 h** |

| v3 (online + Add friend) | Time |
|---|---|
| Ping + Online + invite / accept / decline / fallback | 2.5 h |
| Live turns: 10 s clock, pause / resume / forfeit / cancel, prize rules | 2.5 h |
| Add friend (server + web + notice) | 2.5 h |
| Web: popup, waiting screen, online dots | 2 h |
| Server tests + two-browser test + fixes, docs | 2.5 h |
| **Total v3** | **about 12 h** |

**v2 is more than 5 h, so the recommended smaller v2 ("v2 lite", about 5 h):**
- Keep: the whole server engine and secrecy (Rock / Paper / Scissors, random fruit, life, garden
  bonus, skill bar + Gold Durian, 15 turns, 2-minute leave rule, shared limits, prize), its tests,
  the 3 buttons + Gold Durian button, the v1 Fruit Fight pieces reused per turn.
- Cut for later: keyboard keys, replay of matches (Recent shows the result line only), the judge
  "Quick duel" box (judges use the normal Duel button: it already takes under 1 minute), the pick
  icons popping over the bots (the winner's throw already shows who won), browser check at 390x664
  only by screenshot.
- Lite time: engine + endpoints 2 h, tests 1 h, web 1.5 h, browser check 0.5 h.

**v3 does not fit before the freeze with v2 lite tonight + Thursday buffer.** If there is time on
Thursday, build **Add friend first** (2.5 h, low risk, no clock), and the online duel only if it
can be finished and tested with two browsers before the evening; otherwise both stay hidden.

Build order: v2 lite server + tests -> web -> browser check -> local commit -> release after
Ardian's OK; then v3 (Add friend -> online) only after v2 has run on the VPS without problems.

### 7.7 Built: v2 lite (2026-11-11, local commit, NOT released; VPS untouched)

Ardian approved v2 lite with one change: **the pick icons above both TaniBots are NOT postponed**
(after both picks, each TaniBot shows its Rock / Paper / Scissors / Gold Durian, so the player sees
why a turn was won or lost). Postponed: keyboard keys, replay of matches, the judge "Quick duel" box.

**Server** (`server/src/arena-match.ts`, numbers in `rules.ts`):
- New table `arena_matches` only (db.ts; `kind` 'bot' now, 'live' later). v1's `arena_duels` and its
  JSON are untouched. The rules of 7.1 as pure functions (`resolveTurn`, `matchEnd`, `rollFruit`,
  `fruitDamage`, `goldDamage`, `gardenBonus`, `botPick`); the class `ArenaMatches` stores them.
- The computer's pick for the open turn is chosen when the turn opens and stored in `bot_pick`; it is
  in no answer (`matchView` never reads it). Picks are idempotent per turn (a retry of a decided turn
  returns the same match; a later turn = 409 `turn_wrong`; Gold Durian without a full bar = 400 `no_skill`).
- Endpoints: `POST /api/arena/match { opponent, deviceId }` (409 `match_open` + `matchId` while one is
  open), `GET /api/arena/match/:id` (also keeps it alive), `POST /api/arena/match/:id/pick { turn, pick }`
  (`state` only when the match is over). `GET /api/arena` adds `v: 2` + `matches`; `state.arena` adds
  `v: 2`, `active` and `receivedMatches` (summaries without the turn log, so the 8 s poll stays small).
  `POST /api/arena/duel` (v1) still works for old webs.
- Limits count v1 duels and v2 matches together (`ALL_FIGHTS` in arena.ts: 3 a day, 1 per opponent,
  paid wins per device / IP, XP caps); a match counts from its start. Leaving: no request for 2 minutes
  (`ARENA_LEAVE_MS`) = loss, no prize, no XP for the challenger (defender XP as v1); closed by the next
  request or the 10 s sweep in `main.ts`. Village news / red dot: a received match counts when it ends.
- Tests `server/test/arena-match.test.ts` (13): rules table, fruit / damage / bonus (0-20), skill bar +
  Gold Durian (both throw = both hit), K.O. / 15 turns / tie order, **the open pick is never in an
  answer** (the class answers and the HTTP answers of start / poll / pick are byte-identical whatever
  the locked pick is), the locked pick decides the turn, retries, shared limits with v1, leave rule,
  practice, defender view + news, privacy.

**Web** (`web/src/arena-match.tsx` screen + list row, pure logic `web/src/arena-turn.ts`, tests
`web/test/arena-turn.test.ts` (7)): the v1 Fruit Fight pieces are reused (`Fighter`, `FighterHud` with a
skill bar, `FlyingFruit`, sounds). Each turn: tap Rock / Paper / Scissors (your pick shows over your
head at once, theirs "?" while the server decides), then both picks pop up over the heads (0.7 s), the
winner's random fruit flies and hits (life drops on landing), a tie = both sidestep ("Dodge!"); the line
under the stage says "Rock beats Scissors." and the damage after the fruit landed. Skill bar: 3 pixel
segments under each life bar; full = the **Gold Durian** button lights up (gold, pulsing; still glow
with reduced motion) and the throw is a big gold durian (`GoldDurian` in sprites.tsx: the durian's
pixels in gold tokens). Last turn: K.O.! (or TIME UP! after 15 turns), loser asleep, winner jumps, then
the v1 result panel (+PANEN after the Season rule, +XP, tx, Share on X). Close = "Leave the duel?"
(Stay / Leave); the Arena window then shows "Your duel with X's TaniBot is waiting. Continue" and keeps
the Duel buttons off. Icons Rock / Paper / Scissors = 16x16 UI icons (tokens only). Notices +
Village Arena box for received matches. `window.__turnT` freezes a turn (dev).
**Old server (no `state.arena.v`):** the v1 duel as before (checked on `nearvest-e8312ea`).

**Checks done (fake chain on the Mac, never server/.env):** server 242 tests, web 123 tests, both type
checks, build. Browser `--match=<me>:<foe>` (new in tools/ui-test.mjs; FAKE_DB sets the locked pick so
the run is repeatable) at 390x844 and 1280x800: no page scroll, no sideways scroll, bubbles never over
the life bars, no console errors; leave + Continue; Recent duels row. **Old release on the new
database:** commit `e8312ea` started on a copy of the upgraded test database (with 4 matches): `/api/me`,
`/api/arena` and a v1 duel all 200, no errors in its log. **New web on `e8312ea`:** `--oldserver` (now
also plays a duel on a v1 Arena server) at both sizes: the v1 duel screen opens, no Rock / Paper /
Scissors buttons.

### 7.8 After Ardian's play test (2026-11-11, local commit, NOT released)

Ardian played v2 on the laptop (everything worked) and asked for five changes before the release.

1. **Paper icon** = an original pixel drawing in the style of a paper scroll (no copied image): an
   upright white sheet, the top-right corner slightly curled, the bottom rolled into a grey roll, four
   short blue writing lines of different lengths, a black outline and a soft grey shadow
   (`UI_ICONS.paper` in `web/src/sprites.tsx`). Rock and Scissors unchanged.
2. **Bug: the duel's TaniBots did not look like in the garden.** The tier body and effects were right
   (classes `tier-durian_king` etc.), but the duel left out the **drones** that belong to the look
   (1 from Farmer, 2 for the Legend), and the opponent's header showed "X's TaniBot" instead of its
   title. Fixed: one `BotDrones` component (`web/src/art/tanibot.tsx`) for the garden and the duel;
   the header shows "X's TaniBot" + the title. The pure tier helpers moved to `web/src/art/tiers.ts`
   (unit test: every title's look and drone count). ui-test logs both looks (`ME_XP` / `FOE_XP`).
3. **10 s per turn, decided on the server** (also the base for v3's online turns):
   - `arena_matches.turn_started_at` (new column; old local test databases get it by `migrate()`).
     Each turn: 10 s (`ARENA_TURN_MS`) + 1.5 s grace for slow networks (`ARENA_TURN_GRACE_MS`, never
     shown). The next turn's 10 s start after the web has played the last turn (3 s, plus 4.2 s per
     Gold Durian: `playbackMs`). The view sends `turnMs`, `turnStartsInMs`, `turnMsLeft`.
   - No pick in time = the player loses the turn (`pick.c = 'timeout'`): the TaniBot throws its fruit
     (or its Gold Durian when its bar is full) and its skill bar fills. Missed turns are decided on
     the next request or by the 10 s sweep in `main.ts`, one after another (a closed page catches up).
     A pick that arrives too late gets the match as it is (never a second roll).
   - **No turn limit**: a match ends only by K.O. It always ends: a player who does nothing is hit
     about every 13 s (10 + 1.5 + playback) and falls in at most about 8 missed turns (under 2 minutes).
     A safety net of 200 turns (most life wins) is never reached in practice.
   - **Closing the page**: the duel keeps running on the server. Coming back (Arena window: Continue)
     continues it with the turns missed meanwhile already lost. A loss where the last 3 turns were all
     missed counts as "left" (no XP, no prize; `ARENA_IDLE_TURNS`); the defender gets its XP as usual.
     The old "2 minutes without a request" rule is gone (the timer covers it).
   - Web: a countdown above the buttons (seconds + a shrinking bar, red and pulsing in the last 3 s);
     when the time is up the web asks the server for the decided turn; "Too slow" bubble (red "0s"),
     banner "TIME'S UP!", line "Time's up! No move in 10 s, so X's TaniBot wins the turn."
4. **The Gold Durian is a big moment** (~3.2 s, Skip in the header, the same for the TaniBot's):
   charge 0.9 s (dark screen, speed lines, "GOLD DURIAN!" slams in, the thrower glows and lifts, a
   growing gold aura, sparks, gold motes drawn in), meteor 1.1 s (a giant gold durian falls from the
   sky with a gold fire tail, slowing down just before it hits), impact 1.2 s (white-gold flash,
   ring-shaped shock wave, hard shake, gold shards, big damage number). Sound: made in code with Web
   Audio (`playGoldDurian`, no file; docs/ASSETS.md). Reduced motion: a short still version (no shake,
   flash or meteor). Headless Chrome at 390x844 (x2 pixels): 56 fps during it, slowest frame 33 ms.
   The pick bubbles hide during it (the title needs the room); the turn banner moved to a small chip
   between the bubbles.
5. Tests: server `test/arena-match.test.ts` (16: no turn limit, the 10 s + grace, a late pick, a missed
   turn incl. the TaniBot's Gold Durian, an idle player always K.O. as "left", coming back);
   web `test/arena-turn.test.ts` (countdown, missed turn, Gold Durian phases, tiers + drones).
   Browser `--match` (fake chain): clock 7 s / red 2 s, a real missed turn (decided ~12 s after the
   turn started), both Gold Durians in 4 frames each, K.O., result; `PERF=1` counts frames.
   `--oldserver` on `nearvest-e8312ea` (which also runs on the upgraded database): the v1 duel.

**Database for the release:** still only the new table `arena_matches` (now with `turn_started_at`);
`nearvest-e8312ea` ignores it, so a rollback needs no restore.

### 7.9 "Time’s up!" and the village behind the duel (Ardian 2026-11-11, local commit, NOT released)

- **One wording for a missed turn: "Time’s up!"** (typographic apostrophe) on the banner, the
  bubble's label and the line under the stage ("Time’s up! No move in 10 s, so X’s TaniBot wins the
  turn."); `TIMES_UP` in `web/src/arena-turn.ts`. Cause of "Times up": the banner used the title font
  in capitals, where the apostrophe is a 1-pixel tick (all three game fonts have both ' and ’,
  checked in Chrome). The small turn banner now uses the label font as written. No server, log or
  notice text names a missed turn.
- **The duel's background is the village around the Arena** (`web/src/art/duel-backdrop.tsx`): the
  garden's own `Backdrop` with village v3 (laptop image on laptops, phone image on phones), so the
  code sky (sun / moon, clouds, stars), smoke, waterfalls, lamps, train, weather and day / dusk /
  night follow the same village clock as the garden (`?time=` in dev builds too). It is cut out and
  enlarged on the Arena building with Gunung Tandur behind it; the scale comes from the stage size
  (`duelCut`) so the building and the mountain's peak always stay in view (phones: the Arena centred,
  about 1.5x; laptops: about 1.4x). The TaniBots stand on a front floor made of the image's own grass
  rows (laptop rows 106-121, phone rows 130-148), with a soft edge; a soft dark layer (--ink) behind
  the names and bars. Fighters, fruit, bubbles, the Gold Durian and K.O. are drawn above it. While a
  duel is open the garden's village behind it pauses (`html.duel-open`), so phones animate one
  village. Reduced motion: the duel's village stands still. Laptop stage 20 px taller and never
  shrunk (a squeezed stage cut the feet off). Headless Chrome 390x844: 57 fps during the Gold Durian.
- Checks: web tests 129, server 245, build; ui-test `--match` (new `FIRST_ONLY=1`; logs the cut, the
  floor and the feet) at 390x844 and 1280x800, by day / dusk / night; `--oldserver` on
  `nearvest-e8312ea`: the v1 duel. No server or database change in this step.

### 7.10 The Tandur Arena backdrop (Ardian 2026-11-11, web only, local commit, NOT released)

The village cut-out behind the duel (7.9) is replaced by Ardian's own ChatGPT arena pictures
(`docs/art-source/arena-*.png`; conversion and alignment in docs/ASSETS.md): a stone arena floor
with a glowing green ring, a bamboo gate with lanterns, banners and neon, the Arena building and
Gunung Tandur behind; one picture per light (day / dusk / night) for laptops (480x270) and phones
(480x720). `web/src/art/duel-backdrop.tsx`:
- Day / dusk / night cross-fade from the same village clock as the garden (`skyMix`; `?time=` in dev).
- `arenaFit`: the picture is scaled so the ring's middle row lies exactly on the TaniBots' feet line
  (measured from `.fight-floor`) and always covers the stage, centred; the TaniBots stand on the
  ring's left and right ends (measured: feet = ring row at 390x844 and 1280x800, day / dusk / night).
- Code animations on top (12, all CSS): smoke puffs drifting from the crater, lanterns flickering
  softly, the pillar neon pulsing, the ring pulsing slowly, the lava glowing at night (a hint at
  dusk). Reduced motion: 0 running (checked). The soft dark layer at the top stays for the names.
- The village weather no longer shows behind the duel (the pictures have their own sky).
- Checks: Gold Durian 59 fps in headless Chrome at 390x844; `--match` at both sizes day / dusk /
  night (ui-test logs `covers`, the ring row, the feet and the visible picture); `--oldserver` on
  `nearvest-e8312ea`: the v1 duel. No server or database change.


### 7.11 Built: Add friend + Online dot (v3 part 1; Ardian 2026-11-11, local, NOT released; VPS untouched)

Ardian's brief: Add friend and the Online dot now; **the online duel is NOT built** (sections 7.2 "Challenge
an online player", live turns, invites and the waiting screen stay plan only).

**Rules** (`server/src/rules.ts`): one-way friends, no accept. `FRIENDS_MAX` 50 friends per garden,
`FRIENDS_ADDS_PER_DAY` 20 adds per normal village day (a remove gives none back; adding a friend you
already have uses none), never yourself (400 `own_garden`), full = 409 `friends_full`, too many today =
429 `friend_adds_today`. Judge gardens can add and be added. The added garden gets **one notice per pair
ever** (add, remove, add again does not notify twice); a remove sends no notice and hides the old
"added you" row. Online = a ping in the last `ONLINE_MS` 60 s.

**Light sign of life (VPS ~1 GB free, Entropy safe):** the web sends `POST /api/ping` every **30 s**
(`PING_MS`, sent to the web as `state.friends.pingMs`) **only while the game tab is visible**; when the
tab is hidden or closed it sends `{ away: true }` once (fetch keepalive) and stops, so the dot goes out
at once. No WebSocket, no Server-Sent Events, no open connection. The server writes `players.active_at`
at most every 20 s (`ACTIVE_WRITE_MS`): one indexed UPDATE, no read of the game state. (Section 7.2's 4 s
ping was for the online duel's invites; 30 s is enough for a dot.)

**Server** (`server/src/social.ts`, `game.ts`, `app.ts`, `db.ts`):
- New tables only + one column with DEFAULT: `friends (player_id, friend_id, created_at)` (who added
  whom), `friend_adds (id, player_id, friend_id, add_day, notify, created_at)` (every add: the daily
  limit and the notice), `players.active_at INTEGER NOT NULL DEFAULT 0`.
- Endpoints: `POST /api/ping { away? }`, `POST /api/friends/:name` (add), `POST /api/friends/:name/remove`
  (POST, not DELETE: CORS allows GET / POST only). Both return `{ result, state }`.
- `GET /api/farmers`: rows gain `friend` and `online`; online farmers come first after "helped you" and
  real farmers; new `friends` (every friend, also without a tree or inactive; online first) and
  `myFriends` (count, max, adds left). `farmers` still holds friends (older webs know only that list).
- `GET /api/farmers/:name` (visit): `friend`, `online`, `myFriends`. `GET /api/arena`: friends first in
  `opponents`, each with `friend` / `online`.
- `state.friends` (count, max, addsLeft, addsPerDay, onlineMs, pingMs) = "this server knows Add
  friend"; `state.friendAdds` (last 10 "added you": from, avatar, title, at, `mutual`, `online`);
  `news.latestAt` includes the newest notifying add (Village red dot).
- Privacy: only name, avatar, title, trees, thirsty, online, friend (and `mutual` for your own notices).
  Never `active_at` itself, XP, balance, sign-in, wallet, IP.

**Web:** `web/src/friends.tsx` (Farmers of Tandur: "FRIENDS (n) / 50" on top with Visit + Duel and a
"Friends ✓" chip (tap = "Remove friend?"), "Other farmers" with a small Add; visit panel: Add friend /
"Friends ✓" in one row with Sticker, Duel and "← My garden" (phones: 4 equal buttons, measured 77x44 at
390 px, no text cut), "Remove friend?" window with Keep / Remove friend), `online.tsx` (8 px mint square
with ink outline on the avatar corner + "ONLINE" tag; also in the visit panel's "Visiting" line and the
Arena list), `presence.ts` (the ping), `friends-logic.ts` (pure rules), `invite.tsx` (Visitors row
"<name> added you as a friend · today" with Add back / Visit, "Friends ✓" when mutual), notice with
buttons (`Toast.actions` in `toast-queue.ts` / `toast.tsx`: "<name> added you as a friend" + Add back /
Visit; several at once = one line pointing to the Village tab), pixel icon `friendAdd` in `sprites.tsx`.
Tokens only. **Old servers** (no `state.friends`): no Add friend, no Online dots, no Friends section and
no ping (checked with `--oldserver` on `nearvest-edfb355`: 0 pings, 0 dots, no button, no errors).

**Rollback:** `nearvest-edfb355` ran on a copy of the upgraded database (fake chain): `/api/me`,
`/api/farmers`, a visit and `/api/arena` answer 200 for old gardens and new gardens can be made; it
ignores the new tables and column (`/api/ping` = 404, which the new web never calls there). No database
restore needed.

**Tests:** `server/test/friends.test.ts` (13: one way, repeat add, mutual, remove without notice, one
notice per pair, Village dot, never yourself / 404, 20 a day, 50 max, judge gardens, Online 60 s + away,
ping writes at most every 20 s, online first, HTTP + privacy incl. exact keys, ping needs a session);
`server/test/social.test.ts` key lists updated; `web/test/friends.test.ts` (8). Browser:
`UI_URL=http://127.0.0.1:5174 node tools/ui-test.mjs <outDir> --friends=<a>:<b> [w] [h]` (fake-chain
server) at 390x844 and 1280x800: Online dot + Add, Add friend -> Friends ✓, Remove window (Keep),
Friends section, Arena list, b's notice with Add back / Visit + Village dot, Visitors row + Add back ->
mutual, hidden tab -> offline at once and no pings while hidden.

### 7.12 Built: the online duel (v3 part 2; Ardian 2026-11-11, local commit, NOT released; VPS untouched)

**Switch:** `ARENA_ONLINE=on|off` in `server/.env` (default **off**; name in `server/.env.example`). The server
sends it to the web as `/api/config` `arenaOnline` and `state.arena.online`. **Off = no invite ever, the ping
stays at 30 s, no mint dot on Duel buttons; Duel fights the other garden's TaniBot exactly as v2.** So the online
part can be hidden without a code change (restart the server only).

**Flow** (`server/src/arena-match.ts`, same table `arena_matches`, `kind 'live'`):
1. Duel on a garden that is **Online** (and not a judge garden, not already in a duel): `POST /api/arena/match
   { opponent, live: true }` makes the match `status 'invite'` for 30 s (`ARENA_INVITE_MS`). The challenger
   sees "Waiting for budi to accept... 30" with **Fight budi's TaniBot now** and **Cancel**.
2. With the switch on the web pings every **4 s** (`PING_LIVE_MS`, sent as `state.friends.pingMs`); the ping's
   answer carries `invite` and the challenged player gets the popup **"<NAME> CHALLENGES YOU!"** (Accept /
   Decline, 30 s countdown; an outside click does nothing).
3. **Decline / no answer in 30 s / busy / judge garden / "Fight the TaniBot now"** = the same match goes on as a
   TaniBot duel (`kind 'bot'`, `inviteResult` 'declined' / 'timeout' / 'busy' / 'judge' / 'skipped'; the
   challenger sees "budi said no: you fight budi's TaniBot!"). Offline gardens = a normal TaniBot duel at once.
4. **Accept** (`POST /api/arena/match/:id/accept`): both play. Each turn 10 s for both, measured on the server
   (+1.5 s grace). The picks are stored in `pick_c` / `pick_d`; **the other side's open pick is never in any
   answer** (only `theyPicked: true`); the turn is decided when both picked or the time ran out. No pick = that
   player loses the turn ("Time’s up!"); nobody picked = both are hit (so an idle duel always ends).
5. Both webs ask for the match every **1 s** (`GET /api/arena/match/:id`, one small row, no open connection).

**Gone / leaving:** a side whose web has not asked for **5 s** (`ARENA_GONE_MS`; closing the page or Leave sends
`POST .../leave` at once) pauses the duel; the other side sees **"Waiting for budi... 20"** (`ARENA_PAUSE_MS`).
Back within 20 s = the duel goes on (the open turn starts its 10 s again; a reload re-opens the duel by itself).
Not back = the one who stayed **wins** (prize + XP like any win, in THEIR daily limits); the one who left gets no
XP. Gone **before the first turn was decided** = **cancelled** (no prize, no XP, not counted for anyone). Both
gone = no winner ("abandoned", counts as one of the challenger's duels, nobody paid).

**Prize and limits (as v2):** 8 PANEN `mint_reward` (Season rule) to the **winner, whichever side**; win 15 XP
(demo x5, at most 3 XP-wins a day per garden, both roles counted), loss 1 XP. The duel uses **one of the
challenger's 3 duels a day** (and the 1-per-opponent rule); accepting uses **none** of the challenged player's.
Paid wins per day: max 3 per browser and 10 per IP of **the winner** (`ip_d` / `device_d` when the challenged
player wins). The challenged player gets no "your TaniBot was challenged" notice for an online duel (they
played it); it shows in Recent duels for both.

**Anti-cheat:** the same person (same sign-in, a browser both gardens used in `devices`), **the same IP or the
same browser at Accept** = practice (no prize, no XP). Judge gardens cannot be challenged online.

**Database:** new nullable / DEFAULT columns on `arena_matches` only (`pick_c, pick_d, seen_d, invite_ends_at,
invite_result, paused_side, pause_ends_at, ip_d, device_d`), added by `migrate()`. **`nearvest-b7edf49` runs on
the upgraded database** (checked on a copy with live / cancelled rows, fake chain: `/api/me`, `/api/arena`, a v2
match start + pick all 200). After a rollback it ignores invites / paused / cancelled rows (it only reads
`status 'playing'`) and counts a cancelled duel toward the day's 3 (harmless). No database restore needed.

**Web:** `web/src/arena-invite.tsx` (popup), `arena-match.tsx` (waiting panel, "Waiting for <name>...", Leave
text, result lines, 1 s polling, `pagehide` = leave), `arena-turn.ts` (`asMine`: the challenged player sees the
duel turned around, "me" always on the left, so the Fruit Fight, life / skill bars, Gold Durian, Tandur Arena
and K.O. are reused unchanged; `foeLabel`, `inviteNote`, live texts), `presence.ts` (the ping's answer), Duel
buttons with a mint Online dot when the switch is on and the farmer is online (Arena window, Friends rows,
visit panel). **Old servers** (no `arenaOnline`): the web never sends `live`, pings every 30 s, no popup
(checked with `--oldserver` on `nearvest-b7edf49` at 390x844 and 1280x800: no problems).

**Tests:** `server/test/arena-online.test.ts` (14: switch off, invite + accept, decline / no answer / skip,
too late + cancel not counted, offline / judge / busy, open pick never sent, 10 s for both + both missed,
pause + back, not back = the stayer wins + both players' limits, cancel before the first turn + sweep, K.O.
prize either side, same IP / same browser = practice, limits, HTTP + privacy); `web/test/arena-online.test.ts`
(6). Two browsers: `FAKE_DB=... PLAYWRIGHT=... node tools/duel-online.mjs <outDir> <prefix> [w] [h]
[ko,decline,gone,cancel]` (two separate browser contexts = a normal window + an Incognito window) at 390x844
and 1280x800: all checks pass.

**Pick bubbles fix (Ardian's two-browser test, 2026-11-11):** the last turn's picks stayed over the TaniBots'
heads when the next turn opened (budi's screen showed ardian's Rock of turn 2 while the line said "ardian has
picked" in turn 3), which looked like a new pick. Now (`pickBubbles` in `web/src/arena-turn.ts`, online and
TaniBot duels): every new turn starts with **"?" over both heads on both screens**; your own pick shows on your
screen as soon as you tap it; the other side stays "?" until the turn is decided, then both open together (the
reveal). The explanation line of the previous turn now starts with "Last turn:". Tests: `web/test/arena-online.test.ts`
(pick bubbles), `tools/duel-online.mjs` checks "?" at the start of every turn on both screens, own pick + "?"
while waiting, both picks open together after the turn, and the TaniBot duel (390x844 and 1280x800).
