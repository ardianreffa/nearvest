# Plan: Fishing mini-game (v1, simple)

Status: **APPROVED by Ardian 2026-11-11 with the decisions below. Server part BUILT 2026-11-11 (committed
locally, not pushed, not released; `server/src/fishing.ts`, tests `server/test/fishing.test.ts`); web part BUILT
2026-11-11 with a temporary code-drawn pond (`web/src/art/pond.tsx` `PondBackdrop`; swap in the ChatGPT image when
it arrives).** Replaces "Fishing · Soon"
(docs/BACKLOG.md roadmap item). Draft numbers go to `server/src/rules.ts` once built and are tuned in
testing. Everything stays on NEAR testnet.

Decisions already made (Ardian, 2026-11-11):
- Fishing on your own at the existing fishing hut (village v3 `fishing` corner). The "Fishing" pin
  becomes live (no "Soon"). v1 is simple: tap to cast, wait for the bite sign, tap to reel, see the catch.
- **3 casts per village day per garden.** The catch is decided **only on the server** (the browser
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
| Junk 30% | 7.5% each | Stone, Driftwood, Fish bone, Old boot | 1 XP |
| Items 12% | 5% | Mango seed (Common, unknown quality like a check-in seed) | 1 seed (Storage rule, see 1.1) |
| | 3% | Fertilizer (a drifting bottle) | 1 Fertilizer |
| | 3% | Message in a bottle | 5 XP + one funny line about Tandur (list of ~12 lines in `rules.ts`) |
| | 1% | Small chest | 10-15 PANEN (server roll) |

- Fish go straight to Mr. Darto's ice box: the PANEN is paid at once (no new "fish" inventory in v1).
- Demo gardens: XP x5 (`DEMO_XP_MULTIPLIER`), as everywhere. PANEN is never multiplied.
- Expected value: about **3.1 PANEN per cast**, about 9.4 PANEN per day for 3 casts (less after
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
(`arenaDay(now) = dayIndex(now, false)`). So demo gardens also get 3 casts per real day; demo mode
cannot become a PANEN tap. Demo only changes XP (x5), like everywhere. The window says "3 casts a
day · next casts at 07:00 WIB" with a countdown.

### 3.2 Anti-cheat (many gardens from one IP / browser)

Same idea as the Arena's paid wins:
- 3 casts per garden per village day (hard limit).
- **Paid catches** (anything with PANEN, a seed or Fertilizer) at most **3 per browser** (`deviceId`)
  and **10 per IP** per village day (`FISH_PAID_PER_DEVICE_PER_DAY = 3`, `FISH_PAID_PER_IP_PER_DAY = 10`;
  10 because many phones share a mobile IP, Ardian's Arena decision). The device id is the existing
  `nearvest.judgeDevice` (also recorded with `recordDevice`).
- Over that limit the player can still cast (fun stays), but a paid catch becomes **"released"**: the
  fish is shown, then let go, with 1 XP and the line "Daily fishing rewards from this device are used
  up. You let it go." Junk and bottles (XP only) are unchanged.
- Never block by IP (CLAUDE.md anti-cheat rule); the IP is only counted.

### 3.3 Judge gardens, wallet gardens, visits

- **Judge gardens: yes**, same 3 casts and limits. The judge garden's **first cast is always Tilapia or
  Catfish** (decided), so a judge with 2 minutes never sees only an old boot.
- **Wallet gardens: yes.** Fishing never burns, it only mints with the game key to the player's own
  account (`mint_reward`), so no wallet popup and no "Set up Shop" needed.
- **While visiting a friend: no.** The Fishing pin is hidden in visit mode (it is your own village's
  pond; the visit panel already has Sticker / Duel / Add friend). Back in your garden it shows again.
- TaniBot does not fish in v1 (it only stands by the hut as decoration while the window is open, and
  "pulls in" an abandoned line, text only).

### 3.4 Pictures: new ChatGPT images or code?

**Decided: 1 new ChatGPT image (the pond); everything else in code.**
- Fish, junk and item icons (13 small 16x16 icons) = **drawn in code** in `web/src/sprites.tsx`
  (like the seed and fertilizer icons): sharp, consistent, fast; ChatGPT pictures this small get
  muddy after pixelizing.
- The cast / reel scene needs a bigger picture than the tiny hut corner → **one pond scene image**,
  shown at the top of the Fishing window like the Market / Shop scenes (`art/scenes.tsx`). Dusk and
  night = CSS tint from the village clock (no extra images). The float, the line, ripples, splash and
  the caught fish flying up are drawn in code on top of it.
- No big Golden Arowana image (Ardian 2026-11-11): the moment animation and share card scale up the
  code icon with the existing gold shine.

Image prompts for ChatGPT (send one at a time):

**Image 1 (needed) — pond scene:**
> Pixel art, 16-bit style, wide landscape 16:9. A calm tropical fishing pond in a futuristic
> solarpunk Indonesian village called Tandur, seen from the side at a slight angle from a small
> wooden dock on the left. Clear blue-green water filling the lower two thirds, with lily pads,
> a few reeds and gentle ripples. On the far bank: palm trees, a bamboo hut with solar panels on the
> roof, a small hologram sign with a fish, and a volcano in the soft distance. Daytime, warm light,
> no people, no animals, no fishing rod, no text, no logos. Clean outlines, limited palette, flat
> colours, no blur, no gradients, crisp pixels. Leave the middle of the water empty (a float and a
> fishing line will be drawn on top).

It is recorded in `docs/ASSETS.md` as AI-generated at Ardian's request, original in
`docs/art-source/`, converted with `tools/pixelize/pixelize.py --keep-bg`.

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
3. 3 casts per village day; the 4th = 429 `fishing_limit`; next day after 07:00 WIB works again.
4. Demo garden: still 3 per normal day (a demo "day" of 1 minute does not reset it); XP x5.
5. Reel before the bite = 409 `too_early`; reel twice = paid once; someone else's cast = 404.
6. Abandoned cast: auto-reeled after 60 s, paid once, notice in state.
7. PANEN via `mint_reward` with the base amount; Season 2 shows half in the answer.
8. Mango seed with 20/20 Storage → Darto sale 2 PANEN base; with room → seed in Storage.
9. Paid limit: 4th paid catch from one device / 11th from one IP = "released" (1 XP, no PANEN);
   junk still counted normally.
10. Switch off / missing: every fishing endpoint 404 `fishing_off`, no `state.fishing`, config false.
11. Judge garden: first cast is Tilapia or Catfish (many seeds); wallet garden: mint to its own account.
12. Visit mode irrelevant to the server; fishing only on your own garden (no `:name` route).
13. Rollback check: old release code on a copy of the upgraded database (manual, before release).

Web (`web/test/fishing.test.ts`): state → pin live / Soon, casts-left text, Season text, "released"
text.

Browser (`tools/ui-test.mjs --fishing=<devUser>`, fake-chain server + FAKE_DB) at **390x844** and
**1280x800**: pin live → window opens; cast → float → bite sign → reel → catch card (fish, junk, item,
Arowana moment forced with a dev-only `FAKE_DB` roll); too-early tap; 3 casts then "Come back at
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
