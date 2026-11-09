# Plan: social package (garden visits, share popup, referral)

Status: PLAN ONLY (2026-11-09). No code yet. Covers docs/BACKLOG.md item 5 (share popup + moment
animations), item 6 (referral) and the Thursday "simple garden visits". Draft numbers live in
`server/src/rules.ts` once built and are tuned in testing. Everything stays on NEAR testnet.

Ground rules for the whole package:
- **No contract change.** $PANEN already has `mint` (exact) and `mint_reward` (Season rule), the game
  account is the minter; Tree NFTs already update on stage changes (`update_tree`).
- **No free text anywhere.** Players only see names, titles, avatars, trees and template stickers.
- **No private data.** Never show email, Google data, linked wallet, PANEN balance, seeds, TaniBot
  budget or IP. The garden name (`<name>.nearvest.testnet`) is public on chain anyway.
- **Safe with an old server / old web.** New web on an old server: the Friends pin stays "Soon", no
  referral box. Old web on the new server: nothing changes. The database change only adds tables and
  nullable columns, so a rollback to the previous release keeps working.
- Design system tokens only (fonts, sizes, 24 colours); CC0 sounds only (docs/ASSETS.md).

---

## 1. Simple garden visits

### 1.1 Farmer list ("Farmers of Tandur")
Opened from the **Friends** place pin (no longer "Soon") and from the Village tab.

Who is shown:
- Gardens that are ready (`account_status = 'ready'`), have at least one living tree, and were active
  in the last 7 real days (new column `players.last_seen_at`, updated at most once per 10 minutes on
  `/api/me`).
- **Judge gardens are NOT listed** (they are throwaway `judge-xxxx` gardens; 50 a day would fill the
  list). Judges CAN open the list, visit and help water: the list is what they test.
- The player's own garden is not in the list.

Order:
1. "Helped you" first: farmers who watered one of your trees in the last 3 days (newest first).
2. Then "Needs water": gardens with a thirsty tree today (helping is useful there).
3. Then the most recently active.
At most 30 rows; no paging, no search in the first version.

One row shows: avatar, name, title, number of trees, a small "thirsty" water drop if a tree needs
water, "Helped you" tag. Nothing else.

### 1.2 Visiting a garden (read only)
- `GET /api/farmers/:name` returns a **public garden view**: name, title, avatar, TaniBot tier, the
  plots with their trees (species, quality, stage, wilting / thirsty / ash, Memorial Trees on plots),
  and the Tree NFT ids (links to nearblocks). Not included: PANEN balance, seeds, fruit, items,
  TaniBot budget / log, sign-in methods.
- The web draws it with the same garden scene (village backdrop, plots, trees), in a "visit" mode:
  a banner "Visiting sari's garden" + "Back home" button; no Shop / Storage / Market actions, no plot
  sheet with seeds; tapping a thirsty tree shows "Help water". Our own TaniBot stays home.

### 1.3 Help water: 1 tree per day
Rules (server checks all of them; draft numbers):
- A player may help water **1 tree per village day in total** (not per friend). Village day = the
  normal 07:00 WIB day even for demo gardens, so a 1-minute demo day cannot farm XP.
- Only a tree that is thirsty now (not watered today, not raining). In a drought the help counts as
  one of the two waterings. Never your own garden.
- XP: **helper +5 XP, owner +3 XP** (normal XP rules, so the demo x5 applies to demo gardens). The
  owner earns help XP at most **3 times per day** (more helps still water the tree, without XP).
- Gardens younger than 1 real day give and receive water but **no XP** (stops "make 10 accounts,
  water each other").
- The owner sees it: a notice on their next visit ("sari watered your Durian on plot 1 · +3 XP") and
  a line in the Village log.

**On chain?** No. Watering is game-server data, for your own trees too: the Tree NFT stores stage,
age and harvest count, and is updated (`update_tree`) only when the stage changes. If the help water
makes the tree reach its next stage, the normal `update_tree` job runs as always. Writing the helper
into the NFT would need a contract change, so it is left out. The README says this honestly.

### 1.4 Template stickers
- 6 stickers, pixel icons + fixed text: "Nice garden!", "Great durian!", "Keep it up!", "Thanks for
  the water!", "Gold vibes!", "See you tomorrow!".
- A visitor can leave **1 sticker per garden per day**. The owner sees the last 10 received
  (name + sticker + "today / yesterday") in a small "Visitors" box (garden notice + Village tab).
- No free text, so no moderation is needed. Optional "Hide stickers" switch in the Profile.

### 1.5 Friends pin
`art/hotspots.tsx`: `friends.open` points to the farmer list; the "Soon" tag goes; label "Visit
farmers". The Arena pin stays "Soon".

---

## 2. Share popup per moment (BACKLOG item 5)

Existing: share cards (`share.tsx`), the moment queue (`moments.ts`: once per moment, ranked), the
hold during the tutorial and the Judge tour (`holdShareCards`), the fx layer (`fx.tsx`: confetti,
coins, leaves, float text) and sounds (`audio.ts`).

Changes:
- **Timing:** each moment plays its animation first; the popup opens **1.5 s after the animation
  ends** (today it is a fixed 1.6 s after the event).
- **Queue:** one popup at a time (already); the next one opens 1.5 s after the previous one closes.
  Also waits while another window is open (check-in, TaniBot, sell picker, How to play) and while
  the tutorial coach or the Judge tour is running (already held; released 1.2 s after they end).
- **Closing:** clicking outside does NOT close it any more. Two ways out:
  - **X** (top right): closes this card.
  - **Later**: closes it and keeps it in a small "Share later" list in the Village tab (this browser,
    localStorage, max 10), so the player can still share it.
- **Animation + sound per moment** (first version; Ardian reviews):

| Moment | Animation (fx layer, CSS, pixel) | Sound |
|---|---|---|
| First harvest | basket pops up over the plot, fruits bounce in | cheerful jingle (new CC0) |
| First Gold tree / Gold fruit | golden shine sweeps across the tree + sparkles | sparkle chime (new CC0) |
| Big / Rare durian | durian drops with a heavy bounce, dust puff | drum hit (new CC0) |
| New title | banner rises with the title + confetti (exists) | `levelup` (exists) |
| TaniBot evolved | scan-line glow over TaniBot | robot beeps (new CC0) |
| 7-day streak | calendar page flips + coin rain (`coinsToBalance` exists) | `coins` (exists) |
| Legend | pixel fireworks | fanfare (new CC0) |
| Eruption survived | (weather animation already on screen) | `levelup` |

  At most 5 new CC0 sound files, each recorded in docs/ASSETS.md. Reduced motion: no movement, a
  still glow only; the sound follows the Sound switch.
- `?record=1` (demo video) keeps hiding the popups as now.

Web only; no server change.

---

## 3. Referral (BACKLOG item 6)

Flow:
1. Every garden has an invite link `https://nearvest-six.vercel.app/?ref=<name>` (Village tab and the
   profile share card). The name is already public.
2. A visitor opening that link: the web keeps `ref` in localStorage for 7 days.
3. When that browser creates a NEW garden (Google, wallet or dev), the web sends `ref` and the device
   id with `POST /api/garden`. The server stores a **pending** referral.
4. When the friend makes their **first harvest**, the server pays both and marks it **paid**; both get
   a notice + tx link.

Anti-cheat (server):
- Pending referrals are only made for brand-new gardens, never for judge gardens (as friend or as
  referrer), never when `ref` is the friend's own garden.
- **Self-invite:** refused when the friend's device id is a device the referrer has used (new table of
  devices per player, filled at login), or the same Google / wallet identity.
- **Max 3 paid referrals per day per device and per IP** (the friend's side; like the welcome pack:
  never block the login or the garden, only the bonus). Extra: a referrer gets at most 10 paid
  referrals per day.
- The device id is the existing random id in localStorage (`nearvest.judgeDevice`, renamed in code to
  a general device id, value kept). It can be cleared, so the IP limit is the second line.

**Rewards (draft): referrer 10 PANEN, friend 5 PANEN. Recommendation:**
- **Friend 5 PANEN with exact `mint`**: it is part of the welcome, like the 50 PANEN welcome pack and
  the check-in, which use exact `mint` by the agreed $PANEN rules.
- **Referrer 10 PANEN with `mint_reward`** (follows the Season rule): it is an earned reward like
  harvest sales and the planned Arena prize, and it shrinks as supply grows, so farming fake
  accounts pays less over time. Note: the live server is in Season 3 now (rewards / 4), so a referrer
  would get 2.5 PANEN today. If that feels too small, raise the base to 20 (= 5 today) rather than
  switching to exact mint.

---

## 4. What changes where

**Contracts:** nothing.

**Database (`server/src/db.ts`, only new tables / nullable columns):**
- `players.last_seen_at` (nullable), `players.ref_by` (nullable player id).
- `devices (player_id, device_id, first_at)` - for self-invite checks.
- `garden_help (id, helper_id, owner_id, tree_id, village_day, owner_xp, created_at)` - unique
  `(helper_id, village_day)`.
- `stickers (id, from_id, to_id, sticker, village_day, created_at)` - unique `(from_id, to_id, village_day)`.
- `referrals (id, referrer_id, friend_id UNIQUE, device_id, ip, status pending|paid|refused,
  reason, created_at, paid_at, referrer_job_id, friend_job_id)`.

**Server:**
- `rules.ts`: HELP_XP_HELPER 5, HELP_XP_OWNER 3, HELP_OWNER_XP_PER_DAY 3, STICKERS, REF_REWARD_REFERRER
  10, REF_REWARD_FRIEND 5, REF_PER_DAY_PER_DEVICE 3, REF_PER_DAY_PER_IP 3.
- New `server/src/social.ts`: farmer list, public garden view, help water, stickers, referrals.
- `game.ts`: water code shared with help water; first-harvest hook pays the referral; `state()` gets
  `visitors` (stickers + helps) and `referral` (link, pending / paid counts).
- `app.ts`: `GET /api/farmers`, `GET /api/farmers/:name`, `POST /api/farmers/:name/water`,
  `POST /api/farmers/:name/sticker`, `GET /api/referrals`; `POST /api/garden` accepts `ref` + `deviceId`.
- TaniBot: never helps other gardens (unchanged); its rules see a tree already watered by a friend.

**Web:**
- `friends.tsx` (farmer list + visit mode), `art/hotspots.tsx` (Friends pin live), visit banner in
  `scene.tsx`, Visitors box + invite link + "Share later" list in the Village tab, `share.tsx`
  (no outside click, X + Later, timing), `moments.ts` (queue waits for windows), `fx.tsx` (moment
  animations), `audio.ts` (new sounds), `app.tsx` (`?ref=` kept, notices for helps / referrals).

---

## 5. Risks, tests, release

Risks and answers:
- **XP / PANEN farming with fake accounts** -> 1 help per day, owner XP max 3 per day, no XP for
  gardens under 1 day old, referral pays only after a real first harvest, device + IP limits,
  judge gardens never count, `mint_reward` for the referrer.
- **Privacy** -> public view leaves out everything except name, title, avatar, trees; tests check that
  the public view JSON has no balance / seeds / email / wallet fields.
- **Popups annoy players or break the tutorial / Judge tour** -> one at a time, held during tutorial /
  tour / other windows, "Later", once per moment (already).
- **Phone screen space** -> the farmer list is a normal panel; visit mode reuses the garden scene.
- **Server load / RAM (1 GB VPS, Entropy next door)** -> farmer list is one SQL query, cached 30 s.
- **Chain cost** -> visits and stickers have no chain jobs; a referral is 2 mint jobs.
- **Rollback** -> new tables only; the previous release ignores them.

Tests:
- Server (`node:test`, fake chain, `makeWorld`): `social.test.ts` (list: who, order, no judge, no own
  garden, no private fields; visit view; help water: once per day, thirsty only, rain refused, drought
  counts once, owner XP cap, young garden no XP, own garden refused; stickers: once per day, known
  stickers only), `referral.test.ts` (pending on new garden, paid on first harvest only, judge refused,
  self-invite refused (same device / same identity), 3 per day per device and per IP, mint vs
  mint_reward jobs, Season divisor).
- Web unit tests: popup queue (waits for windows, Later list), referral link keeping (7 days).
- Browser (headless Chrome, fake-chain server port 8788 + vite 5174): `tools/ui-test-4sizes.sh` plus a
  new `--friends` mode: open the list, visit, help water, leave a sticker; share popup timing and
  "outside click does not close"; screenshots at 390 / 402 / 430 / 1440.

Release (needs Ardian's OK, same steps as before): read-only Entropy PID check (3665978, stop if
different), DB backup (`nearvest-backup.service`), stage `nearvest-<commit>` with Node 24, copy to a
new folder, switch `/opt/nearvest/app`, restart **only** `nearvest`, check `/health`, `/api/stats`,
`/api/farmers`, journal errors, memory, Entropy PID; secret check; push (Vercel). Rollback = link back
to the previous release + restart. The share popup part is web only and can ship first.

---

## 6. Time estimate and cut order

| Part | Estimate |
|---|---|
| A. Share popup rules (no outside click, X + Later, 1.5 s, waits for windows) | 2 h |
| B. Moment animations + sounds (7 moments, ~5 new CC0 sounds) | 3-4 h |
| C. Farmer list + public garden view (server + web) | 4 h |
| D. Help water + XP + notices | 3 h |
| E. Stickers + Visitors box | 2 h |
| F. Referral (server + web) | 3-4 h |
| G. Tests, 4-size screenshots, README / CLAUDE.md, release | 2-3 h |
| **Total** | **about 19-22 h** (more than one day) |

Build order: A -> C -> D -> F -> E -> B -> G (A is web only and can ship alone).

Cut order if time runs short (cut the first one first):
1. **B** -> one shared animation (confetti + existing sounds) for every moment.
2. **E** stickers -> later / Bonus.
3. Owner XP and "Helped you" ordering -> helper XP only, list by activity.
4. Referral web extras (pending / paid list) -> link + notice only.
Keep in any case: A, the farmer list, visiting, help water (C, D) and the referral pay rule (F).
