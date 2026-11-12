# Plan: Fishing mini-game (v1, simple)

Status: **APPROVED by Ardian 2026-11-11 with the decisions below. Server part BUILT 2026-11-11 (committed
locally, not pushed, not released; `server/src/fishing.ts`, tests `server/test/fishing.test.ts`); web part BUILT
2026-11-11; the ChatGPT pond (seen from above) replaced the temporary code-drawn pond on 2026-11-12.** Replaces "Fishing · Soon"
(docs/BACKLOG.md roadmap item). Draft numbers go to `server/src/rules.ts` once built and are tuned in
testing. Everything stays on NEAR testnet.

Decisions already made (Ardian, 2026-11-11):
- Fishing on your own at the existing fishing hut (village v3 `fishing` corner). The "Fishing" pin
  becomes live (no "Soon"). v1 is simple: tap to cast, wait for the bite sign, tap to reel, see the catch.
- **5 casts per village day per garden** (3 until 2026-11-12, package 6). The catch is decided **only on the server** (the browser
  never decides or sees it before reeling).
- PANEN through `mint_reward` (Season rule). Base values before the Season divisor below.
- UI text in English, design-system tokens only (CLAUDE.md "Design system").

Decisions at approval (Ardian, 2026-11-11):
1. A judge garden's **first cast is always an ordinary fish: Tilapia or Catfish** (normal 25:15
   weights between the two), never Golden Arowana, never junk or an item.
2. **3 junk = 1 Fertilizer is NOT built now** (roadmap, section 1.2). Junk gives 1 XP only and is not
   kept anywhere.
3. **No big Golden Arowana image**: the moment and share card use the code icon (scaled up, existing
   gold shine).
4. **Server switch `FISHING=on|off`** in `server/.env` (like `ARENA_ONLINE`; name in
   `server/.env.example`; on the VPS `/etc/nearvest/server.env`). Off or missing = the fishing
   endpoints refuse (404 `fishing_off`), `/api/config` says `"fishing": false`, `state.fishing` is not
   sent, so the web keeps "Fishing · Soon" exactly as today. The web must stay safe with the live
   server that has no fishing at all.
5. Storage full + Mango seed = Mr. Darto buys the seed for 2 PANEN base (section 1.1).

Ground rules (same as Arena / social): **no contract change**, no private data, safe with an old
server / old web, database change = **new table only** (rollback-safe), CC0 sounds only.

---

## 1. The catch table (server, one roll per cast)

| Group | Chance | Catch | Reward (base, before Season) |
|---|---|---|---|
| Fish 58% | 25% | Tilapia | 3 PANEN |
| | 15% | Catfish | 5 PANEN |
| | 10% | Carp | 5 PANEN |
| | 7% | Gourami | 10 PANEN |
| | 1% | **Golden Arowana** | 30 PANEN + moment (animation + share card "Golden Arowana") |
| Junk 30% | 6% each | Stone, Driftwood, Fish bone, Old boot, Rusty can (added 2026-11-12, Ardian's test package 1) | 1 XP |
| Items 12% | 5% | Mango seed (Common, unknown quality like a check-in seed) | 1 seed (Storage rule, see 1.1) |
| | 3% | Fertilizer (a drifting bottle) | 1 Fertilizer |
| | 3% | Message in a bottle | 5 XP + one funny line about Tandur (list of ~12 lines in `rules.ts`) |
| | 1% | Small chest | 10-15 PANEN (server roll) |

- Fish go straight to Mr. Darto's ice box: the PANEN is paid at once (no new "fish" inventory in v1).
- Demo gardens: XP x5 (`DEMO_XP_MULTIPLIER`), as everywhere. PANEN is never multiplied.
- Expected value: about **3.1 PANEN per cast**, about 9.4 PANEN per day for 3 casts (about 15.6 for 5 casts since package 6) (less after
  Season 2). For comparison: check-in 5 PANEN/day, one Arena prize 8 PANEN. Worst case one garden:
  3 x 30 = 90 PANEN in a day (chance 1 in a million).
- The sell text shows what the player really gets after the Season rule (`afterSeason`), the same as
  the Market ("Tilapia +3 PANEN", Season 2: "+1.5 PANEN" with the small Season note).

### 1.1 Mango seed when Storage is full (20/20) — proposal

**Mr. Darto buys it on the spot**: the player gets the seed's sell price (40% of 5 = 2 PANEN base,
`seedSellPrice('mango', null)`, `mint_reward`), with the line "Storage full: Mr. Darto bought the seed
for you (+2 PANEN)". Why: the player is never stuck, nothing is lost, no extra window, and it uses an
existing rule (Darto already buys seeds). No re-roll (a re-roll would quietly change the odds).

### 1.2 Roadmap (not built now): 3 junk = 1 Fertilizer

Agreed 2026-11-11 to leave it for after the hackathon. Idea kept for later:

Junk would be kept as one counter in the existing `items` table (`item = 'junk'`; no schema change; the web
Storage lists only known items, so an old web shows nothing new). The fishing window shows
"Junk 2/3" and, at 3, a button **Recycle 3 junk → 1 Fertilizer** (`POST /api/fishing/recycle`). No
chain job (Fertilizer is a game-server item). About 1 hour of work.

---

## 2. How a cast works (server decides, web only shows)

1. `POST /api/fishing/cast { deviceId }` → server checks the limits (section 3), **rolls the catch and
   stores it** in `fishing_casts`, plus a bite time 2-6 s. Answer: `{ id, biteInMs, castsLeft }` —
   **no catch in the answer**. The cast counts from now on (closing the window does not give it back,
   so nobody can re-roll by leaving).
2. The web shows the float, waits `biteInMs`, then the bite sign (float dips, "!" bubble, splash sound).
   A tap before the bite = "Wait for the bite!" (nothing lost).
3. `POST /api/fishing/:id/reel` → server marks it reeled and pays (ledger + `mint_reward` job, seed,
   item or XP). Answer: the catch, the PANEN after Season, XP, tx job id. A reel sent earlier than the
   bite time (minus 300 ms grace) is refused (409 `too_early`), so a script cannot skip the wait.
4. Not reeled within 60 s (window closed, phone locked) = the server reels it by itself on the next
   request (`state.fishing` or the next cast) and the catch shows as a notice: "TaniBot pulled in your
   line: Catfish +5 PANEN". The player never loses a cast's reward.

v1 has **no skill / timing** (a late tap still catches): the result is the server's roll only. A
timing game can come later.

---

## 3. Answers to Ardian's questions

### 3.1 Demo mode (1 day = 1 minute)

**Fishing counts the normal village day (07:00 WIB), also for demo gardens** — exactly like the Arena
(`arenaDay(now) = dayIndex(now, false)`). So demo gardens also get 5 casts (3 before package 6) per real day; demo mode
cannot become a PANEN tap. Demo only changes XP (x5), like everywhere. The window says "3 casts a
day · next casts at 07:00 WIB" with a countdown.

### 3.2 Anti-cheat (many gardens from one IP / browser)

Same idea as the Arena's paid wins:
- 5 casts per garden per village day (hard limit; 3 until package 6).
- **Paid catches** (anything with PANEN, a seed or Fertilizer) at most **5 per browser** (`deviceId`; 3 until package 6)
  and **10 per IP** per village day (`FISH_PAID_PER_DEVICE_PER_DAY = 3`, `FISH_PAID_PER_IP_PER_DAY = 10`;
  10 because many phones share a mobile IP, Ardian's Arena decision). The device id is the existing
  `nearvest.judgeDevice` (also recorded with `recordDevice`).
- Over that limit the player can still cast (fun stays), but a paid catch becomes **"released"**: the
  fish is shown, then let go, with 1 XP and the line "Daily fishing rewards from this device are used
  up. You let it go." Junk and bottles (XP only) are unchanged.
- Never block by IP (CLAUDE.md anti-cheat rule); the IP is only counted.

### 3.3 Judge gardens, wallet gardens, visits

- **Judge gardens: yes**, same 5 casts and limits. The judge garden's **first cast is always Tilapia or
  Catfish** (decided), so a judge with 2 minutes never sees only an old boot.
- **Wallet gardens: yes.** Fishing never burns, it only mints with the game key to the player's own
  account (`mint_reward`), so no wallet popup and no "Set up Shop" needed.
- **While visiting a friend: no.** The Fishing pin is hidden in visit mode (it is your own village's
  pond; the visit panel already has Sticker / Duel / Add friend). Back in your garden it shows again.
- TaniBot does not fish in v1 (it only stands by the hut as decoration while the window is open, and
  "pulls in" an abandoned line, text only).

### 3.4 Pictures: new ChatGPT images or code?

**Decided: 1 new ChatGPT image (the pond); everything else in code.**
- Fish, junk and item icons (14 small icons; fish and junk redrawn 2026-11-12, see section 8) = **drawn in code** in `web/src/sprites.tsx`
  (like the seed and fertilizer icons): sharp, consistent, fast; ChatGPT pictures this small get
  muddy after pixelizing.
- The cast / reel scene needs a bigger picture than the tiny hut corner → **one pond scene image**,
  shown at the top of the Fishing window like the Market / Shop scenes (`art/scenes.tsx`). Dusk and
  night = CSS tint from the village clock (no extra images). The float, the line, ripples, splash and
  the caught fish flying up are drawn in code on top of it.
- No big Golden Arowana image (Ardian 2026-11-11): the moment animation and share card scale up the
  code icon with the existing gold shine.

Image prompts for ChatGPT (send one at a time):

**Image 1 (needed) — pond scene.** The first prompt (side view, below) gave a pond seen from ABOVE,
which works well; the art was built for the top-down picture Ardian made (2026-11-12). Prompt that
matches the picture in the game (for a new version):
> Pixel art, 16-bit style, wide landscape 16:9, seen from above (top-down, slight angle). A calm
> tropical fishing pond filling most of the picture, clear blue-green water with gentle ripples and
> a large empty area of open water in the middle. A short wooden dock on the left edge, reaching into
> the water. Lily pads with pink lotus flowers and a few small frogs sitting on them near the banks,
> three ducks swimming near the right edge, a small waterfall over mossy rocks in the top right
> corner. Lush jungle banks with palms, ferns, red and pink flowers and grey stones all around. No
> people, no fishing rod, no float, no text, no logos. Clean outlines, limited palette, crisp pixels,
> no blur.

First prompt (2026-11-11, side view; not what the game uses):
> Pixel art, 16-bit style, wide landscape 16:9. A calm tropical fishing pond in a futuristic
> solarpunk Indonesian village called Tandur, seen from the side at a slight angle from a small
> wooden dock on the left. [...] Leave the middle of the water empty (a float and a fishing line will
> be drawn on top).

It is recorded in `docs/ASSETS.md` as AI-generated at Ardian's request, original in
`docs/art-source/`, converted with `tools/pixelize/pixelize.py --keep-bg --hq` (480x270) and the frogs redrawn with
`tools/pixelize/frogs.py` (exact commands in docs/ASSETS.md).

### 3.5 Server and database change; is `nearvest-fd0112c` still OK?

- **Server changes: yes.** New `server/src/fishing.ts` (roll, limits, cast / reel,
  auto-reel), rules in `rules.ts` (table, limits, bottle lines), routes in `app.ts`
  (`POST /api/fishing/cast`, `POST /api/fishing/:id/reel`), switch `FISHING` in `config.ts`,
  `state.fishing = { left, max, open: {id, biteAt} | null, last }` (only when the switch is on), log label "Fishing catch"
  in `activity()`.
- **Database: one new table only**, `fishing_casts` (id, player_id, cast_day, catch, panen_micro, xp,
  item, device_id, ip, bite_at, reeled_at, ledger_id, created_at) with an index on
  (player_id, cast_day). Nothing else changes (Fertilizer goes into the existing `items` row).
- **Rollback: `nearvest-fd0112c` runs on the new database** (it never reads `fishing_casts`). Will be
  checked on a copy of the database before release, as with the Arena releases. Pending `mint_reward`
  jobs of fishing are ordinary jobs, so the old worker still sends them.
- Old server + new web: no `state.fishing` → the pin stays "Soon" with today's window.
  New server + old web: the old web ignores `state.fishing`; nothing changes.
- **No contract change.** Golden Arowana / chest are normal `mint_reward`s (memo "Fishing: ...").

### 3.6 Tests and time estimate

Server (`server/test/fishing.test.ts`, fake chain, fixed random):
1. Odds: 100,000 rolls hit the table within ±0.5% per row; chest amount always 10-15.
2. The cast answer never contains the catch (also checked as raw JSON).
3. 5 casts per village day; the 6th = 429 `fishing_limit`; next day after 07:00 WIB works again.
4. Demo garden: still 3 per normal day (a demo "day" of 1 minute does not reset it); XP x5.
5. Reel before the bite = 409 `too_early`; reel twice = paid once; someone else's cast = 404.
6. Abandoned cast: auto-reeled after 60 s, paid once, notice in state.
7. PANEN via `mint_reward` with the base amount; Season 2 shows half in the answer.
8. Mango seed with 20/20 Storage → Darto sale 2 PANEN base; with room → seed in Storage.
9. Paid limit: 6th paid catch from one device / 11th from one IP = "released" (1 XP, no PANEN);
   junk still counted normally.
10. Switch off / missing: every fishing endpoint 404 `fishing_off`, no `state.fishing`, config false.
11. Judge garden: first cast is Tilapia or Catfish (many seeds); wallet garden: mint to its own account.
12. Visit mode irrelevant to the server; fishing only on your own garden (no `:name` route).
13. Rollback check: old release code on a copy of the upgraded database (manual, before release).

Web (`web/test/fishing.test.ts`): state → pin live / Soon, casts-left text, Season text, "released"
text.

Browser (`tools/ui-test.mjs --fishing=<devUser>`, fake-chain server + FAKE_DB) at **390x844** and
**1280x800**: pin live → window opens; cast → float → bite sign → reel → catch card (fish, junk, item,
Arowana moment forced with a dev-only `FAKE_DB` roll); too-early tap; 5 casts then "Come back at
07:00 WIB"; Storage full seed text; visit mode = no pin; reduced motion = still; old server
(`--oldserver`) and `FISHING=off` = "Soon" window; screenshots of every step; fps while the float moves.

**Time estimate (Claude's work):**
| Part | Time |
|---|---|
| Server (fishing.ts, rules, routes, state, log) + server tests | 2.5-3 h |
| Web (pin, Fishing window, cast/bite/reel animation, catch card, 13 code icons, sounds, Arowana moment + share card) | 4-5 h |
| Pond image conversion (after Ardian's ChatGPT image) | 0.5-1 h |
| Browser tests at 2 sizes, fixes | 1.5-2 h |
| Release (with Ardian's OK) + docs | 0.5 h |
| **Total** | **about 9-11 h (one long day)** |

Schedule note: Thu 12 Nov is the buffer + feature freeze. Fishing fits only if it is started now and
the freeze holds; if it slips, the pin simply stays "Soon" (nothing else depends on it).

## 8. Package 1 of fixes after Ardian's test (2026-11-12) — BUILT 2026-11-12 (committed locally, not pushed)

Rod maths: `web/src/art/rod-pose.ts` (tests `web/test/rod-pose.test.ts`: the line always starts at the
tip, no jumps, nothing touches a frog or a duck at any moment). Icons: `tools/pixelize/catch_icons.py`.
Tiers: `catchTier` in `web/src/fishing-logic.ts`. Browser: `tools/fishing-test.mjs` also checks the
line on the tip mid-cast / waiting / bite / reeling, the bent rod, TaniBot facing right and each tier.

1. TaniBot on the dock faces right (toward the water).
2. A better rod: bamboo with nodes, a cork handle, a small reel and a tapering tip. The line and the
   float are ALWAYS attached to the rod's tip. Cast = the rod swings, the line flies in an arc and the
   float drops into the water; wait = the line sags softly to the float; bite (strike) = the rod BENDS
   toward the float and the line goes taut; reel in = the line is pulled back to the rod.
3. Sounds made in code (docs/ASSETS.md): a swing whoosh at the cast, a "plunk" when the float lands,
   a reel clicking while reeling in.
4. New pixel icons (drawn in code, not traced from photos): Tilapia, Catfish, Carp, Gourami, Golden
   Arowana, Driftwood, Fish bone. The fish jumping out of the pond uses the same grids.
5. New junk **Rusty can** (1 XP). Junk stays 30% in all, now 6% for each of the 5 kinds. The PANEN
   economy does not change (fish 58%, items 12% as before).
6. Result animation + sound per tier: junk = a soft, slightly funny plop; normal fish = a splash +
   a short happy sound; items (seed, fertilizer, bottle, chest) = their own "item" sound; Gourami =
   more festive; Golden Arowana = gold sparkles + the biggest jingle.
7. Share card only for the top catch (Golden Arowana), showing the new fish picture.

## 9. Package 2: atmosphere (Ardian 2026-11-12) — BUILT 2026-11-12 (committed locally, not pushed)

1. Water pixel wipe ("To the fishing pond" / "Back to the village") on the way in and out (the visit
   wipe with water squares, `useVisitWipe` palette `water`; reduced motion = a short fade).
2. Life (`web/src/art/pond-life.tsx`, rules `web/src/pond-life-plan.ts`): waterfall streaks + foam,
   drifting glints, frogs hop in place now and then and sometimes to a neighbouring lily pad, facing a
   random side; ducks paddle to random spots on the right-hand side only (never near the float); the big
   tree's crown sways. The ChatGPT frogs and ducks were taken out of the picture
   (`tools/pixelize/pond_clean.py`) and are drawn in code.
3. Background sounds made in code (`setPondAmbience`, Sound switch): waterfall, ripples, frogs, ducks;
   the garden's ambient loop pauses while the pond is open.
4. Village clock: morning / day / dusk / night tints. Morning + day: breeze sound, green leaves.
   Dusk: warm tint, dusk leaves. Night: dark tint, night leaves, frogs + crickets, ducks ASLEEP (still,
   "zzz"), no duck sounds. Rain follows the village (drops, rings on the water, rain sound, frogs; ducks
   only when not night). NO eruption or ash at the pond: those show a clear pond.
5. Reduced motion: nothing moves (no timer, no leaves); only a few particles (5 leaves, 8 rain rings).
6. Browser test: `tools/pond-mood-test.mjs` (fake chain, `?time=day|dusk|night`, `?weather=rain|eruption`).

## 10. Package 3 (Ardian's test, 2026-11-12) — BUILT 2026-11-12 (committed locally, not pushed)

1. **Full screen** like the village: `pondFit` (web/src/pond-life-plan.ts). Laptops: the pond covers
   the window (crops at most 12%: 1280x800 loses 71 px on each side, TaniBot and the dock stay in
   view). Upright phones: the 16:9 pond fits the width (390 x 219 at 390x844) in the upper part, a
   blurred, darker copy of it fills the rest, the panel sits under the pond and never covers it.
   Floating controls: top bar "← Village" + casts left, bottom panel (status, catch card, Cast line /
   Reel in), "What can I catch?" in its own window. The water wipe stays.
   **Phone answer:** the 16:9 picture works, but on an upright phone it uses only about a quarter of
   the screen (cropping it would cut the dock, the float or the ducks). For a real full-screen phone
   pond an upright picture is needed; prompt below. The overlay (dock end, float, frogs, ducks,
   waterfall) would then be measured again on that picture, like the village's phone version.
2. Honest PANEN: the list shows what you receive after the Season rule (chest range too) with
   "Season N: rewards X%"; the catch card says Mr. Darto bought the fish on the spot.
3. Ducks float (shadow, waterline, ripple) and swim anywhere on the lake by a water map made from the
   picture (`WATER_MASK`, `tools/pixelize/pond_clean.py`), never bump into each other (paths kept 24 px
   apart), keep away from the float and the line while fishing, and from the floating panels.
4. Waterfall and ripples did not visibly move: the lake glints' animation shared its name with the
   item glints (`pond-glint`), so it was replaced; the waterfall streaks were 1 px pale lines on white
   water. Now bright / dark dashes slide down each falling sheet, foam puffs and rings at the foot,
   slow ripples on the lake. Proof: two shots 300 ms apart differ (tools/pond-mood-test.mjs).
5. Falling leaves are pixel leaves (blade, vein, stem; 3 shapes), turning slowly, colour by time.
6. The village's fish hologram sign moved 3 px (laptop) / 2 px (phone) to the right.
7. At the pond Tandur's music and ambient loop are silent (`setPondMode`), back after leaving.
8. Crickets at night (also in the rain), louder.

### Image prompt: upright (phone) fishing pond, for ChatGPT

> Pixel art game background, seen from directly ABOVE (top-down), PORTRAIT format 9:16 (for example
> 1080 x 1920), same style and colours as the landscape NEARvest fishing pond: a tropical jungle pond in
> a futuristic Indonesian village. A wooden dock comes in from the LEFT edge at about 40% of the height
> and ends over the water (room for a small robot to stand on its end). A big calm area of open water in
> the middle of the picture, from about 30% to 75% of the height, with nothing in it (the fishing float
> goes there). A small waterfall at the TOP RIGHT falling over mossy rocks into the pond, with foam and
> rings at its foot. Lily pads WITHOUT frogs: two or three groups near the left bank and one near the
> top. NO ducks, NO frogs, NO fish, NO people, NO text. Lush jungle banks with palms, ferns, red and pink
> flowers and grey stones all around; a big tree at the top left. The bottom 20% of the picture is bank
> and jungle (game buttons will sit there). Crisp pixels, no blur, no outline frame.

## 11. Dusk and night pictures (Ardian 2026-11-12) — BUILT 2026-11-12 (committed locally, not pushed)

Ardian's ChatGPT `fishing-pond-dusk.png` and `fishing-pond-night.png` replace the code tints for dusk
and night. Checked first: dock, every lily pad, rocks, tree and waterfall line up with the day picture
(best match 0-1 px at 480x270 for every part; one pad looked off by the numbers only because the day
picture still has a frog on it, a zoomed side-by-side shows the same place). They have no frogs or
ducks, so no cleaning was needed. Cross-fade on the village clock like the village (`pondMix`, same
hours as `skyMix`); the tree crown layer has dusk / night versions; the code-drawn animals, TaniBot,
the rod and the water effects are dimmed a little at dusk / night to match (CSS filter). The morning
light and the rain darkening stay code tints.

## 12. Package 4 (Ardian's test, 2026-11-12) — BUILT 2026-11-12 (committed locally, not pushed)

1. Waterfall remade: the picture's own waterfall colours flow down inside the falling water's mask
   (`tools/pixelize/pond_fall.py`: mask from the day picture, one texture per day / dusk / night picture,
   faded with `pondMix`), soft foam at the foot (white; warm at dusk, blue at night).
2. Faint waves spread slowly from the waterfall over the lake, masked to the water
   (`fishing-pond-water.png` from `tools/pixelize/pond_clean.py`).
3. Fireflies on clear nights by the bushes and banks (none in the rain).
4. Jungle birds (code sounds): clear mornings and days, a few at dusk, none at night or in the rain.
5. Night and rain: the float glows (light + reflection); TaniBot holds a bamboo lamp staff (leaf
   holder, glowing crystal; own design) in its left hand, lighting the dock. Not by day.
6. A wooden bucket of fish (our Tilapia, Catfish, Carp, Gourami icons) on the dock behind TaniBot
   (`tools/pixelize/bucket.py`).
7. Now and then (7-16 s) a random fish jumps out and back in with rings, drops and a small splash
   sound; never near the float, line, ducks or pads; Golden Arowana 2%.
8. Season proof: `FAKE_SEASON=3` (local fake chain only) + `tools/fishing-season-test.mjs`: Carp 5 ->
   1.25 PANEN on the card, the list shows the amounts after the Season rule with "Season 3: rewards 25%".
9. Reduced motion: everything still (no jumps, no flowing water, no blinking). Few particles.

## 13. Package 5 (last before release, Ardian 2026-11-12) — BUILT 2026-11-12 (committed locally, not pushed)

1. Waterfall follows the real path down the rock steps: one layer per step (clip polygon + water mask),
   texture sliding along that step's slant (skew), spray on each lip, foam spreading at the foot; the
   dusk / night textures skip darker rock pixels (no specks).
2. Birds: four kinds (whistler, bulbul, warbler, dove) with tunes and vibrato, sometimes answering,
   louder; same times as before (more often by day).
3. The fish bucket is a galvanised metal pail with a wire handle.
4. TaniBot's lamp is a short torch (bamboo grip, lantern box with a mint crystal, leaf on the cap).

## 14. Package 6 (Ardian's test on the LIVE site, 2026-11-12)

6. **5 casts per village day** (was 3) and **5 paid catches per browser** (was 3); per IP stays 10
   (`server/src/rules.ts` `FISHING_CASTS_PER_DAY`, `FISHING_PAID_PER_DEVICE_PER_DAY`). **No database
   change**: the limits are counted from the existing `fishing_casts` rows; the web shows the server's
   `max`. An older release simply keeps its own numbers.
1. **Glitch (live, demo garden):** a demo village day lasts 1 minute, so the pond jumped day -> dusk ->
   night on every 8 s state poll, the pictures popping in (mounted at full opacity) with no fade; the
   lights, rain and dimming switched at once too. Now (`nextMood` in `web/src/pond-life-plan.ts`) the
   pond shows one mood that changes with a 4 s fade (all layers always loaded, CSS opacity / filter
   transitions); in demo mode each picture and the weather hold at least 20 s. Browser:
   `tools/pond-demo-test.mjs` (a demo garden for 60 s: >= 20 s between pictures, fades seen). (Ardian's
   screen recording on the Desktop could not be opened: macOS blocks the Desktop folder for the
   terminal; reproduced in a demo garden instead.)
2. Phones: compact panel and catch card (small icon, name + reward on one line, short note).
3. Upright phone pond: the first idea (the 16:9 scene in the middle band of an extended picture) was
   reverted (Ardian: no code extension). Ardian's ChatGPT phone picture (941x1672) is a NEW composition
   (dock, pads, waterfall elsewhere; checked: nothing lines up with the 16:9 picture), so the phone pond
   will get its own measured layout once the matching dusk and night versions are ready.
4. The pond's top bar shows the PANEN balance (gold PANEN coin), counting up with "+N" after a catch.
5. Village HUD: the PANEN balance next to the profile box with the round gold PANEN coin
   (`web/src/art/panen-coin.tsx`: a P with a vertical stroke); the square PANEN chip is gone.

## 15. The phone pond (Ardian 2026-11-12) — BUILT 2026-11-12 (committed locally, not pushed)

Ardian's ChatGPT phone pictures (day / dusk / night, a new upright composition) are used on upright
phones; laptops keep the 16:9 pond. Two layouts in `web/src/art/pond-layouts.ts` (WIDE, PHONE): every
place (dock end + TaniBot, rod angles, float, lily pads + frogs, the ducks' water map, waterfall steps,
lips and foam, tree crown, bucket, fireflies, glints, rain rings, waves, the lake's lowest row) per
layout. Things in the phone picture are about 1.4 times bigger, so the phone scene's grid is the
picture / 1.4 (343 x 609): sprites keep their size. On the phone a lily pad sits just up-right of the
dock's end, so the phone rod rests low and swings back down-left (never over a pad; unit test). Fit:
across the width at the top, smaller when needed so at least 200 px stay free below the lake for the
controls (390x664: 316 px wide). Tests: `web/test/rod-pose.test.ts`, `web/test/pond-life.test.ts`
(phone), `tools/fishing-test.mjs` and `tools/pond-mood-test.mjs` at 390x844 / 390x664.

## 16. Package 7 (Ardian 2026-11-12, last before the release) — BUILT 2026-11-12 (committed locally, not pushed)

Day / dusk / night changes were checked by Ardian and are unchanged.

- **Rings at the waterfall:** the waves and the foam rings are SVG ellipses inside the lake's water
  mask, and a gradient along the line from the fall's middle through its foot hides their back half
  (`ringFade` in `art/pond-life.tsx`): no ring over a rock or the falling water. Phones: small (46 x 22
  grid px), faint (0.3), quick (5 s) rings near the foot only (`waves` in `pond-layouts.ts`).
- **Waterfall** 1.4x slower (`FALL_SLOW`), lips and foam too.
- **White "fog":** measured layer by layer (each overlay hidden in turn): the morning tint, a gold
  soft-light veil over the whole pond from 05:00 to 10:00, washed every colour out evenly (+5
  brightness). Not meant as fog: removed. Rain only darkens (multiply); no other layer whitens.
- **Torch held:** drawn in TaniBot's own 58 x 64 sprite grid inside its box (`HeldLamp`, `LAMP_HAND`
  = the fist away from the rod): the grip runs behind the body, so the fist covers it; it breathes
  with TaniBot (same animation); the crystal's glow is never dimmed. Same for every tier.
- **Catch leaves the lake:** the catch, splash and sparkles are one `.pond-result-fx` that fades out
  2.4 s after the result (also with reduced motion).
- **Phones full screen:** `pondFit` phone = full width always; the picture moves up (at most 72 grid
  px of jungle off screen, `PHONE_TOP_CROP`) when the controls need room (`PHONE_PANEL_MIN` 165);
  below the picture its own ground continues (`tools/pixelize/pond_ground.py`, quilted wavy seams,
  drawn over the picture's last 16 rows) with the same rain / tint (`.pond-ground-mood`). No blur.
- **Compact phone panel:** catch card = small icon, name, reward chip + one short line; the hint is
  one line; "What can I catch?" is a small link next to the button; after the last cast the card's
  line is "Come back at 07:00 WIB (in ...)" and the button "No casts left".
- **Same cast on phones:** the phone rod uses the laptop's angles; the lily pad in the rod's reach
  has no frog any more (frogs[0] sits on the pad next to it; `crittersOf` = pads frogs use). Lines
  sag at right angles to themselves (`sag` in `rod-pose.ts`), so the steep phone line curves too.
- **HUD:** village clock (`clockText`, AM / PM), the village weather chip, laptop fullscreen button
  (`useFullscreen`, hidden on phones like the village).
- **Sounds:** ducks quack audibly (not at night), frogs ribbit at 400-600 Hz (the old ~100 Hz croak
  is below what phone speakers play), louder jump splash, waterfall / rain / birds softer, crickets
  louder. Dev builds log every pond sound (`window.__pondLog`) and its level (`__pondLevel`);
  `tools/pond-sound-test.mjs` listens 30 s per time / weather and checks what is heard and how loud
  over the waterfall (1.4x to 6x).

