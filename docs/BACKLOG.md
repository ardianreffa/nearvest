# NEARvest backlog

Decisions by Ardian, 2026-11-07. Priorities follow the GDD (Must > Important > Polish > Bonus).
Target: **all Must features done by Tue 10 Nov**, spread out from today. Feature freeze Thu 12 Nov evening.
Draft numbers live in `server/src/rules.ts` and are tuned in testing. Sounds and art: CC0 only, recorded in `docs/ASSETS.md`.

| # | Item | Priority | Planned |
|---|------|----------|---------|
| 9 | Login copy + hide Dev login | Must (before deploy) | Sun 8 Nov |
| 10 | Top up testnet accounts | Must (before deploy) | Sun 8 Nov |
| 8 | How to play pages + interactive tutorial | Must | Tue 10 Nov |
| 3 | Weather + wilting | Important | Wed 11 Nov |
| 1 | Ambient sound layer | Important | Wed 11 Nov |
| 5 | Share-to-X popup + moment animations | Important | Thu 12 Nov |
| 6 | Referral via share link | Important | Thu 12 Nov |
| 7 | Market tab layout | Polish | Done Sat 7 Nov (moved forward) |
| 2 | Check-in surprise bonus | Polish | Fri 13 Nov |
| 4 | Pests | Bonus (only if time) | Thu 12 Nov, if time |
| - | Pruning / tidying trees | Skipped (not in GDD) | - |

## Must

**9. Login copy and Dev login (before deploy)**
- Login page footer ("No wallet...") and How to play step 1 must say: sign in with Google **or** a NEAR wallet.
- Hide the Dev login form in production builds (not only on the server side).

**10. Top up testnet accounts (before deploy)**
- Fill `nearvest.testnet` and `game.nearvest.testnet` from the testnet faucet. The factory pays 0.003 NEAR per new player; `nearvest.testnet` has only ~0.68 NEAR free (2026-11-07, ~1.19 NEAR locked by contract storage).

**8. How to play + tutorial**
- 4 short pages with Back / Next / Skip and page dots; bigger text on laptop.
- Build it together with the interactive tutorial (same TaniBot design).
- Tutorial: introduce TaniBot right AFTER the player's first manual harvest (the player learns the loop by hand first, then meets the helper).
- Try as Judge: the sample garden starts with TaniBot already ON (budget and Log visible right away).

## Important

**3. Weather and wilting (GDD)**
- Rain = free water. Drought = water twice. 2 days without water = the tree goes back one stage.

**1. Ambient sound layer**
- By time and weather: day = birds/wind, night = crickets, rain = rain sound (once weather exists).
- Separate from music: plays whether music is on or muted; follows the Sound (sfx) toggle.

**5. Share-to-X popup and moment animations**
- Popup appears 1.5 s after the moment's animation; an outside click does NOT close it; X and "Later" buttons; popups are queued, one at a time.
- Each moment has its own animation and sound:
  - First harvest: basket pop + cheerful jingle.
  - Gold fruit / first Gold tree: golden shine sweep + sparkle chime.
  - Big / Rare durian: heavy bounce + drum hit.
  - New title / level up: rising banner + confetti + fanfare.
  - TaniBot evolved: scan-line glow + robot beeps.
  - 7-day streak: calendar flip + coin rain.
  - Legend: fireworks.
- Build a first version; Ardian reviews and corrects.

**6. Referral via share link**
- Pays only after the friend's first harvest; max 3 per day per device.
- Draft rewards: referrer 10 PANEN, friend 5 PANEN.

## Polish

**7. Market tab** (done 2026-11-07)
- Panel title "Today's Prices".
- Mr. Darto introduces himself in the speech bubble, e.g. "Welcome, farmer! I'm Mr. Darto. Show me what you've got!"
- One row per fruit: icon, today's price, owned count, Sell button. Selling needs no scrolling.
- Seed selling in a collapsible "Sell seeds" section.
- Shorter market picture on laptop.

**2. Check-in surprise bonus**
- Check-in stays daily (no hourly check-in).
- One surprise bonus per 7-day streak, on a random day (never day 7), shown as a mystery box on the calendar.
- Random but worth it (draft): 1-2 Fertilizer, or 10-15 bonus PANEN, or a Rare seed.

## Bonus

**4. Pests** (only if time)
- Caterpillars, mainly on durian; cured with pesticide (10 PANEN).

## Skipped

- Pruning / tidying trees (not in the GDD).

## Ideas after the hackathon

Not planned for the hackathon. These will also become the roadmap section of the README.

- **Garden visits to friends** (already a Bonus feature in the GDD): visit a friend's garden, look around and help (for example water a thirsty tree).
- **1v1 PvP between farmers**: two farmers compete head to head (for example a timed harvest race or a best-fruit contest), with $PANEN or seed rewards.
