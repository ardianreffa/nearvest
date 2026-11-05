# Third-party assets

Every third-party asset used in NEARvest is listed here with its license and any attribution the author asks for.
Rule: check the license on the source page **before** adding an asset to the repo, then add or update its row here.
Licenses below were checked on 2026-11-05.

## Approved assets (all CC0 1.0)

CC0 = public domain dedication (https://creativecommons.org/publicdomain/zero/1.0/). No attribution is legally required, but we credit every author anyway and honor any credit requests.

| Asset | Author | Source | License | Attribution requested | Planned use |
|---|---|---|---|---|---|
| Tiny Farm (16x16, 130 files) | Kenney | https://kenney.nl/assets/tiny-farm | CC0 | No | Soil, plots, farm tiles |
| Pixel Platformer Farm Expansion (18x18, 110 files) | Kenney | https://kenney.nl/assets/pixel-platformer-farm-expansion | CC0 | No | Extra farm props |
| 32 Free Fruits and Veggies | Crumpaloo | https://crumpaloo.itch.io/32-free-fruits-and-veggies-asset-pack | CC0 | No (author asks for a rating on itch.io) | Fruit/item icons (no mango/durian/rambutan included; base for recolors) |
| 32x32 Fruit (12 sprites) | srmp1 | https://srmp1.itch.io/32x32-fruit | CC0 ("Free to use without credit") | No | Fruit/item icons |
| Tropical tree | Miguel Oliveira (MiguelOliveira3D) aka Pixquare | https://opengameart.org/content/tropical-tree | CC0 | **Yes: "Credits for Miguel Oliveira aka Pixquare. https://twitter.com/PixquareGames"** | Base for fruit tree sprites |
| Palms (palm.png, palm_2.png) | fryhet | https://opengameart.org/node/65742 | CC0 | No | Background palms |
| Robot Sprite - BrawlBot | wuhu | https://opengameart.org/content/robot-sprite-brawlbot | CC0 | Appreciated, not required | Base for TaniBot |
| Robot Lab Asset Pack | Murphy's Dad (MurphysDad) | https://murphysdad.itch.io/robot-lab-asset-pack | CC0 | Appreciated, not required ("Crediting to Murphy's Dad (https://murphysdad.itch.io/) is appreciated") | Drone sprite, robot parts |

## Credits (copy into README)

- Tropical tree by Miguel Oliveira aka Pixquare — https://twitter.com/PixquareGames (CC0)
- Tiny Farm and Pixel Platformer Farm Expansion by Kenney — https://kenney.nl (CC0)
- 32 Free Fruits and Veggies by Crumpaloo (CC0)
- 32x32 Fruit by srmp1 (CC0)
- Palms by fryhet (CC0)
- BrawlBot robot sprite by wuhu (CC0)
- Robot Lab Asset Pack by Murphy's Dad — https://murphysdad.itch.io/ (CC0)

## Files in the repo

| File | Source asset | License | Used for |
|---|---|---|---|
| `web/public/assets/cc0/palm-fryhet-1.png` | Palms (`palm.png`) by fryhet | CC0 | Garden background |
| `web/public/assets/cc0/palm-fryhet-2.png` | Palms (`palm_2.png`) by fryhet | CC0 | Garden background |

Downloaded 2026-11-05 from OpenGameArt. BrawlBot was checked but not used (painted style, not pixel art). The Tropical tree by Pixquare was used in the first UI version and removed on 2026-11-05 when species-specific trees were drawn (keep the credit only if it comes back).

## Audio (all CC0, checked 2026-11-05)

Converted to AAC (`.m4a`, `afconvert` on macOS) so they are small and play in every browser. Files are in `web/public/assets/audio/`.

| File | Source | Author | License | Source page |
|---|---|---|---|---|
| `music-apple-cider.m4a` (background loop) | "Apple Cider" (`apple_cider.mp3`) | Zane Little Music | CC0 | https://opengameart.org/content/apple-cider |
| `click.m4a` | Interface Sounds `click_001.ogg` | Kenney | CC0 (bundled License.txt; credit optional) | https://opengameart.org/content/interface-sounds |
| `plant.m4a` | Interface Sounds `select_003.ogg` | Kenney | CC0 | https://opengameart.org/content/interface-sounds |
| `water.m4a` | Interface Sounds `drop_002.ogg` | Kenney | CC0 | https://opengameart.org/content/interface-sounds |
| `harvest.m4a` | Interface Sounds `pluck_001.ogg` | Kenney | CC0 | https://opengameart.org/content/interface-sounds |
| `checkin.m4a` | Interface Sounds `confirmation_001.ogg` | Kenney | CC0 | https://opengameart.org/content/interface-sounds |
| `chain.m4a` | Interface Sounds `glass_002.ogg` | Kenney | CC0 | https://opengameart.org/content/interface-sounds |
| `error.m4a` | Interface Sounds `error_004.ogg` | Kenney | CC0 | https://opengameart.org/content/interface-sounds |
| `coins.m4a` (sell) | RPG Audio `handleCoins.ogg` | Kenney | CC0 (bundled license.txt) | https://opengameart.org/content/50-rpg-sound-effects |
| `burn.m4a` (shop) | Digital SFX `lowDown.mp3` | Kenney | CC0 (OpenGameArt page) | https://opengameart.org/content/63-digital-sound-effects-lasers-phasers-space-etc |
| `levelup.m4a` | Digital SFX `powerUp2.mp3` | Kenney | CC0 (OpenGameArt page) | https://opengameart.org/content/63-digital-sound-effects-lasers-phasers-space-etc |

Credits (copy into README): music "Apple Cider" by Zane Little Music; sound effects by Kenney (www.kenney.nl).

## Fonts

| Font | Source | License |
|---|---|---|
| Tiny5 (text and numbers) | Google Fonts | SIL Open Font License 1.1 |
| Pixelify Sans (headings) | Google Fonts | SIL Open Font License 1.1 |

## Modified and AI-generated assets

No CC0 mango, rambutan, or durian tree sprites were found. These will be recolored/edited from the CC0 assets above or generated with AI. List each one here with its base asset (or the AI tool used).

| File | Based on / made with | Notes |
|---|---|---|
| `web/src/sprites.tsx` (icons: seed mound, sprout, fruits, coin, droplet, sparkle, lock, fertilizer, seed packet, bolt, fire, speaker) | Original pixel art drawn in code for NEARvest (by Claude Code, 2026-11-05) | Part of this repo (MIT) |
| `web/src/art/trees.tsx` (mango, rambutan, durian x seed/sprout/tree/fruiting/old, generated procedurally) | Original, generated in code | Part of this repo (MIT) |
| `web/src/art/tanibot.tsx` (TaniBot v1 rusty/bamboo hat, v2 chrome/LED hat, drones, basket, plasma hoe) | Original pixel art drawn in code | Part of this repo (MIT) |
| `web/src/art/darto.tsx` (Mr. Darto full figure with hologram glasses, hover cart) | Original pixel art drawn in code | Part of this repo (MIT) |
| `web/src/art/backdrop.tsx` (sky phases, stars, sun/moon, clouds, volcanoes, joglo houses with solar panels, windmill, bamboo greenhouse, lanterns, rice terraces) | Original vector pixel art drawn in code | Part of this repo (MIT) |
